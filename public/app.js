const socket=io();let state=null,selected=new Set(),advisorMode=null;
const $=id=>document.getElementById(id);const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function showError(msg){$('error').textContent=msg;$('error').classList.remove('hidden');clearTimeout(window.err);window.err=setTimeout(()=>$('error').classList.add('hidden'),2800)}
$('create').onclick=()=>{const name=$('name').value.trim()||'Player';socket.emit('room:create',{name,mode:$('mode').value})};
$('join').onclick=()=>{const name=$('name').value.trim()||'Player';const roomId=$('roomInput').value.trim().toUpperCase();if(!roomId)return showError('Enter a room code.');socket.emit('room:join',{name,roomId})};
$('start').onclick=()=>socket.emit('game:start');
$('saveSettings').onclick=()=>{const startingChips=Number($('startingChips').value),minBet=Number($('minBet').value),maxBet=Number($('maxBet').value);socket.emit('room:settings',{startingChips,minBet,maxBet})};
$('addBot').onclick=()=>$('botModal').classList.remove('hidden');
$('closeBotModal').onclick=()=>$('botModal').classList.add('hidden');
document.querySelectorAll('.difficulty').forEach(btn=>btn.onclick=()=>{socket.emit('room:addBot',btn.dataset.difficulty);$('botModal').classList.add('hidden')});
$('botModal').onclick=e=>{if(e.target===$('botModal'))$('botModal').classList.add('hidden')};
$('playAgain').onclick=()=>socket.emit('game:playAgain');
$('play').onclick=()=>{if(selected.size)socket.emit('game:play',[...selected]);else showError('Select your cards first.')};
$('pass').onclick=()=>{selected.clear();advisorMode=null;renderHand(state.hand);renderAdvisor();socket.emit('game:pass')};
$('betCall').onclick=()=>socket.emit('game:bet','call');
$('betRaise').onclick=()=>{const max=state?.room?.maxBet||0;const current=state?.room?.betCurrent||0;const value=prompt(`Raise to an amount above ${current} (maximum ${max}):`,String(Math.min(max,current+20)));if(value===null)return;const raiseTo=Number(value);socket.emit('game:bet',{action:'raise',raiseTo})};
$('betFold').onclick=()=>socket.emit('game:bet','fold');
function useAdvisor(mode){
  const ids=mode==='optimal'?(state?.optimalPlay||[]):(state?.bestPlay||[]);
  if(!ids.length)return;
  selected=new Set(ids);
  advisorMode=mode;
  renderHand(state.hand);
  renderAdvisor();
}
$('optimalBtn').onclick=()=>useAdvisor('optimal');
$('bestBtn').onclick=()=>useAdvisor('best');
socket.on('joined',({roomId})=>{navigator.clipboard?.writeText(roomId).catch(()=>{});$('roomCode').textContent=roomId;$('roomBadge').classList.remove('hidden');$('lobby').classList.add('hidden');$('game').classList.remove('hidden')});
socket.on('error:msg',showError);socket.on('state',s=>{state=s;render()});socket.on('room:update',r=>{if(state)state.room=r;renderRoom(r)});
function render(){renderRoom(state.room);renderHand(state.hand);renderAdvisor()}
function renderHistory(r){const list=$('historyList');if(!list)return;const items=(r?.history||[]).slice().reverse();list.innerHTML=items.length?items.map((h,i)=>`<div class="historyItem"><span class="historyDot"></span><span>${esc(h.text)}</span></div>`).join(''):'<div class="historyEmpty">No actions yet.</div>';list.scrollTop=0}
function renderRoom(r){
 if(!r)return;
 $('roomCode').textContent=r.id;$('roomTitle').textContent=`Room ${r.id} · ${r.mode==='dos'?'Pusoy Dos':'Pusoy Way'}`;
 const isHost=r.players[0]?.id===state?.me,me=r.players.find(p=>p.id===state?.me),isMyBetTurn=r.betting&&r.betTurn===state?.me;
 const firstWinner=r.finished?.length?r.players.find(p=>p.id===r.finished[0]):null;
 $('status').textContent=r.gameOver?'GAME OVER':r.betting?'OPEN BETTING':(firstWinner&&r.started?`${firstWinner.name} finished!`:(r.started?'Game in progress':'Waiting for players'));
 $('players').innerHTML=r.players.map(p=>`<div class="player ${p.id===r.turn&&!p.eliminated&&!r.betting?'active':''} ${p.eliminated?'eliminated':''}"><span>${p.isBot?'🤖':'👤'} ${esc(p.name)}</span><span class="difficultyBadge ${p.isBot?(p.difficulty||'medium'):''}">${p.isBot?(p.difficulty||'medium'):'human'}</span><span>${p.eliminated?'✓ OUT':'🂠 '+p.cardCount}</span><span>💰 ${p.chips}</span>${p.isBot&&!r.started&&isHost?`<button class="removeBot" data-bot="${esc(p.id)}" title="Remove ${esc(p.name)}">×</button>`:''}</div>`).join('');
 document.querySelectorAll('.removeBot').forEach(b=>b.onclick=()=>socket.emit('room:removeBot',b.dataset.bot));
 $('turn').textContent=r.gameOver?'GAME OVER':r.betting?(isMyBetTurn?'YOUR BET':'Betting in progress'):(r.started?(r.turn===state?.me?'YOUR TURN':'Waiting for opponent'):'');
 const finishNames=(r.finished||[]).map(id=>r.players.find(p=>p.id===id)?.name).filter(Boolean);
 $('pot').textContent=`Pot: ${r.pot} chips`;
 $('betRules').textContent=`Ante ${r.ante} · Min ${r.minBet} · Max ${r.maxBet} · Raise freely`;
 const owed=Math.max(0,(r.betCurrent||0)-(r.betContrib?.[state?.me]||0));
 $('betInfo').textContent=r.betting?`Current bet: ${r.betCurrent} · Your call: ${owed} · Max: ${r.maxBet}`:'';
 $('hint').textContent=r.gameOver?`Winner: ${firstWinner?.name||'—'} · Finish order: ${finishNames.join(' → ')}`:r.betting?(isMyBetTurn?`Your turn: call ${owed} or raise to any amount up to ${r.maxBet}.`:'Waiting for the betting turn.'):(firstWinner&&r.started?`${firstWinner.name} emptied their hand and is out! Continue until one player remains.`:(r.started?(r.current?`Beat ${prettyCombo(r.current.combo)} · ${r.current.cards.length} card${r.current.cards.length>1?'s':''}`:'Lead any valid combination'):'Host can start once at least 2 players join.'));
 $('start').classList.toggle('hidden',!(isHost&&!r.started&&!r.gameOver));$('addBot').classList.toggle('hidden',!(isHost&&!r.started&&r.players.length<4&&!r.gameOver));$('playAgain').classList.toggle('hidden',!(isHost&&r.gameOver));
 $('hostSettings').classList.toggle('hidden',!(isHost&&!r.started&&!r.gameOver));
 if(isHost&&!r.started&&!r.gameOver){$('startingChips').value=r.startingChips;$('minBet').value=r.minBet;$('maxBet').value=r.maxBet}
 $('pass').disabled=!r.started||!r.current||r.turn!==state?.me||!!r.gameOver||r.betting;$('play').disabled=!r.started||r.turn!==state?.me||!!r.gameOver||r.betting;
 $('betCall').disabled=!isMyBetTurn||!!r.gameOver;$('betRaise').disabled=!isMyBetTurn||!!r.gameOver||r.betCurrent>=r.maxBet;$('betFold').disabled=!isMyBetTurn||!!r.gameOver;$('betPanel').classList.toggle('hidden',!r.betting);
 renderPlayed(r.current?.cards||[]);renderHistory(r);
}
function formatAdvisorPlay(ids){
  const cards=(state?.hand||[]).filter(c=>ids.includes(c.r+c.s));
  if(!cards.length)return 'No legal play';
  return cards.length===1?`${cards[0].r}${cards[0].s}`:cards.map(c=>c.r+c.s).join(' · ');
}
function sameSelection(ids){
  if(!ids?.length||selected.size!==ids.length)return false;
  return ids.every(id=>selected.has(id));
}
function updateAdvisorButtons(){
  const optimal=$('optimalBtn'),best=$('bestBtn');
  if(!optimal||!best)return;
  optimal.textContent=sameSelection(state?.optimalPlay||[])?'Selected':'Use Optimal';
  best.textContent=sameSelection(state?.bestPlay||[])?'Selected':'Use Best';
  optimal.classList.toggle('advisorActive',sameSelection(state?.optimalPlay||[]));
  best.classList.toggle('advisorActive',sameSelection(state?.bestPlay||[]));
}
function renderAdvisor(){
  const r=state?.room,optimal=state?.optimalPlay||[],best=state?.bestPlay||[];
  const show=!!(r?.started&&!r?.betting&&!r?.gameOver&&r.turn===state?.me&&(optimal.length||best.length));
  $('advisor').classList.toggle('hidden',!show);
  if(!show){advisorMode=null;return}
  $('optimalText').textContent=formatAdvisorPlay(optimal);
  $('bestText').textContent=formatAdvisorPlay(best);
  $('optimalOption').classList.toggle('advisorChosen',sameSelection(optimal));
  $('bestOption').classList.toggle('advisorChosen',sameSelection(best));
  updateAdvisorButtons();
}
function prettyCombo(c){if(!c)return'';return({single:'single',pair:'pair',triple:'triple',straight:'straight',flush:'flush',fullHouse:'full house',four:'four of a kind',straightFlush:'straight flush'})[c.type]||c.type}
function renderPlayed(cards){$('played').innerHTML=cards.map(cardHTML).join('')}
function renderHand(hand){
  const validIds=new Set(hand.map(c=>c.r+c.s));
  selected.forEach(id=>{if(!validIds.has(id))selected.delete(id)});
  $('handCount').textContent=`${hand.length} card${hand.length!==1?'s':''}`;
  $('hand').innerHTML=hand.map(c=>cardHTML(c,selected.has(c.r+c.s))).join('');
  document.querySelectorAll('#hand .card').forEach(el=>el.onclick=()=>{
    const id=el.dataset.id;
    if(selected.has(id))selected.delete(id);else selected.add(id);
    advisorMode=null;
    renderHand(hand);
    renderAdvisor();
  });
}
function cardHTML(c,sel=false){
  const red=['♥','♦'].includes(c.s);
  return `<div class="card ${red?'red':''} ${sel?'selected':''}" data-id="${esc(c.r+c.s)}">${sel?'<span class="selectedMark">✓</span>':''}<div class="rank">${esc(c.r)}</div><div class="corner">${esc(c.r)}</div><div class="suit">${esc(c.s)}</div></div>`;
}
