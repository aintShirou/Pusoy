const socket=io();let state=null,selected=new Set();
const $=id=>document.getElementById(id);const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function showError(msg){$('error').textContent=msg;$('error').classList.remove('hidden');clearTimeout(window.err);window.err=setTimeout(()=>$('error').classList.add('hidden'),2800)}
$('create').onclick=()=>{const name=$('name').value.trim()||'Player';socket.emit('room:create',{name,mode:$('mode').value})};
$('join').onclick=()=>{const name=$('name').value.trim()||'Player';const roomId=$('roomInput').value.trim().toUpperCase();if(!roomId)return showError('Enter a room code.');socket.emit('room:join',{name,roomId})};
$('start').onclick=()=>socket.emit('game:start');$('addBot').onclick=()=>socket.emit('room:addBot');$('playAgain').onclick=()=>socket.emit('game:playAgain');
$('play').onclick=()=>{if(selected.size)socket.emit('game:play',[...selected]);else showError('Select your cards first.')};$('pass').onclick=()=>{selected.clear();socket.emit('game:pass')};
$('betCall').onclick=()=>socket.emit('game:bet','call');$('betRaise').onclick=()=>socket.emit('game:bet','raise');$('betFold').onclick=()=>socket.emit('game:bet','fold');
socket.on('joined',({roomId})=>{navigator.clipboard?.writeText(roomId).catch(()=>{});$('roomCode').textContent=roomId;$('roomBadge').classList.remove('hidden');$('lobby').classList.add('hidden');$('game').classList.remove('hidden')});
socket.on('error:msg',showError);socket.on('state',s=>{state=s;render()});socket.on('room:update',r=>{if(state)state.room=r;renderRoom(r)});
function render(){renderRoom(state.room);renderHand(state.hand)}
function renderRoom(r){if(!r)return;$('roomCode').textContent=r.id;$('roomTitle').textContent=`Room ${r.id} · ${r.mode==='dos'?'Pusoy Dos':'Pusoy Way'}`;
const lastFinished=r.winner?r.players.find(p=>p.id===r.winner):null;const me=r.players.find(p=>p.id===state?.me);const isMyBetTurn=r.betting&&r.betTurn===state?.me;
$('status').textContent=r.gameOver?'GAME OVER':r.betting?'BETTING ROUND':(r.winner&&r.started?`${lastFinished?.name||'Player'} finished!`:(r.started?'Game in progress':'Waiting for players'));
$('players').innerHTML=r.players.map(p=>`<div class="player ${p.id===r.turn&&!p.eliminated&&!r.betting?'active':''} ${p.eliminated?'eliminated':''}">${p.isBot?'🤖':'👤'} ${esc(p.name)} ${p.eliminated?'✓':''} · ${p.cardCount} 🂠 · ${p.chips} chips ${p.isBot&&!r.started&&state?.me===r.players[0]?.id?`<button class="removeBot" data-bot="${esc(p.id)}">Remove</button>`:''}</div>`).join('');
document.querySelectorAll('.removeBot').forEach(b=>b.onclick=()=>socket.emit('room:removeBot',b.dataset.bot));
$('turn').textContent=r.gameOver?'GAME OVER':r.betting?(isMyBetTurn?'YOUR BET':'Betting in progress'):(r.started?(r.turn===state?.me?'YOUR TURN':'Waiting for opponent'):'' );
const finishNames=(r.finished||[]).map(id=>r.players.find(p=>p.id===id)?.name).filter(Boolean);
$('pot').textContent=`Pot: ${r.pot} chips`;$('betInfo').textContent=r.betting?`Current bet: ${r.betCurrent} · Ante: ${r.ante} · Raise: +${r.betSize}`:'';
$('hint').textContent=r.gameOver?`Game over. Finish order: ${finishNames.join(' → ')}`:r.betting?(isMyBetTurn?`Your turn to bet. Call ${Math.max(0,r.betCurrent-(r.betContrib?.[state.me]||0))}, raise by ${r.betSize}, or fold.`:'Waiting for the betting round to finish.'):(r.winner&&r.started?`${lastFinished?.name||'Player'} emptied their hand and is out! Continue until one player remains.`:(r.started?(r.current?`Beat ${prettyCombo(r.current.combo)} · ${r.current.cards.length} card${r.current.cards.length>1?'s':''}`:'Lead any valid combination'):'Host can start once at least 2 players join.'));
$('start').classList.toggle('hidden',!(r.players[0]?.id===state?.me&&!r.started&&!r.gameOver));$('addBot').classList.toggle('hidden',!(r.players[0]?.id===state?.me&&!r.started&&r.players.length<4&&!r.gameOver));$('playAgain').classList.toggle('hidden',!(r.players[0]?.id===state?.me&&r.gameOver));
$('pass').disabled=!r.started||!r.current||r.turn!==state?.me||!!r.gameOver||r.betting;$('play').disabled=!r.started||r.turn!==state?.me||!!r.gameOver||r.betting;
['betCall','betRaise','betFold'].forEach(id=>$(id).disabled=!isMyBetTurn||!!r.gameOver);$('betPanel').classList.toggle('hidden',!r.betting);renderPlayed(r.current?.cards||[])}
function prettyCombo(c){if(!c)return'';return({single:'single',pair:'pair',triple:'triple',straight:'straight',flush:'flush',fullHouse:'full house',four:'four of a kind',straightFlush:'straight flush'})[c.type]||c.type}
function renderPlayed(cards){$('played').innerHTML=cards.map(cardHTML).join('')}
function renderHand(hand){const validIds=new Set(hand.map(c=>c.r+c.s));selected.forEach(id=>{if(!validIds.has(id))selected.delete(id)});$('handCount').textContent=`${hand.length} card${hand.length!==1?'s':''}`;$('hand').innerHTML=hand.map(c=>cardHTML(c,selected.has(c.r+c.s),true)).join('');document.querySelectorAll('#hand .card').forEach(el=>el.onclick=()=>{const id=el.dataset.id;if(selected.has(id))selected.delete(id);else selected.add(id);renderHand(hand)})}
function cardHTML(c,sel=false){const red=['♥','♦'].includes(c.s);return `<div class="card ${red?'red':''} ${sel?'selected':''}" data-id="${esc(c.r+c.s)}"><div class="rank">${esc(c.r)}</div><div class="corner">${esc(c.r)}</div><div class="suit">${esc(c.s)}</div></div>`}
