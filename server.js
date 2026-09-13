const express=require('express');
const http=require('http');
const {Server}=require('socket.io');
const path=require('path');
const app=express();
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:'*'}});
app.use(express.static(path.join(__dirname,'public')));
app.get('/health',(_,res)=>res.json({ok:true}));

const rooms=new Map();
const RANKS=['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const SUITS=['♣','♠','♥','♦'];
const POKER_ORDER={straight:1,flush:2,fullHouse:3,four:4,straightFlush:5};
const STARTING_CHIPS=1000;
const ANTE=10;
const BET_SIZE=20;
const MAX_RAISES=2;
const rankValue=r=>RANKS.indexOf(r);
const suitValue=s=>SUITS.indexOf(s);
const cardId=c=>`${c.r}${c.s}`;
function deck(){const d=[];for(const r of RANKS)for(const s of SUITS)d.push({r,s});return d}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function sortHand(h){return h.sort((a,b)=>rankValue(a.r)-rankValue(b.r)||suitValue(a.s)-suitValue(b.s))}
function createRoom(id,mode='dos'){return{id,mode,players:[],started:false,hands:{},turn:0,current:null,passes:0,lastPlayer:null,winner:null,round:1,firstPlay:true,botTimer:null,finished:[],gameOver:false,pot:0,ante:ANTE,betSize:BET_SIZE,betting:false,betTurn:0,betCurrent:0,betContrib:{},betRaised:false,raiseCount:0}}
function publicRoom(room){return{id:room.id,mode:room.mode,started:room.started,players:room.players.map(p=>({id:p.id,name:p.name,cardCount:room.hands[p.id]?.length||0,ready:!!p.ready,isBot:!!p.isBot,difficulty:p.difficulty||null,eliminated:!!p.eliminated,folded:!!p.folded,chips:p.chips??STARTING_CHIPS})),turn:room.players[room.turn]?.id||null,current:room.current,winner:room.winner,round:room.round,finished:room.finished,gameOver:room.gameOver,pot:room.pot,ante:room.ante,betSize:room.betSize,betting:room.betting,betTurn:room.players[room.betTurn]?.id||null,betCurrent:room.betCurrent,betContrib:room.betContrib,raiseCount:room.raiseCount,maxRaises:MAX_RAISES}}
function emitRoom(room){io.to(room.id).emit('room:update',publicRoom(room))}
function playerState(room,p){return{id:p.id,name:p.name,hand:sortHand(room.hands[p.id]||[]),room:publicRoom(room),me:p.id,bestPlay:bestNextPlay(room,p)}}
function broadcastState(room){for(const p of room.players)if(!p.isBot)io.to(p.id).emit('state',playerState(room,p));emitRoom(room)}
function activePlayers(room){return room.players.filter(p=>!p.eliminated)}
function nextActiveIndex(room,idx){if(!room.players.length)return 0;for(let step=1;step<=room.players.length;step++){const i=(idx+step)%room.players.length;if(!room.players[i].eliminated&&!room.players[i].folded)return i}for(let step=1;step<=room.players.length;step++){const i=(idx+step)%room.players.length;if(!room.players[i].eliminated)return i}return idx}
function activeCount(room){return room.players.reduce((n,p)=>n+(p.eliminated?0:1),0)}
function bettingPlayers(room){return room.players.filter(p=>!p.eliminated&&!p.folded)}
function nextBetIndex(room,idx){const eligible=bettingPlayers(room);if(!eligible.length)return idx;for(let step=1;step<=room.players.length;step++){const i=(idx+step)%room.players.length;const p=room.players[i];if(p&&!p.eliminated&&!p.folded)return i}return room.players.findIndex(p=>p.id===eligible[0].id)}
function nextBotNumber(room){const used=new Set(room.players.filter(p=>p.isBot).map(p=>p.name));let n=1;while(used.has(`Bot ${n}`))n++;return n}
function combinations(arr,k){const out=[];function rec(start,chosen){if(chosen.length===k){out.push(chosen.slice());return}for(let i=start;i<=arr.length-(k-chosen.length);i++){chosen.push(arr[i]);rec(i+1,chosen);chosen.pop()}}rec(0,[]);return out}
function combo(cards){
  if(!cards.length)return null;
  const n=cards.length,rs=cards.map(c=>rankValue(c.r)).sort((a,b)=>a-b),counts={};
  cards.forEach(c=>counts[c.r]=(counts[c.r]||0)+1);
  const groups=Object.entries(counts).sort((a,b)=>b[1]-a[1]||rankValue(b[0])-rankValue(a[0]));
  if(n===1)return{type:'single',rank:rankValue(cards[0].r),suit:suitValue(cards[0].s),strength:rankValue(cards[0].r)*10+suitValue(cards[0].s)};
  if(n===2&&groups.length===1)return{type:'pair',rank:rankValue(groups[0][0]),strength:rankValue(groups[0][0])*10+Math.max(...cards.map(c=>suitValue(c.s)))};
  if(n===3&&groups.length===1)return{type:'triple',rank:rankValue(groups[0][0]),strength:rankValue(groups[0][0])};
  if(n!==5)return null;
  const flush=cards.every(c=>c.s===cards[0].s);
  let straight=false,high=rs[4];
  if(new Set(rs).size===5&&rs[4]-rs[0]===4)straight=true;
  const vals=Object.entries(counts).map(([r,n])=>({r,n,v:rankValue(r)})).sort((a,b)=>b.n-a.n||b.v-a.v);
  if(straight&&flush)return{type:'straightFlush',rank:high,strength:700+high};
  if(vals[0].n===4)return{type:'four',rank:vals[0].v,kicker:vals[1].v,strength:600+vals[0].v*10+vals[1].v};
  if(vals[0].n===3&&vals[1].n===2)return{type:'fullHouse',rank:vals[0].v,pair:vals[1].v,strength:500+vals[0].v*10+vals[1].v};
  if(flush)return{type:'flush',ranks:rs.slice().sort((a,b)=>b-a),strength:400};
  if(straight)return{type:'straight',rank:high,strength:300+high};
  return null;
}
function compareSame(a,b){
  if(a.type!==b.type)return null;
  if(a.type==='single'||a.type==='pair'||a.type==='triple')return a.strength-b.strength;
  if(a.type==='flush'){for(let i=0;i<a.ranks.length;i++)if(a.ranks[i]!==b.ranks[i])return a.ranks[i]-b.ranks[i];return 0}
  if(a.type==='straight'||a.type==='straightFlush')return a.rank-b.rank;
  if(a.type==='four')return a.rank!==b.rank?a.rank-b.rank:a.kicker-b.kicker;
  if(a.type==='fullHouse')return a.rank!==b.rank?a.rank-b.rank:a.pair-b.pair;
  return 0;
}
function compareCombo(a,b){
  if(!a||!b)return null;
  if(a.type!==b.type){
    const ao=POKER_ORDER[a.type],bo=POKER_ORDER[b.type];
    if(ao!=null&&bo!=null)return ao-bo;
    return null;
  }
  return compareSame(a,b);
}
function validPlay(cards,current,mustInclude3c=false){
  const c=combo(cards);if(!c)return{ok:false,msg:'Invalid combination.'};
  if(mustInclude3c&&!cards.some(x=>x.r==='3'&&x.s==='♣'))return{ok:false,msg:'Your first play must include the 3♣.'};
  if(!current)return{ok:true,combo:c};
  if(cards.length!==current.cards.length)return{ok:false,msg:'Play the same number of cards.'};
  const cmp=compareCombo(c,current.combo);
  if(cmp===null)return{ok:false,msg:'That combination cannot beat the current play.'};
  if(cmp<=0)return{ok:false,msg:'Your play must be higher.'};
  return{ok:true,combo:c};
}
function finishBetting(room){
  room.betting=false;room.betCurrent=0;room.betContrib={};room.betRaised=false;room.raiseCount=0;
  const idx=room.players.findIndex(p=>p.id===room.players[room.betTurn]?.id&&!p.eliminated);
  room.turn=idx>=0?idx:room.players.findIndex(p=>!p.eliminated);
  room.firstPlay=true;
}
function startBetting(room){
  room.betting=true;room.betCurrent=room.betSize;room.betContrib={};room.raiseCount=0;
  room.players.forEach(p=>{p.folded=false;room.betContrib[p.id]=0});
  const eligible=bettingPlayers(room);
  for(const p of eligible){const pay=Math.min(room.ante,p.chips??STARTING_CHIPS);p.chips-=pay;room.pot+=pay;room.betContrib[p.id]=pay}
  room.openingTurn=room.turn;room.betTurn=room.openingTurn;room.betRaised=false;
  if(room.betTurn<0)room.betTurn=room.players.findIndex(p=>!p.eliminated);
  scheduleBot(room);
}
function allMatched(room){const eligible=bettingPlayers(room);if(!eligible.length)return true;return eligible.every(p=>(room.betContrib[p.id]||0)>=room.betCurrent)}
function handleBet(room,p,action){
  if(!room.betting)return{ok:false,msg:'Betting is already finished.'};
  if(room.players[room.betTurn]?.id!==p.id)return{ok:false,msg:'It is not your betting turn.'};
  if(p.eliminated||p.folded)return{ok:false,msg:'You cannot bet.'};
  const cur=room.betContrib[p.id]||0;
  if(action==='fold'){
    p.folded=true;room.betTurn=nextBetIndex(room,room.betTurn);
  }else if(action==='call'){
    const add=Math.max(0,room.betCurrent-cur);if(add>p.chips)return{ok:false,msg:'Not enough chips to call.'};
    p.chips-=add;room.pot+=add;room.betContrib[p.id]=cur+add;room.betTurn=nextBetIndex(room,room.betTurn);
  }else if(action==='raise'){
    if(room.raiseCount>=MAX_RAISES)return{ok:false,msg:`Fixed betting limit reached (${MAX_RAISES} raises).`};
    const target=room.betCurrent+room.betSize;const add=target-cur;if(add>p.chips)return{ok:false,msg:'Not enough chips to raise.'};
    p.chips-=add;room.pot+=add;room.betCurrent=target;room.betRaised=true;room.raiseCount++;room.betContrib[p.id]=target;room.betTurn=nextBetIndex(room,room.betTurn);
  }else return{ok:false,msg:'Unknown betting action.'};
  if(bettingPlayers(room).length<=1){const survivor=bettingPlayers(room)[0];if(survivor){survivor.chips+=room.pot;room.pot=0}finishBetting(room)}
  else if(allMatched(room))finishBetting(room);
  return{ok:true};
}
function botCandidates(hand,current,firstPlay){
  const candidates=[];const sizes=current?[current.cards.length]:[1,2,3,5];
  for(const n of sizes){if(n>hand.length)continue;for(const cards of combinations(hand,n)){const v=validPlay(cards,current,firstPlay);if(v.ok)candidates.push({cards,combo:v.combo})}}
  return candidates;
}
function cardSetKey(cards){return cards.map(cardId).sort().join('|')}
function botDifficulty(p){return p.difficulty||'medium'}
function handValue(cards){
  let score=0;const counts={};cards.forEach(c=>counts[c.r]=(counts[c.r]||0)+1);
  cards.forEach(c=>{const v=rankValue(c.r);score+=v+1;if(counts[c.r]>=2)score+=6;if(counts[c.r]>=3)score+=8;if(counts[c.r]>=4)score+=15});
  return score;
}
function chooseBotPlay(room,bot){
  const hand=sortHand(room.hands[bot.id]||[]),current=room.current,candidates=botCandidates(hand,current,room.firstPlay);
  if(!candidates.length)return null;
  const difficulty=botDifficulty(bot);
  if(difficulty==='easy'){
    return candidates[Math.floor(Math.random()*candidates.length)];
  }
  if(difficulty==='medium'){
    candidates.sort((a,b)=>{
      const al=a.cards.length===1?0:1, bl=b.cards.length===1?0:1;
      return (al-bl)||(a.combo.strength??0)-(b.combo.strength??0);
    });
    return candidates[Math.min(candidates.length-1,Math.floor(candidates.length*.25))];
  }
  // Hard: prioritize winning immediately, otherwise shed cards while preserving pairs/triples/four-kind.
  candidates.sort((a,b)=>{
    const aWin=a.cards.length===hand.length,bWin=b.cards.length===hand.length;
    if(aWin!==bWin)return aWin?-1:1;
    const aRemain=hand.filter(x=>!a.cards.some(y=>cardId(x)===cardId(y)));
    const bRemain=hand.filter(x=>!b.cards.some(y=>cardId(x)===cardId(y)));
    const utility=(remain,play)=>remain.length*20-handValue(remain)+play.combo.strength/10;
    return utility(aRemain,a)-utility(bRemain,b);
  });
  return candidates[0];
}
function bestNextPlay(room,p){
  if(!room.started||room.gameOver||room.betting||p.eliminated||room.turn!==room.players.findIndex(x=>x.id===p.id))return [];
  const hand=room.hands[p.id]||[];const candidates=botCandidates(hand,room.current,room.firstPlay);if(!candidates.length)return [];
  const scored=candidates.map(c=>{
    const remain=hand.filter(x=>!c.cards.some(y=>cardId(x)===cardId(y)));
    const preserve=handValue(remain);
    const immediate=c.cards.length===hand.length?10000:0;
    const comboBonus={single:0,pair:8,triple:14,straight:12,flush:16,fullHouse:22,four:30,straightFlush:35}[c.combo.type]||0;
    const leadPenalty=!room.current?(c.combo.type==='single'?0:6):0;
    return {...c,score:immediate+preserve*-1+comboBonus+leadPenalty};
  });
  scored.sort((a,b)=>b.score-a.score);
  return scored[0]?.cards.map(cardId)||[];
}
function scheduleBot(room){if(!room||room.gameOver)return;clearTimeout(room.botTimer);if(room.betting){const p=room.players[room.betTurn];if(p?.isBot&&!p.eliminated&&!p.folded)room.botTimer=setTimeout(()=>botBetTurn(room.id),650);return}if(!room.started)return;const p=room.players[room.turn];if(p?.isBot&&!p.eliminated)room.botTimer=setTimeout(()=>botTurn(room.id),700)}
function botBetTurn(roomId){
  const room=rooms.get(roomId);if(!room||!room.betting)return;const p=room.players[room.betTurn];if(!p?.isBot)return;
  const d=botDifficulty(p),cur=room.betContrib[p.id]||0,need=room.betCurrent-cur;let action='call';
  if(d==='easy') action=Math.random()<0.12?'fold':'call';
  else if(d==='medium') action=(room.raiseCount<MAX_RAISES&&Math.random()<0.18)?'raise':'call';
  else action=(room.raiseCount<MAX_RAISES&&Math.random()<0.42)?'raise':'call';
  if(need>p.chips&&action!=='fold')action='fold';
  const r=handleBet(room,p,action);if(r.ok){broadcastState(room);scheduleBot(room)}
}
function botTurn(roomId){const room=rooms.get(roomId);if(!room||!room.started||room.gameOver||room.betting)return;const bot=room.players[room.turn];if(!bot?.isBot||bot.eliminated)return;const choice=chooseBotPlay(room,bot);if(choice){const set=new Set(choice.cards.map(cardId));room.hands[bot.id]=room.hands[bot.id].filter(c=>!set.has(cardId(c)));room.current={cards:choice.cards,combo:choice.combo,playerId:bot.id};room.lastPlayer=bot.id;room.passes=0;room.firstPlay=false;if(room.hands[bot.id].length===0){finishPlayer(room,bot.id);if(room.gameOver){broadcastState(room);return}room.current=null;room.passes=0;room.lastPlayer=null;room.turn=nextActiveIndex(room,room.turn)}else room.turn=nextActiveIndex(room,room.turn)}else if(room.current){room.passes++;room.turn=nextActiveIndex(room,room.turn);if(room.passes>=activeCount(room)-1){const li=room.players.findIndex(x=>x.id===room.lastPlayer&&!x.eliminated);room.turn=li<0?nextActiveIndex(room,room.turn):li;room.current=null;room.passes=0}}else room.turn=nextActiveIndex(room,room.turn);broadcastState(room);scheduleBot(room)}
function findCard(hand,id){return hand.find(c=>cardId(c)===id)}
function startDos(room){const d=shuffle(deck());room.hands={};room.players.forEach(p=>{room.hands[p.id]=[];p.eliminated=false;p.folded=false;if(p.chips==null)p.chips=STARTING_CHIPS});d.forEach((c,i)=>room.hands[room.players[i%room.players.length].id].push(c));room.players.forEach(p=>sortHand(room.hands[p.id]));room.started=true;room.current=null;room.passes=0;room.lastPlayer=null;room.winner=null;room.round=1;room.finished=[];room.gameOver=false;room.pot=0;room.betCurrent=0;room.betContrib={};room.betRaised=false;room.raiseCount=0;room.bestPlay=[];const idx=room.players.findIndex(p=>room.hands[p.id].some(c=>c.r==='3'&&c.s==='♣'));room.turn=idx<0?0:idx;startBetting(room)}
function finishPlayer(room,playerId){const p=room.players.find(x=>x.id===playerId);if(!p||p.eliminated)return;p.eliminated=true;room.finished.push(playerId);room.winner=playerId;if(activeCount(room)<=1){const last=room.players.find(x=>!x.eliminated);if(last)room.finished.push(last.id);room.gameOver=true;room.started=false;room.current=null;room.passes=0;room.lastPlayer=null;clearTimeout(room.botTimer);if(last){last.chips+=room.pot;room.pot=0}}}
function resetForPlayAgain(room){clearTimeout(room.botTimer);room.players.forEach(p=>{p.eliminated=false;p.folded=false});startDos(room)}
function leaveRoom(socket){const rid=socket.data.room;if(!rid)return;const room=rooms.get(rid);if(!room)return;room.players=room.players.filter(p=>p.id!==socket.id);delete room.hands[socket.id];socket.leave(rid);socket.data.room=null;if(!room.players.length)rooms.delete(rid);else{if(room.turn>=room.players.length)room.turn=0;room.started=false;room.betting=false;room.current=null;room.winner=null;emitRoom(room);broadcastState(room)}}

io.on('connection',socket=>{
  socket.on('room:create',({name,mode='dos'}={})=>{const id=Math.random().toString(36).slice(2,7).toUpperCase();const room=createRoom(id,mode);rooms.set(id,room);join(socket,room,name)});
  socket.on('room:join',({roomId,name}={})=>{const room=rooms.get(String(roomId||'').toUpperCase());if(!room)return socket.emit('error:msg','Room not found.');if(room.started)return socket.emit('error:msg','Game already started.');if(room.players.length>=4)return socket.emit('error:msg','Room is full.');join(socket,room,name)});
  socket.on('room:addBot',(difficulty='medium')=>{const room=rooms.get(socket.data.room);if(!room)return;if(room.players[0]?.id!==socket.id)return socket.emit('error:msg','Only the host can add a bot.');if(room.started)return socket.emit('error:msg','Game already started.');if(room.players.length>=4)return socket.emit('error:msg','Room is full.');difficulty=['easy','medium','hard'].includes(difficulty)?difficulty:'medium';const id=`bot-${room.id}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;room.players.push({id,name:`Bot ${nextBotNumber(room)}`,difficulty,ready:true,isBot:true,eliminated:false,folded:false,chips:STARTING_CHIPS});room.hands[id]=[];broadcastState(room)});
  socket.on('room:removeBot',botId=>{const room=rooms.get(socket.data.room);if(!room)return;if(room.players[0]?.id!==socket.id)return socket.emit('error:msg','Only the host can remove a bot.');if(room.started)return socket.emit('error:msg','Game already started.');const p=room.players.find(x=>x.id===botId);if(!p?.isBot)return socket.emit('error:msg','Bot not found.');room.players=room.players.filter(x=>x.id!==botId);delete room.hands[botId];broadcastState(room)});
  socket.on('game:start',()=>{const room=rooms.get(socket.data.room);if(!room||room.players[0]?.id!==socket.id)return;if(room.players.length<2)return socket.emit('error:msg','Need at least 2 players.');if(room.mode!=='dos')return socket.emit('error:msg','This build currently ships the real-time Pusoy Dos table.');startDos(room);broadcastState(room);scheduleBot(room)});
  socket.on('game:playAgain',()=>{const room=rooms.get(socket.data.room);if(!room||!room.gameOver)return;if(room.players[0]?.id!==socket.id)return socket.emit('error:msg','Only the host can start the next game.');if(room.players.length<2)return socket.emit('error:msg','Need at least 2 players.');resetForPlayAgain(room);broadcastState(room);scheduleBot(room)});
  socket.on('game:bet',action=>{const room=rooms.get(socket.data.room);if(!room||!room.betting)return;const p=room.players[room.betTurn];if(!p||p.id!==socket.id)return socket.emit('error:msg','It is not your betting turn.');const r=handleBet(room,p,action);if(!r.ok)return socket.emit('error:msg',r.msg);broadcastState(room);scheduleBot(room)});
  socket.on('game:play',ids=>{const room=rooms.get(socket.data.room);if(!room||!room.started||room.gameOver||room.betting)return;const p=room.players[room.turn];if(!p||p.id!==socket.id)return socket.emit('error:msg','It is not your turn.');const hand=room.hands[socket.id]||[];const cards=(ids||[]).map(id=>findCard(hand,id)).filter(Boolean);if(cards.length!==(ids||[]).length)return socket.emit('error:msg','Invalid card selection.');const v=validPlay(cards,room.current,room.firstPlay);if(!v.ok)return socket.emit('error:msg',v.msg);const set=new Set(cards.map(cardId));room.hands[socket.id]=hand.filter(c=>!set.has(cardId(c)));room.current={cards,combo:v.combo,playerId:socket.id};room.lastPlayer=socket.id;room.passes=0;room.firstPlay=false;if(room.hands[socket.id].length===0){finishPlayer(room,p.id);if(room.gameOver){broadcastState(room);return}room.current=null;room.passes=0;room.lastPlayer=null;room.turn=nextActiveIndex(room,room.turn)}else room.turn=nextActiveIndex(room,room.turn);broadcastState(room);scheduleBot(room)});
  socket.on('game:pass',()=>{const room=rooms.get(socket.data.room);if(!room||!room.started||room.gameOver||room.betting)return;const p=room.players[room.turn];if(!p||p.id!==socket.id)return socket.emit('error:msg','It is not your turn.');if(!room.current)return socket.emit('error:msg','You cannot pass when leading.');room.passes++;room.turn=nextActiveIndex(room,room.turn);if(room.passes>=activeCount(room)-1){const li=room.players.findIndex(x=>x.id===room.lastPlayer&&!x.eliminated);room.turn=li<0?nextActiveIndex(room,room.turn):li;room.current=null;room.passes=0}broadcastState(room);scheduleBot(room)});
  socket.on('disconnect',()=>leaveRoom(socket));
});
function join(socket,room,name){name=String(name||'Player').trim().slice(0,18)||'Player';const p={id:socket.id,name,ready:true,isBot:false,eliminated:false,folded:false,chips:STARTING_CHIPS};room.players.push(p);socket.join(room.id);socket.data.room=room.id;socket.emit('joined',{roomId:room.id});broadcastState(room)}
const PORT=process.env.PORT||3000;server.listen(PORT,()=>console.log(`Pusoy Online running on :${PORT}`));
