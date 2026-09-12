const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, res) => res.json({ ok: true }));

const rooms = new Map();
const RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const SUITS = ['♣','♠','♥','♦']; // Filipino-style low -> high
const rankValue = r => RANKS.indexOf(r);
const suitValue = s => SUITS.indexOf(s);
const cardId = c => `${c.r}${c.s}`;

function deck(){ const d=[]; for(const r of RANKS) for(const s of SUITS) d.push({r,s}); return d; }
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; }
function sortHand(h){ return h.sort((a,b)=>rankValue(a.r)-rankValue(b.r)||suitValue(a.s)-suitValue(b.s)); }
function createRoom(id, mode='dos'){ return {id, mode, players:[], started:false, hands:{}, turn:0, current:null, passes:0, lastPlayer:null, winner:null, round:1}; }
function publicRoom(room){ return {id:room.id, mode:room.mode, started:room.started, players:room.players.map(p=>({id:p.id,name:p.name,cardCount:room.hands[p.id]?.length||0,ready:!!p.ready})), turn:room.players[room.turn]?.id||null, current:room.current, winner:room.winner, round:room.round}; }
function emitRoom(room){ io.to(room.id).emit('room:update', publicRoom(room)); }
function playerState(room, p){ return { id:p.id, name:p.name, hand:sortHand(room.hands[p.id]||[]), room:publicRoom(room), me:p.id }; }
function broadcastState(room){ for(const p of room.players) io.to(p.id).emit('state', playerState(room,p)); emitRoom(room); }
function nextIndex(room, idx){ return (idx+1)%room.players.length; }
function findCard(hand,id){ return hand.find(c=>cardId(c)===id); }
function combo(cards){
  if(!cards.length) return null;
  const n=cards.length, rs=cards.map(c=>rankValue(c.r)).sort((a,b)=>a-b);
  const counts={}; cards.forEach(c=>counts[c.r]=(counts[c.r]||0)+1);
  const groups=Object.entries(counts).sort((a,b)=>b[1]-a[1]||rankValue(b[0])-rankValue(a[0]));
  if(n===1) return {type:'single', rank:rankValue(cards[0].r), suit:suitValue(cards[0].s), strength:rankValue(cards[0].r)*10+suitValue(cards[0].s)};
  if(n===2 && groups.length===1) return {type:'pair', rank:rankValue(groups[0][0]), strength:rankValue(groups[0][0])*10+Math.max(...cards.map(c=>suitValue(c.s)))};
  if(n===3 && groups.length===1) return {type:'triple', rank:rankValue(groups[0][0]), strength:rankValue(groups[0][0])};
  if(n!==5) return null;
  const flush=cards.every(c=>c.s===cards[0].s);
  let straight=false, high=rs[4];
  if(new Set(rs).size===5 && rs[4]-rs[0]===4) straight=true;
  // A-2-3-4-5 is treated as a special low straight in common house rules; here ranks are 3..2, so 2-3-4-5-6 is normal.
  const vals=Object.entries(counts).map(([r,n])=>({r,n,v:rankValue(r)})).sort((a,b)=>b.n-a.n||b.v-a.v);
  if(straight && flush) return {type:'straightFlush', rank:high, strength:700+high};
  if(vals[0].n===4) return {type:'four', rank:vals[0].v, kicker:vals[1].v, strength:600+vals[0].v*10+vals[1].v};
  if(vals[0].n===3 && vals[1].n===2) return {type:'fullHouse', rank:vals[0].v, pair:vals[1].v, strength:500+vals[0].v*10+vals[1].v};
  if(flush) return {type:'flush', ranks:rs.slice().sort((a,b)=>b-a), strength:400};
  if(straight) return {type:'straight', rank:high, strength:300+high};
  return null;
}
function compareCombo(a,b){
  if(!a||!b||a.type!==b.type) return null;
  if(a.type==='single') return a.strength-b.strength;
  if(['pair','triple'].includes(a.type)) return a.strength-b.strength;
  const keys=['strength','rank','pair','kicker'];
  if(a.type==='flush') { for(let i=0;i<a.ranks.length;i++){ if(a.ranks[i]!==b.ranks[i]) return a.ranks[i]-b.ranks[i]; } return 0; }
  for(const k of keys){ if(a[k]!=null||b[k]!=null){ const d=(a[k]??0)-(b[k]??0); if(d) return d; } }
  return 0;
}
function validPlay(cards, current, mustInclude3c=false){
  const c=combo(cards); if(!c) return {ok:false,msg:'Invalid combination.'};
  if(mustInclude3c && !cards.some(x=>x.r==='3'&&x.s==='♣')) return {ok:false,msg:'Your first play must include the 3♣.'};
  if(!current) return {ok:true, combo:c};
  if(cards.length!==current.cards.length) return {ok:false,msg:'Play the same number of cards.'};
  if(c.type!==current.combo.type) return {ok:false,msg:'You must play the same combination type.'};
  if(compareCombo(c,current.combo)<=0) return {ok:false,msg:'Your play must be higher.'};
  return {ok:true,combo:c};
}
function startDos(room){
  const d=shuffle(deck()); room.hands={}; room.players.forEach(p=>room.hands[p.id]=[]); d.forEach((c,i)=>room.hands[room.players[i%room.players.length].id].push(c)); room.players.forEach(p=>sortHand(room.hands[p.id]));
  room.started=true; room.current=null; room.passes=0; room.lastPlayer=null; room.winner=null; room.round=1;
  const idx=room.players.findIndex(p=>room.hands[p.id].some(c=>c.r==='3'&&c.s==='♣')); room.turn=idx<0?0:idx;
}
function leaveRoom(socket){ const rid=socket.data.room; if(!rid) return; const room=rooms.get(rid); if(!room) return; room.players=room.players.filter(p=>p.id!==socket.id); delete room.hands[socket.id]; socket.leave(rid); socket.data.room=null; if(!room.players.length) rooms.delete(rid); else { if(room.turn>=room.players.length) room.turn=0; room.started=false; room.current=null; room.winner=null; emitRoom(room); broadcastState(room); } }

