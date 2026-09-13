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
const DEFAULT_MIN_BET=20;
const DEFAULT_MAX_BET=200;
const ANTE=10;
const rankValue=r=>RANKS.indexOf(r);
const suitValue=s=>SUITS.indexOf(s);
const cardId=c=>`${c.r}${c.s}`;
function deck(){const d=[];for(const r of RANKS)for(const s of SUITS)d.push({r,s});return d}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function sortHand(h){return h.sort((a,b)=>rankValue(a.r)-rankValue(b.r)||suitValue(a.s)-suitValue(b.s))}
function createRoom(id,mode='dos'){return{id,mode,players:[],started:false,hands:{},turn:0,current:null,passes:0,lastPlayer:null,winner:null,round:1,firstPlay:true,botTimer:null,finished:[],gameOver:false,pot:0,ante:ANTE,minBet:DEFAULT_MIN_BET,maxBet:DEFAULT_MAX_BET,startingChips:STARTING_CHIPS,betting:false,betTurn:0,betCurrent:0,betContrib:{},betRaised:false,history:[]}}
function publicRoom(room){return{id:room.id,mode:room.mode,started:room.started,players:room.players.map(p=>({id:p.id,name:p.name,cardCount:room.hands[p.id]?.length||0,ready:!!p.ready,isBot:!!p.isBot,difficulty:p.difficulty||null,eliminated:!!p.eliminated,folded:!!p.folded,chips:p.chips??room.startingChips})),turn:room.players[room.turn]?.id||null,current:room.current,winner:room.winner,round:room.round,finished:room.finished,gameOver:room.gameOver,pot:room.pot,ante:room.ante,minBet:room.minBet,maxBet:room.maxBet,startingChips:room.startingChips,betting:room.betting,betTurn:room.players[room.betTurn]?.id||null,betCurrent:room.betCurrent,betContrib:room.betContrib,history:room.history}}
function emitRoom(room){io.to(room.id).emit('room:update',publicRoom(room))}
function addHistory(room,text){room.history.push({text,at:Date.now()});if(room.history.length>80)room.history.shift()}
function playerState(room,p){return{id:p.id,name:p.name,hand:sortHand(room.hands[p.id]||[]),room:publicRoom(room),me:p.id,bestPlay:bestPlay(room,p),optimalPlay:optimalPlay(room,p)}}
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
  room.betting=false;room.betCurrent=0;room.betContrib={};room.betRaised=false;
  const idx=room.players.findIndex(p=>!p.eliminated&&(room.hands[p.id]||[]).some(c=>c.r==='3'&&c.s==='♣'));
  room.turn=idx>=0?idx:room.players.findIndex(p=>!p.eliminated);
  room.firstPlay=true;
}
function startBetting(room){
  room.betting=true;room.betCurrent=room.minBet;room.betContrib={};
  room.players.forEach(p=>{p.folded=false;room.betContrib[p.id]=0});
  const eligible=bettingPlayers(room);
  for(const p of eligible){const pay=Math.min(room.ante,p.chips??room.startingChips);p.chips-=pay;room.pot+=pay;room.betContrib[p.id]=pay}
  room.betTurn=room.turn;
  addHistory(room,`Betting started — minimum ${room.minBet}, maximum ${room.maxBet}`);
  scheduleBot(room);
}
function allMatched(room){const eligible=bettingPlayers(room);if(!eligible.length)return true;return eligible.every(p=>(room.betContrib[p.id]||0)>=room.betCurrent)}
function handleBet(room,p,action,raiseTo){
  if(!room.betting)return{ok:false,msg:'Betting is already finished.'};
  if(room.players[room.betTurn]?.id!==p.id)return{ok:false,msg:'It is not your betting turn.'};
  if(p.eliminated||p.folded)return{ok:false,msg:'You cannot bet.'};
  const cur=room.betContrib[p.id]||0;
  if(action==='fold'){
    p.folded=true;addHistory(room,`${p.name} folded`);room.betTurn=nextBetIndex(room,room.betTurn);
  }else if(action==='call'){
    const add=Math.max(0,room.betCurrent-cur);if(add>p.chips)return{ok:false,msg:'Not enough chips to call.'};
    p.chips-=add;room.pot+=add;room.betContrib[p.id]=cur+add;addHistory(room,`${p.name} called ${room.betCurrent}`);room.betTurn=nextBetIndex(room,room.betTurn);
  }else if(action==='raise'){
    const target=Number(raiseTo);
    if(!Number.isFinite(target)||!Number.isInteger(target))return{ok:false,msg:'Enter a whole-number raise amount.'};
    if(target<=room.betCurrent)return{ok:false,msg:`Raise must be higher than ${room.betCurrent}.`};
    if(target>room.maxBet)return{ok:false,msg:`Maximum bet is ${room.maxBet}.`};
    const add=target-cur;if(add>p.chips)return{ok:false,msg:'Not enough chips for that raise.'};
    p.chips-=add;room.pot+=add;room.betCurrent=target;room.betRaised=true;room.betContrib[p.id]=target;addHistory(room,`${p.name} raised to ${target}`);room.betTurn=nextBetIndex(room,room.betTurn);
  }else return{ok:false,msg:'Unknown betting action.'};
  if(bettingPlayers(room).length<=1){finishBetting(room)}
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

  // Score how useful a play is for actually shedding cards while also
  // making the bot use pairs/triples instead of almost always dumping singles.
  function playScore(c){
    const remain=hand.filter(x=>!c.cards.some(y=>cardId(x)===cardId(y)));
    const type=c.combo.type;
    const isLead=!current;
    const pairBonus=type==='pair'?(isLead?-28:20):0;
    const tripleBonus=type==='triple'?(isLead?-20:24):0;
    const pokerBonus={straight:18,flush:22,fullHouse:30,four:42,straightFlush:48}[type]||0;
    const singlePenalty=isLead?12:0;
    const shed=c.cards.length*14;
    const immediate=c.cards.length===hand.length?10000:0;
    // Preserve the value of remaining combinations, but don't overvalue them:
    // the bot should actually shed pairs/triples when that is a good move.
    const preserve=handValue(remain)*0.55;
    return immediate+shed+pairBonus+tripleBonus+pokerBonus-singlePenalty-preserve;
  }

  if(difficulty==='easy'){
    // Easy bots still play naturally, but now have a real chance to dump pairs
    // and triples instead of being locked into singles.
    const weighted=[];
    candidates.forEach(c=>{
      let weight=2;
      if(c.combo.type==='pair')weight=4;
      else if(c.combo.type==='triple')weight=3;
      else if(['straight','flush','fullHouse','four','straightFlush'].includes(c.combo.type))weight=2;
      for(let i=0;i<weight;i++)weighted.push(c);
    });
    return weighted[Math.floor(Math.random()*weighted.length)];
  }

  if(difficulty==='medium'){
    candidates.sort((a,b)=>playScore(b)-playScore(a));
    // Keep some unpredictability while strongly preferring useful multi-card plays.
    const top=Math.min(5,candidates.length);
    return candidates[Math.floor(Math.random()*top)];
  }

  // Hard: aggressively shed cards, including pairs/triples, while preserving
  // stronger combinations when they are more valuable than the current play.
  candidates.sort((a,b)=>playScore(b)-playScore(a));
  return candidates[0];
}
function advisorCandidates(room,p){
  if(!room.started||room.gameOver||room.betting||p.eliminated||room.turn!==room.players.findIndex(x=>x.id===p.id))return [];
  return botCandidates(room.hands[p.id]||[],room.current,room.firstPlay);
}
function bestPlay(room,p){
  const candidates=advisorCandidates(room,p);if(!candidates.length)return [];
  // Best Play = the cleanest immediate answer: beat the current play with
  // the lowest-strength legal combination, or lead the smallest legal play.
  candidates.sort((a,b)=>{
    const sa=a.combo.strength??0,sb=b.combo.strength??0;
    return sa-sb || a.cards.length-b.cards.length;
  });
  return candidates[0].cards.map(cardId);
}
function optimalPlay(room,p){
  const candidates=advisorCandidates(room,p);if(!candidates.length)return [];
  const hand=room.hands[p.id]||[];
  const scored=candidates.map(c=>{
    const remain=hand.filter(x=>!c.cards.some(y=>cardId(x)===cardId(y)));
    const preserve=handValue(remain);
    const immediate=c.cards.length===hand.length?10000:0;
    const comboBonus={single:0,pair:10,triple:16,straight:14,flush:18,fullHouse:25,four:34,straightFlush:40}[c.combo.type]||0;
    const shedBonus=c.cards.length*12;
    const leadPenalty=!room.current?(c.combo.type==='single'?0:5):0;
    // Favor emptying the hand, shedding cards efficiently, while preserving
    // strong combinations for later turns.
    return {...c,score:immediate+shedBonus+comboBonus-preserve*0.65-leadPenalty};
  });
  scored.sort((a,b)=>b.score-a.score);
  return scored[0].cards.map(cardId);
}
function scheduleBot(room){if(!room||room.gameOver)return;clearTimeout(room.botTimer);if(room.betting){const p=room.players[room.betTurn];if(p?.isBot&&!p.eliminated&&!p.folded)room.botTimer=setTimeout(()=>botBetTurn(room.id),650);return}if(!room.started)return;const p=room.players[room.turn];if(p?.isBot&&!p.eliminated)room.botTimer=setTimeout(()=>botTurn(room.id),700)}
function botBetTurn(roomId){
  const room=rooms.get(roomId);if(!room||!room.betting)return;const p=room.players[room.betTurn];if(!p?.isBot)return;
  const d=botDifficulty(p),cur=room.betContrib[p.id]||0,need=room.betCurrent-cur;let action='call',raiseTo=null;
  if(need>p.chips)action='fold';
  else if(d==='easy'){if(Math.random()<0.08&&room.betCurrent>room.minBet)action='fold';else action='call';}
  else if(d==='medium'){if(Math.random()<0.20&&room.betCurrent<room.maxBet){action='raise';raiseTo=Math.min(room.maxBet,room.betCurrent+Math.max(1,Math.floor(Math.random()*Math.max(2,Math.min(50,room.maxBet-room.betCurrent)))))} }
  else {if(Math.random()<0.42&&room.betCurrent<room.maxBet){action='raise';raiseTo=Math.min(room.maxBet,room.betCurrent+Math.max(1,Math.floor(Math.random()*Math.max(2,room.maxBet-room.betCurrent+1))))}}
  const r=handleBet(room,p,action,raiseTo);if(r.ok){broadcastState(room);scheduleBot(room)}
}
function botTurn(roomId){const room=rooms.get(roomId);if(!room||!room.started||room.gameOver||room.betting)return;const bot=room.players[room.turn];if(!bot?.isBot||bot.eliminated)return;const choice=chooseBotPlay(room,bot);if(choice){const set=new Set(choice.cards.map(cardId));room.hands[bot.id]=room.hands[bot.id].filter(c=>!set.has(cardId(c)));room.current={cards:choice.cards,combo:choice.combo,playerId:bot.id};room.lastPlayer=bot.id;room.passes=0;room.firstPlay=false;addHistory(room,`${bot.name} played`);if(room.hands[bot.id].length===0){finishPlayer(room,bot.id);if(room.gameOver){broadcastState(room);return}room.current=null;room.passes=0;room.lastPlayer=null;room.turn=nextActiveIndex(room,room.turn)}else room.turn=nextActiveIndex(room,room.turn)}else if(room.current){room.passes++;addHistory(room,`${bot.name} passed`);room.turn=nextActiveIndex(room,room.turn);if(room.passes>=activeCount(room)-1){const li=room.players.findIndex(x=>x.id===room.lastPlayer&&!x.eliminated);room.turn=li<0?nextActiveIndex(room,room.turn):li;room.current=null;room.passes=0}}else room.turn=nextActiveIndex(room,room.turn);broadcastState(room);scheduleBot(room)}
function findCard(hand,id){return hand.find(c=>cardId(c)===id)}
function startDos(room){const d=shuffle(deck());room.hands={};room.players.forEach(p=>{room.hands[p.id]=[];p.eliminated=false;p.folded=false;if(p.chips==null)p.chips=room.startingChips});d.forEach((c,i)=>room.hands[room.players[i%room.players.length].id].push(c));room.players.forEach(p=>sortHand(room.hands[p.id]));room.started=true;room.current=null;room.passes=0;room.lastPlayer=null;room.winner=null;room.round=1;room.finished=[];room.gameOver=false;room.pot=0;room.betCurrent=0;room.betContrib={};room.betRaised=false;room.history=[];room.bestPlay=[];const idx=room.players.findIndex(p=>room.hands[p.id].some(c=>c.r==='3'&&c.s==='♣'));room.turn=idx<0?0:idx;startBetting(room)}
function finishPlayer(room,playerId){
  const p=room.players.find(x=>x.id===playerId);if(!p||p.eliminated)return;
  p.eliminated=true;room.finished.push(playerId);room.winner=room.finished[0]||playerId;
  addHistory(room,`${p.name} finished`);
  if(activeCount(room)<=1){
    const last=room.players.find(x=>!x.eliminated);if(last)room.finished.push(last.id);
    room.gameOver=true;room.started=false;room.current=null;room.passes=0;room.lastPlayer=null;clearTimeout(room.botTimer);
    // Pot payout is based on finish position, not on the last player remaining.
    const finishers=room.finished.map(id=>room.players.find(x=>x.id===id)).filter(Boolean);
    const n=room.players.length;
    const percentages=n===4?[0.50,0.30,0.20]:n===3?[0.70,0.30]:n===2?[1]:[1];
    const pot=room.pot;let paid=0;
    finishers.slice(0,percentages.length).forEach((fp,i)=>{
      const share=i===percentages.length-1?pot-paid:Math.floor(pot*percentages[i]);
      fp.chips+=share;paid+=share;
      addHistory(room,`${fp.name} received ${share} chips from the pot`);
    });
    room.pot=0;
  }
}
function resetForPlayAgain(room){clearTimeout(room.botTimer);room.players.forEach(p=>{p.eliminated=false;p.folded=false});startDos(room)}
function leaveRoom(socket){const rid=socket.data.room;if(!rid)return;const room=rooms.get(rid);if(!room)return;room.players=room.players.filter(p=>p.id!==socket.id);delete room.hands[socket.id];socket.leave(rid);socket.data.room=null;if(!room.players.length)rooms.delete(rid);else{if(room.turn>=room.players.length)room.turn=0;room.started=false;room.betting=false;room.current=null;room.winner=null;emitRoom(room);broadcastState(room)}}

