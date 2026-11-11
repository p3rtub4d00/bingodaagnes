(() => {
'use strict';
const $=id=>document.getElementById(id);
const view=location.pathname.startsWith('/admin')?'admin':location.pathname.startsWith('/telao')?'tv':'guest';
const escapeHTML=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const roundNo=v=>String(v||1).padStart(2,'0');
const letter=n=>['B','I','N','G','O'][Math.ceil(n/15)-1]||'';
const statusName=v=>({idle:'Aguardando',live:'Ao vivo',paused:'Pausado',won:'Bingo validado!',finished:'Encerrado',resetting:'Preparando'})[v]||'Aguardando';
const state={game:null,me:null,admin:null,sound:false,voices:[],audioContext:null,lastSpoken:'',toastTimer:null,busy:false,lastAdminRefresh:0,lastMeRefresh:0,adminFormDirty:false};
function toast(message,error=false) {
 const el=$('toast');el.textContent=message;el.classList.toggle('error',error);el.hidden=false;
 clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>el.hidden=true,4200);
}
async function api(endpoint,body,opts={}) {
 const headers={...opts.headers};
 if(body!==undefined)headers['Content-Type']='application/json';
 let res;
 try{res=await fetch('/api'+endpoint,{method:opts.method||(body===undefined?'GET':'POST'),credentials:'same-origin',
  headers,body:body===undefined?undefined:JSON.stringify(body)});}
 catch{throw new Error('Sem conexão com o servidor. Confira sua internet.');}
 let json;try{json=await res.json();}catch{json={};}
 if(!res.ok){const e=new Error(json.error||'Não foi possível concluir a operação.');e.status=res.status;throw e;}
 return json;
}
function hasBingo() {
 const g=state.game?.game,m=state.me;if(!g||!m||m.round!==g.round)return false;
 const called=new Set(g.drawn||[]),marks=new Set(m.marks||[]);
 const marked=i=>i===12||(called.has(m.card[i])&&marks.has(m.card[i]));
 if(g.pattern==='full')return Array.from({length:25},(_,i)=>i).every(marked);
 for(let r=0;r<5;r++)if([0,1,2,3,4].every(c=>marked(r*5+c)))return true;
 for(let c=0;c<5;c++)if([0,1,2,3,4].every(r=>marked(r*5+c)))return true;
 return [0,6,12,18,24].every(marked)||[4,8,12,16,20].every(marked);
}
function pill(n,extra='') {
 return '<span class="mini-ball '+extra+'" aria-label="'+letter(n)+' '+n+'">'+letter(n)+String(n).padStart(2,'0')+'</span>';
}
function applyState(next){
 if(!next?.game)return;
 const old=state.game?.game||null;
 const freshDraw=old && old.round===next.game.round && next.game.lastBall && next.game.lastBall!==old.lastBall;
 const won=old && old.round===next.game.round && old.status!=='won' && next.game.status==='won';
 const reset=old && old.round!==next.game.round;
 state.game=next;
 if(view==='tv'){
  renderTV();
  if(freshDraw && state.sound)speakBall(next.game.lastBall);
  if(won && state.sound)speak('Bingo! '+next.game.winner?.name+' completou a cartela! Parabéns! Você ganhou '+next.game.prize+'!');
 }else if(view==='guest'){
  renderGuest();
  if(reset||won||state.me?.round!==next.game.round)loadMe(false);
 }else {
  renderAdminLive();
  if(!state.lastAdminRefresh||Date.now()-state.lastAdminRefresh>1500)loadAdmin(false);
 }
}
async function refreshState(){try{applyState(await api('/state'));}catch(e){if(!state.game)toast(e.message,true);}}
async function loadMe(announceError=true){
 try{state.me=await api('/me');state.lastMeRefresh=Date.now();if(view==='guest')renderGuest();}
 catch(e){
  if(e.status===401){state.me=null;state.lastMeRefresh=Date.now();renderGuest();}
  else if(announceError)toast(e.message,true);
 }
}
function renderGuest(){
 const me=state.me,game=state.game?.game||{drawn:[],status:'idle',round:1,pattern:'line'};
 $('joinPanel').hidden=!!me;$('guestDashboard').hidden=!me;
 const registration=state.game?.registration||{open:true,inviteOnly:false};
 $('joinCodeWrap').hidden=!registration.inviteOnly;
 $('joinCode').required=!!registration.inviteOnly;
 $('joinClosedNotice').hidden=registration.open!==false;
 $('joinBtn').disabled=registration.open===false;
 if(!me)return;
 $('welcomeName').textContent='Olá, '+me.name+'!';
 $('guestRound').textContent=roundNo(game.round);
 $('guestGameStatus').className='status-pill '+game.status;
 $('guestGameStatus').textContent=statusName(game.status);
 $('guestLastBall').textContent=game.lastBall?letter(game.lastBall)+' - '+game.lastBall:'Aguardando';
 $('guestProgress').textContent=(game.drawn?.length||0)+' de 75 números sorteados';
 const called=new Set(game.drawn||[]),marks=new Set(me.marks||[]);
 const wrongRound=me.round!==game.round;
 const validCount=(me.card||[]).filter((n,i)=>i!==12&&called.has(n)&&marks.has(n)).length;
 const full=game.pattern==='full';
 $('guestRuleBadge').textContent=full
   ? '🏆 CARTELA CHEIA: os 24 números precisam ser sorteados e marcados'
   : '🏆 REGRA DA RODADA: linha, coluna ou diagonal';
 $('guestMarkProgress').textContent=full
   ? validCount+' de 24 números sorteados e marcados para ganhar'
   : validCount+' números sorteados e marcados na sua cartela';
 $('bingoCells').innerHTML=(me.card||[]).map((number,i)=>{
  if(i===12)return '<div class="bingo-cell free marked" aria-label="Casa livre">⭐</div>';
  const isCalled=called.has(number),isMarked=marks.has(number);
  return '<button type="button" data-number="'+number+'" class="bingo-cell'+(isCalled&&isMarked?' marked':'')+(!isCalled?' not-called':'')+'"'+
    (!isCalled||wrongRound||me.blocked||!['live','paused'].includes(game.status)?' disabled':'')+
    ' aria-pressed="'+!!isMarked+'" title="'+(isCalled?'Toque para marcar ou desmarcar':'Ainda não sorteado')+'">'+
    String(number).padStart(2,'0')+'</button>';
 }).join('');
 $('guestDrawn').innerHTML=(game.drawn||[]).length?game.drawn.slice().reverse().map(x=>pill(x)).join(''):'<span class="empty-message">O sorteio ainda vai começar!</span>';
 const ready=hasBingo(),done=game.status==='won'||game.status==='finished';
 $('claimBtn').disabled=!ready||!['live','paused'].includes(game.status)||wrongRound||me.blocked;
 $('claimBtn').textContent=done?'🏆 RODADA ENCERRADA':ready?'🎉 BINGO! CONFIRMAR':'🏆 BINGO!';
 const reason=me.blocked?'Sua cartela foi bloqueada pelo anfitrião.':
   wrongRound?'Preparando sua nova cartela...':
   game.status==='won'?('🎉 '+game.winner?.name+' venceu '+game.prize+'!'):
   game.status==='finished'?'Esta rodada foi encerrada. Aguarde a próxima.':
   game.status==='idle'?'Aguarde o anfitrião iniciar o sorteio!':
   game.pattern==='full'?(ready?'🎉 Todos os 24 números completos! Confirme seu BINGO!':'Cartela cheia: faltam '+(24-validCount)+' números sorteados e marcados.'):
   ready?'🎉 Você completou uma combinação! Clique em BINGO!':'Complete uma linha, coluna ou diagonal para ganhar!';
 $('claimHelp').textContent=reason;
}
async function markCell(number) {
 if(state.busy)return;state.busy=true;
 const pressed=state.me?.marks?.includes(number)||false;
 try{
  const result=await api('/mark',{number,marked:!pressed});
  state.me.marks=result.marks;
  renderGuest();
  if(result.canClaim)toast('🎊 Cartela completa! Aperte BINGO para conferir!');
 }catch(e){toast(e.message,true);await Promise.all([refreshState(),loadMe(false)]);}
 finally{state.busy=false;}
}
function initGuest(){
 $('guestView').hidden=false;
 $('joinForm').addEventListener('submit',async e=>{
  e.preventDefault();const btn=$('joinBtn');btn.disabled=true;
  try{
   const me=await api('/join',{name:$('joinName').value.trim(),code:$('joinCode').value.trim().toUpperCase()});
   state.me=me;toast('Sua cartela chegou! Boa sorte, '+me.name+'! 🎉');
   await Promise.all([refreshState(),loadMe(false)]);
  }catch(err){toast(err.message,true);if(err.status===409)await loadMe(false);}
  finally{btn.disabled=false;renderGuest();}
 });
 $('bingoCells').addEventListener('click',e=>{
  const cell=e.target.closest('[data-number]');
  if(cell && !cell.disabled)markCell(Number(cell.dataset.number));
 });
 $('claimBtn').addEventListener('click',async()=>{
  const btn=$('claimBtn');btn.disabled=true;
  try{const r=await api('/claim',{});toast('🏆 BINGO VALIDADO! Parabéns, '+r.winner.name+'!');await refreshState();}
  catch(e){toast(e.message,true);await refreshState();}
  finally{renderGuest();}
 });
 refreshState().then(()=>loadMe(false));
}
function chooseVoice(){
 const voices=('speechSynthesis' in window)?speechSynthesis.getVoices():[];
 return voices.find(v=>v.lang.toLowerCase()==='pt-br')||voices.find(v=>v.lang.toLowerCase().startsWith('pt'))||null;
}
function speak(phrase){
 if(!state.sound||!('speechSynthesis' in window))return;
 try{
  speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(String(phrase));
  u.lang='pt-BR';u.rate=.95;u.pitch=1.12;u.volume=1;
  const voice=chooseVoice();if(voice)u.voice=voice;
  speechSynthesis.speak(u);
 }catch(e){toast('Seu navegador não conseguiu reproduzir a narração.',true);}
}
function speakBall(n){
 const names={B:'Bê',I:'I',N:'Ene',G:'Gê',O:'Ó'};
 speak('Atenção! Saiu a bolinha '+names[letter(n)]+', '+n+'! Repetindo: '+names[letter(n)]+', '+n+'!');
}
function renderTV(){
 const data=state.game,game=data?.game||{status:'idle',round:1,drawn:[],pattern:'line',prize:'Prêmio Surpresa #01'};
 $('tvState').textContent=game.status==='live'?'SORTEIO AO VIVO':game.status==='paused'?'SORTEIO PAUSADO':game.status==='won'?'TEMOS UM BINGO!':game.status==='finished'?'RODADA ENCERRADA':'AGUARDANDO SORTEIO';
 $('tvRound').textContent=roundNo(game.round);
 $('tvPattern').textContent=game.pattern==='full'?'Cartela cheia':'Linha / coluna';
 $('tvPrize').textContent=game.prize;
 $('tvBallLetter').textContent=game.lastBall?letter(game.lastBall):'?';
 $('tvBallNumber').textContent=game.lastBall?String(game.lastBall).padStart(2,'0'):'--';
 $('tvLastFive').innerHTML=(data?.lastFive||[]).length?data.lastFive.map(x=>pill(x)).join(''):'<span class="tv-empty">Aguardando bolinhas...</span>';
 $('tvCalledGrid').innerHTML=game.drawn.length?game.drawn.map(n=>pill(n)).join(''):'<span class="tv-empty">O sorteio começará em instantes!</span>';
 $('tvGuestCount').textContent=(data?.registered||0)+' convidados';
 $('tvWinner').hidden=game.status!=='won'||!game.winner;
 if(!$('tvWinner').hidden){$('tvWinnerName').textContent=game.winner.name;$('tvWinnerPrize').textContent=game.prize;}
}
function initTV(){
 $('tvView').hidden=false;
 $('tvFullscreen').addEventListener('click',async()=>{
  try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();}
  catch(e){toast('Seu navegador não permite tela cheia.',true);}
 });
 $('tvAudio').addEventListener('click',()=>{
  if(!('speechSynthesis' in window)){toast('Narração não disponível nesta TV. Abra o telão em um navegador compatível.',true);return;}
  state.sound=!state.sound;
  $('tvAudio').textContent=state.sound?'🔊 Narração ligada':'🔇 Ativar narração';
  if(state.sound)speak('Bingo Surpresa da Agnes! Narração ativada. Boa sorte, pessoal!');
  else speechSynthesis.cancel();
 });
 refreshState();
}
async function loadAdmin(alert=false){
 try{
  const data=await api('/admin/data');state.admin=data;state.lastAdminRefresh=Date.now();
  $('adminLogin').hidden=true;$('adminDashboard').hidden=false;$('adminLogout').hidden=false;
  renderAdmin();
 }catch(e){
  if(e.status===401){state.admin=null;$('adminLogin').hidden=false;$('adminDashboard').hidden=true;$('adminLogout').hidden=true;}
  else if(alert)toast(e.message,true);
 }
}
function renderAdminLive(){
 const g=state.game?.game;if(!g||!state.admin)return;
 $('adminMetricGuests').textContent=state.game.registered;
 $('adminMetricDrawn').textContent=g.drawn.length+'/75';
 $('adminMetricRound').textContent=roundNo(g.round);
 $('adminMetricStatus').textContent=statusName(g.status);
 $('adminLiveChip').textContent=statusName(g.status);$('adminLiveChip').className='status-pill '+g.status;
 $('adminBall').textContent=g.lastBall?letter(g.lastBall)+String(g.lastBall).padStart(2,'0'):'?';
 $('adminLastBall').textContent=g.lastBall?letter(g.lastBall)+' - '+g.lastBall:'Aguardando';
 $('adminPrizeDisplay').textContent=g.prize;
 $('adminEffectivePattern').textContent=g.pattern==='full'
   ? '🏆 CARTELA CHEIA — 24 números marcados e sorteados'
   : '🏆 LINHA, COLUNA OU DIAGONAL';
 $('adminDraw').disabled=g.status!=='live'||g.drawn.length>=75;
 $('adminStart').disabled=g.status!=='idle';
 $('adminPause').disabled=g.status!=='live';
 $('adminResume').disabled=g.status!=='paused';
 $('adminFinish').disabled=!['live','paused'].includes(g.status);
 $('adminNext').disabled=['live','paused','resetting'].includes(g.status);
 $('adminCalled').innerHTML=g.drawn.length?g.drawn.slice().reverse().map(n=>pill(n)).join(''):'<span class="empty-message">Ainda não há números sorteados.</span>';
}
function renderAdmin(){
 if(!state.admin)return;
 $('dbWarning').hidden=!!state.admin.databaseConnected;
 renderAdminLive();
 const g=state.admin.game;
 // Preserve a opção escolhida mesmo quando chega uma bolinha ou outro evento.
 // Antes, a atualização do painel revertia "Cartela cheia" para a regra salva.
 if(!state.adminFormDirty) {
  $('adminPrize').value=g.prize;
  $('adminPattern').value=g.pattern;
  $('adminRegistrationOpen').checked=g.registrationOpen!==false;
  $('adminInviteOnly').checked=!!g.inviteOnly;
 }
 $('adminPrize').disabled=['live','paused','resetting'].includes(g.status);
 $('adminPattern').disabled=['live','paused','resetting'].includes(g.status);
 const codes=state.admin.codes||[],available=codes.filter(c=>!c.used);
 $('adminCodeSummary').textContent=codes.length+' gerados · '+available.length+' disponíveis · '+(codes.length-available.length)+' utilizados';
 $('adminCodes').innerHTML=codes.map(c=>'<span class="code-pill'+(c.used?' used':'')+'">'+escapeHTML(c.code)+(c.used?' ✓':'')+'</span>').join('');
 $('adminGuestsCount').textContent=state.admin.guests.length+' participantes';
 $('adminGuests').innerHTML=state.admin.guests.length?state.admin.guests.map(g=>'<tr><td><b>👤 '+escapeHTML(g.name)+'</b></td><td>'+g.wins+'</td><td>'+(g.blocked?'🚫 Bloqueado':'✅ Ativo')+'</td><td><button type="button" class="block-guest" data-id="'+escapeHTML(g.id)+'" data-blocked="'+!!g.blocked+'">'+(g.blocked?'Desbloquear':'Bloquear')+'</button></td></tr>').join(''):'<tr><td colspan="4" class="empty-message">Nenhum convidado cadastrado ainda.</td></tr>';
}
async function adminPost(path,body={}){
 try{await api('/admin/'+path,body);await Promise.all([refreshState(),loadAdmin(false)]);return true;}
 catch(e){toast(e.message,true);await Promise.all([refreshState(),loadAdmin(false)]);return false;}
}
function initAdmin(){
 $('adminView').hidden=false;
 $('adminLoginForm').addEventListener('submit',async e=>{
  e.preventDefault();const btn=e.submitter||$('adminLoginForm').querySelector('button');btn.disabled=true;
  try{await api('/admin/login',{password:$('adminPassword').value});$('adminPassword').value='';
   await Promise.all([refreshState(),loadAdmin(true)]);toast('Painel liberado! 💜');}
  catch(err){toast(err.message,true);}
  finally{btn.disabled=false;}
 });
 $('adminLogout').addEventListener('click',async()=>{
  await api('/admin/logout',{});state.admin=null;await loadAdmin();toast('Você saiu do painel.');
 });
 $('adminConfigForm').addEventListener('input',()=>{state.adminFormDirty=true;});
 $('adminConfigForm').addEventListener('change',()=>{state.adminFormDirty=true;});
 $('adminConfigForm').addEventListener('submit',async e=>{
  e.preventDefault();
  if(await adminPost('config',{prize:$('adminPrize').value,pattern:$('adminPattern').value,
   registrationOpen:$('adminRegistrationOpen').checked,inviteOnly:$('adminInviteOnly').checked})) {
   state.adminFormDirty=false;
   await loadAdmin(false);
   toast('Configurações salvas! 🎁');
  }
 });
 $('adminStart').addEventListener('click',async()=>{
  const pattern=$('adminPattern').value;
  const prize=$('adminPrize').value;
  if(await adminPost('start',{pattern,prize})) {
   state.adminFormDirty=false;
   await loadAdmin(false);
   toast('Rodada iniciada em '+(pattern==='full'?'CARTELA CHEIA (24 números)':'LINHA/COLUNA/DIAGONAL')+'! 🎱');
  }
 });
 $('adminDraw').addEventListener('click',async()=>{
  if(state.busy)return;state.busy=true;$('adminDraw').disabled=true;
  try{
   const r=await api('/admin/draw',{});toast('Saiu '+r.letter+' '+r.number+'! 🎱');
   await Promise.all([refreshState(),loadAdmin(false)]);
  }catch(e){toast(e.message,true);}
  finally{state.busy=false;renderAdminLive();}
 });
 $('adminPause').addEventListener('click',()=>adminPost('pause').then(ok=>{if(ok)toast('Sorteio pausado.');}));
 $('adminResume').addEventListener('click',()=>adminPost('resume').then(ok=>{if(ok)toast('Sorteio retomado!');}));
 $('adminFinish').addEventListener('click',()=>{
  if(confirm('Encerrar esta rodada sem declarar um vencedor?'))adminPost('finish').then(ok=>{if(ok)toast('Rodada encerrada.');});
 });
 $('adminNext').addEventListener('click',()=>{
  if(confirm('Começar uma nova rodada? Todos os convidados receberão outra cartela e os números anteriores serão limpos.'))
   adminPost('next').then(async ok=>{if(ok){state.adminFormDirty=false;await loadAdmin(false);toast('Novas cartelas preparadas! 🎱');}});
 });
 $('adminGenerateCodes').addEventListener('click',async()=>{
  const count=Number($('adminCodeCount').value);
  if(await adminPost('codes',{count}))toast(count+' códigos criados!');
 });
 $('adminCopyCodes').addEventListener('click',async()=>{
  const values=(state.admin?.codes||[]).filter(c=>!c.used).map(c=>c.code);
  if(!values.length)return toast('Nenhum código disponível.',true);
  try{await navigator.clipboard.writeText(values.join('\n'));toast(values.length+' códigos copiados!');}
  catch{toast('Não foi possível copiar. Selecione na lista.',true);}
 });
 $('adminGuests').addEventListener('click',async e=>{
  const btn=e.target.closest('[data-id]');if(!btn)return;
  const blocked=btn.dataset.blocked==='true';
  if(confirm((blocked?'Desbloquear':'Bloquear')+' convidado?'))
   await adminPost('guests/'+btn.dataset.id+'/block',{blocked:!blocked});
 });
 $('adminReset').addEventListener('click',async()=>{
  const confirmation=prompt('Você perderá todas as cartelas, rodadas, códigos e cadastros. Digite ZERAR TUDO:');
  if(confirmation==='ZERAR TUDO'&&await adminPost('reset',{confirmation}))toast('Todos os dados de teste foram apagados.');
 });
 refreshState();loadAdmin();
}
if(view==='guest')initGuest();
if(view==='tv')initTV();
if(view==='admin')initAdmin();
if(window.io){
 const socket=io({transports:['websocket','polling'],reconnection:true});
 socket.on('bingo:state',applyState);
 socket.on('connect',()=>{refreshState();if(view==='guest')loadMe(false);});
}
setInterval(()=>{
 if(view==='guest' && Date.now()-state.lastMeRefresh>12000)loadMe(false);
 if(view==='admin' && state.admin && Date.now()-state.lastAdminRefresh>12000)loadAdmin(false);
},1000);
setInterval(refreshState,15000);
})();