io.on('connection', socket=>{
  socket.on('room:create', ({name,mode='dos'}={})=>{ const id=Math.random().toString(36).slice(2,7).toUpperCase(); const room=createRoom(id,mode); rooms.set(id,room); join(socket,room,name); });
  socket.on('room:join', ({roomId,name}={})=>{ const room=rooms.get(String(roomId||'').toUpperCase()); if(!room) return socket.emit('error:msg','Room not found.'); if(room.started) return socket.emit('error:msg','Game already started.'); if(room.players.length>=4) return socket.emit('error:msg','Room is full.'); join(socket,room,name); });
  socket.on('room:leave',()=>leaveRoom(socket));
  socket.on('game:start',()=>{ const room=rooms.get(socket.data.room); if(!room||room.players[0]?.id!==socket.id) return; if(room.players.length<2) return socket.emit('error:msg','Need at least 2 players.'); if(room.mode!=='dos') return socket.emit('error:msg','This build currently ships the real-time Pusoy Dos table.'); startDos(room); broadcastState(room); });
  socket.on('game:play', ids=>{
    const room=rooms.get(socket.data.room); if(!room||!room.started||room.winner) return;
    const p=room.players[room.turn]; if(!p||p.id!==socket.id) return socket.emit('error:msg','It is not your turn.');
    const hand=room.hands[socket.id]||[]; const cards=(ids||[]).map(id=>findCard(hand,id)).filter(Boolean);
    if(cards.length!==(ids||[]).length) return socket.emit('error:msg','Invalid card selection.');
    const must=!room.current && room.round===1; const v=validPlay(cards,room.current,must); if(!v.ok) return socket.emit('error:msg',v.msg);
    const set=new Set(cards.map(cardId)); room.hands[socket.id]=hand.filter(c=>!set.has(cardId(c)));
    room.current={cards,combo:v.combo,playerId:socket.id}; room.lastPlayer=socket.id; room.passes=0;
    if(room.hands[socket.id].length===0){ room.winner=p.id; broadcastState(room); return; }
    room.turn=nextIndex(room,room.turn); broadcastState(room);
  });
  socket.on('game:pass',()=>{
    const room=rooms.get(socket.data.room); if(!room||!room.started||room.winner) return;
    const p=room.players[room.turn]; if(!p||p.id!==socket.id) return socket.emit('error:msg','It is not your turn.');
    if(!room.current) return socket.emit('error:msg','You cannot pass when leading.');
    room.passes++; room.turn=nextIndex(room,room.turn);
    if(room.passes>=room.players.length-1){ const li=room.players.findIndex(x=>x.id===room.lastPlayer); room.turn=li<0?0:li; room.current=null; room.passes=0; }
    broadcastState(room);
  });
  socket.on('disconnect',()=>leaveRoom(socket));
});
function join(socket,room,name){ name=String(name||'Player').trim().slice(0,18)||'Player'; const p={id:socket.id,name,ready:true}; room.players.push(p); socket.join(room.id); socket.data.room=room.id; socket.emit('joined',{roomId:room.id}); broadcastState(room); }

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`Pusoy Online running on :${PORT}`));