io.on('connection',socket=>{
  socket.on('room:create',({name,mode='dos'}={})=>{const id=Math.random().toString(36).slice(2,7).toUpperCase();const room=createRoom(id,mode);rooms.set(id,room);join(socket,room,name)});
  socket.on('room:join',({roomId,name}={})=>{const room=rooms.get(String(roomId||'').toUpperCase());if(!room)return socket.emit('error:msg','Room not found.');if(room.started)return socket.emit('error:msg','Game already started.');if(room.players.length>=4)return socket.emit('error:msg','Room is full.');join(socket,room,name)});
  socket.on('room:settings',settings=>{const room=rooms.get(socket.data.room);if(!room)return;if(room.players[0]?.id!==socket.id)return socket.emit('error:msg','Only the host can change betting settings.');if(room.started)return socket.emit('error:msg','Change settings before starting the game.');const chips=Math.floor(Number(settings?.startingChips));const minBet=Math.floor(Number(settings?.minBet));const maxBet=Math.floor(Number(settings?.maxBet));if(!Number.isFinite(chips)||chips<100||chips>100000)return socket.emit('error:msg','Starting chips must be between 100 and 100,000.');if(!Number.isFinite(minBet)||minBet<1)return socket.emit('error:msg','Minimum bet must be at least 1.');if(!Number.isFinite(maxBet)||maxBet<minBet)return socket.emit('error:msg','Maximum bet must be at least the minimum bet.');if(chips<maxBet+room.ante)return socket.emit('error:msg','Starting chips must cover the maximum bet plus the ante.');room.startingChips=chips;room.minBet=minBet;room.maxBet=maxBet;room.players.forEach(p=>p.chips=chips);addHistory(room,`Host set buy-in ${chips}, min bet ${minBet}, max bet ${maxBet}`);broadcastState(room)});
socket.on('room:addBot',(difficulty='medium')=>{const room=rooms.get(socket.data.room);if(!room)return;if(room.players[0]?.id!==socket.id)return socket.emit('error:msg','Only the host can add a bot.');if(room.started)return socket.emit('error:msg','Game already started.');if(room.players.length>=4)return socket.emit('error:msg','Room is full.');difficulty=['easy','medium','hard'].includes(difficulty)?difficulty:'medium';const id=`bot-${room.id}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;room.players.push({id,name:`Bot ${nextBotNumber(room)}`,difficulty,ready:true,isBot:true,eliminated:false,folded:false,chips:room.startingChips});room.hands[id]=[];broadcastState(room)});
  socket.on('room:removeBot',botId=>{const room=rooms.get(socket.data.room);if(!room)return;if(room.players[0]?.id!==socket.id)return socket.emit('error:msg','Only the host can remove a bot.');if(room.started)return socket.emit('error:msg','Game already started.');const p=room.players.find(x=>x.id===botId);if(!p?.isBot)return socket.emit('error:msg','Bot not found.');room.players=room.players.filter(x=>x.id!==botId);delete room.hands[botId];broadcastState(room)});
  socket.on('game:start',()=>{const room=rooms.get(socket.data.room);if(!room||room.players[0]?.id!==socket.id)return;if(room.players.length<2)return socket.emit('error:msg','Need at least 2 players.');if(room.mode!=='dos')return socket.emit('error:msg','This build currently ships the real-time Pusoy Dos table.');startDos(room);broadcastState(room);scheduleBot(room)});
  socket.on('game:playAgain',()=>{const room=rooms.get(socket.data.room);if(!room||!room.gameOver)return;if(room.players[0]?.id!==socket.id)return socket.emit('error:msg','Only the host can start the next game.');if(room.players.length<2)return socket.emit('error:msg','Need at least 2 players.');resetForPlayAgain(room);broadcastState(room);scheduleBot(room)});
  socket.on('game:bet',payload=>{const room=rooms.get(socket.data.room);if(!room||!room.betting)return;const p=room.players[room.betTurn];if(!p||p.id!==socket.id)return socket.emit('error:msg','It is not your betting turn.');const action=typeof payload==='string'?payload:payload?.action;const raiseTo=typeof payload==='object'?payload?.raiseTo:null;const r=handleBet(room,p,action,raiseTo);if(!r.ok)return socket.emit('error:msg',r.msg);broadcastState(room);scheduleBot(room)});
  socket.on('game:play',ids=>{const room=rooms.get(socket.data.room);if(!room||!room.started||room.gameOver||room.betting)return;const p=room.players[room.turn];if(!p||p.id!==socket.id)return socket.emit('error:msg','It is not your turn.');const hand=room.hands[socket.id]||[];const cards=(ids||[]).map(id=>findCard(hand,id)).filter(Boolean);if(cards.length!==(ids||[]).length)return socket.emit('error:msg','Invalid card selection.');const v=validPlay(cards,room.current,room.firstPlay);if(!v.ok)return socket.emit('error:msg',v.msg);const set=new Set(cards.map(cardId));room.hands[socket.id]=hand.filter(c=>!set.has(cardId(c)));room.current={cards,combo:v.combo,playerId:socket.id};room.lastPlayer=socket.id;room.passes=0;addHistory(room,`${p.name} played`);room.firstPlay=false;if(room.hands[socket.id].length===0){finishPlayer(room,p.id);if(room.gameOver){broadcastState(room);return}room.current=null;room.passes=0;room.lastPlayer=null;room.turn=nextActiveIndex(room,room.turn)}else room.turn=nextActiveIndex(room,room.turn);broadcastState(room);scheduleBot(room)});
  socket.on('game:pass',()=>{const room=rooms.get(socket.data.room);if(!room||!room.started||room.gameOver||room.betting)return;const p=room.players[room.turn];if(!p||p.id!==socket.id)return socket.emit('error:msg','It is not your turn.');if(!room.current)return socket.emit('error:msg','You cannot pass when leading.');room.passes++;addHistory(room,`${p.name} passed`);room.turn=nextActiveIndex(room,room.turn);if(room.passes>=activeCount(room)-1){const li=room.players.findIndex(x=>x.id===room.lastPlayer&&!x.eliminated);room.turn=li<0?nextActiveIndex(room,room.turn):li;room.current=null;room.passes=0}broadcastState(room);scheduleBot(room)});
  socket.on('disconnect',()=>leaveRoom(socket));
});
function join(socket,room,name){name=String(name||'Player').trim().slice(0,18)||'Player';const p={id:socket.id,name,ready:true,isBot:false,eliminated:false,folded:false,chips:room.startingChips};room.players.push(p);socket.join(room.id);socket.data.room=room.id;socket.emit('joined',{roomId:room.id});broadcastState(room)}
const PORT=process.env.PORT||3000;server.listen(PORT,()=>console.log(`Pusoy Online running on :${PORT}`));
