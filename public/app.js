const socket=io();let state=null,selected=new Set();
const $=id=>document.getElementById(id); const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function showError(msg){$('error').textContent=msg;$('error').classList.remove('hidden');clearTimeout(window.err);window.err=setTimeout(()=>$('error').classList.add('hidden'),2800)}
$('create').onclick=()=>{const name=$('name').value.trim()||'Player';socket.emit('room:create',{name,mode:$('mode').value})};
$('join').onclick=()=>{const name=$('name').value.trim()||'Player';const roomId=$('roomInput').value.trim().toUpperCase();if(!roomId)return showError('Enter a room code.');socket.emit('room:join',{name,roomId})};
$('start').onclick=()=>socket.emit('game:start');
$('play').onclick=()=>{if(selected.size)socket.emit('game:play',[...selected]);else showError('Select your cards first.')};
$('pass').onclick=()=>{selected.clear();socket.emit('game:pass')};
socket.on('joined',({roomId})=>{navigator.clipboard?.writeText(roomId).catch(()=>{});$('roomCode').textContent=roomId;$('roomBadge').classList.remove('hidden');$('lobby').classList.add('hidden');$('game').classList.remove('hidden');});
socket.on('error:msg',showError);socket.on('state',s=>{state=s;render()});socket.on('room:update',r=>{if(state)state.room=r;renderRoom(r)});
function render(){renderRoom(state.room);renderHand(state.hand)}
function renderRoom(r){if(!r)return;$('roomCode').textContent=r.id;$('roomTitle').textContent=`Room ${r.id} · ${r.mode==='dos'?'Pusoy Dos':'Pusoy Way'}`;$('status').textContent=r.winner?`Winner: ${r.players.find(p=>p.id===r.winner)?.name||'Player'}`:(r.started?'Game in progress':'Waiting for players');
$('players').innerHTML=r.players.map(p=>`<div class="player ${p.id===r.turn?'active':''}">${esc(p.name)} · ${p.cardCount} 🂠</div>`).join('');$('turn').textContent=r.winner?'ROUND OVER':(r.started?(r.turn===state?.me?'YOUR TURN':'Waiting for opponent'):'');
$('hint').textContent=r.winner?`${r.players.find(p=>p.id===r.winner)?.name||'Player'} emptied their hand!`:(r.started?(r.current?`Beat ${r.current.combo.type} · ${r.current.cards.length} card${r.current.cards.length>1?'s':''}`:'Lead any valid combination'):'Host can start once at least 2 players join.');
$('start').classList.toggle('hidden',!(r.players[0]?.id===state?.me&&!r.started));$('pass').disabled=!r.started||!r.current||r.turn!==state?.me||!!r.winner;$('play').disabled=!r.started||r.turn!==state?.me||!!r.winner;renderPlayed(r.current?.cards||[])}
function renderPlayed(cards){$('played').innerHTML=cards.map(cardHTML).join('')}
function renderHand(hand){
  // Remove selections for cards that are no longer in our hand.
  // This is important after playing cards: otherwise stale selected IDs
  // are sent on the next turn and the server correctly rejects them as
  // an 'Invalid card selection'.
  const validIds=new Set(hand.map(c=>c.r+c.s));
  selected.forEach(id=>{if(!validIds.has(id)) selected.delete(id);});
  $('handCount').textContent=`${hand.length} card${hand.length!==1?'s':''}`;$('hand').innerHTML=hand.map(c=>cardHTML(c,selected.has(c.r+c.s),true)).join('');document.querySelectorAll('#hand .card').forEach(el=>el.onclick=()=>{const id=el.dataset.id;if(selected.has(id))selected.delete(id);else selected.add(id);renderHand(hand)})}
function cardHTML(c,sel=false,click=false){const red=['♥','♦'].includes(c.s);return `<div class="card ${red?'red':''} ${sel?'selected':''}" data-id="${esc(c.r+c.s)}"><div class="rank">${esc(c.r)}</div><div class="corner">${esc(c.r)}</div><div class="suit">${esc(c.s)}</div></div>`}
