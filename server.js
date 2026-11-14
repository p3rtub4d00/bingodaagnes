require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '96kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: true }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });
const PORT = process.env.PORT || 10000;
const MONGO_URI = process.env.MONGODB_URI || '';
let mongoReady = false;
const memory = { guests: new Map(), codes: new Map(), game: freshGame() };
const lastRequests = new Map();

const guestSchema = new mongoose.Schema({
  name: { type: String, required: true, maxlength: 32 },
  deviceHash: { type: String, required: true, unique: true },
  card: { type: [Number], required: true },
  marks: { type: [Number], default: [] },
  round: { type: Number, required: true, default: 1 },
  blocked: { type: Boolean, default: false },
  wins: { type: Number, default: 0 }
}, { timestamps: true });
const codeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  usedBy: { type: String, default: '' },
  usedAt: { type: Date, default: null }
}, { timestamps: true });
const gameSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'main' },
  status: { type: String, default: 'idle' },
  round: { type: Number, default: 1 },
  version: { type: Number, default: 0 },
  pattern: { type: String, enum: ['line','full'], default: 'line' },
  prize: { type: String, default: 'Prêmio Surpresa #01' },
  drawn: { type: [Number], default: [] },
  lastBall: { type: Number, default: null },
  winner: { type: mongoose.Schema.Types.Mixed, default: null },
  registrationOpen: { type: Boolean, default: true },
  inviteOnly: { type: Boolean, default: false },
  autoEnabled: { type: Boolean, default: false },
  autoIntervalSec: { type: Number, default: 10 },
  nextAutoDrawAt: { type: Date, default: null }
});
const Guest = mongoose.model('BingoGuest', guestSchema);
const AccessCode = mongoose.model('BingoCode', codeSchema);
const Game = mongoose.model('BingoGame', gameSchema);
function freshGame() {
  return { key:'main', status:'idle', round:1, version:0, pattern:'line', prize:'Prêmio Surpresa #01',
    drawn:[], lastBall:null, winner:null, registrationOpen:true, inviteOnly:false,
    autoEnabled:false, autoIntervalSec:10, nextAutoDrawAt:null };
}
const doc = x => x && typeof x.toObject === 'function' ? x.toObject() : x;
const id = x => String(x?._id || x?.id || x || '');
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const clean = (x,limit=48) => String(x??'').replace(/[\u0000-\u001f<>]/g,'').replace(/\s+/g,' ').trim().slice(0,limit);
const fail = (res,message,status=400) => res.status(status).json({error:message});
const route = fn => (req,res,next) => Promise.resolve(fn(req,res)).catch(next);
function safeCompare(a,b) {
  const x=Buffer.from(String(a)),y=Buffer.from(String(b));
  return x.length===y.length && crypto.timingSafeEqual(x,y);
}
function getCookie(req,name) {
  const found = (req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='));
  return found?found.slice(name.length+1):'';
}
function deviceHash(req,res) {
  let device=getCookie(req,'bingo_device');
  if (!/^[a-f0-9]{64}$/.test(device)) {
    device=crypto.randomBytes(32).toString('hex');
    res.cookie('bingo_device',device,{httpOnly:true,secure:process.env.NODE_ENV==='production',
      sameSite:'lax',maxAge:180*86400000,path:'/'});
  }
  return sha(device);
}
function getDeviceHash(req) {
  const c=getCookie(req,'bingo_device');
  return /^[a-f0-9]{64}$/.test(c)?sha(c):null;
}
function throttle(key,ms) {
  const now=Date.now(),prior=lastRequests.get(key)||0;
  if(now-prior<ms)return true;
  lastRequests.set(key,now);
  if(lastRequests.size>2500)for(const [k,v] of lastRequests)if(now-v>120000)lastRequests.delete(k);
  return false;
}
function adminToken(payload) {
  const txt=Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac=crypto.createHmac('sha256',process.env.SESSION_SECRET||'').update(txt).digest('base64url');
  return txt+'.'+mac;
}
function isAdmin(req) {
  if(!process.env.SESSION_SECRET)return false;
  const token=getCookie(req,'bingo_admin').split('.');
  if(token.length!==2)return false;
  const mac=crypto.createHmac('sha256',process.env.SESSION_SECRET).update(token[0]).digest('base64url');
  if(!safeCompare(mac,token[1]))return false;
  try {
    const data=JSON.parse(Buffer.from(token[0],'base64url'));
    return data.role==='admin' && data.exp>Date.now();
  }catch{return false;}
}
function adminOnly(req,res,next) { if(!isAdmin(req))return fail(res,'Acesso administrativo necessário.',401);next(); }
function card() {
  const result=[];
  for(let col=0;col<5;col++){
    const n=Array.from({length:15},(_,i)=>col*15+i+1);
    for(let i=n.length-1;i>0;i--){const j=crypto.randomInt(i+1);[n[i],n[j]]=[n[j],n[i]];}
    result.push(n.slice(0,5));
  }
  const flat=Array.from({length:25},(_,i)=>result[i%5][Math.floor(i/5)]);
  flat[12]=0;
  return flat;
}
function letter(number) {
  return ['B','I','N','G','O'][Math.ceil(number/15)-1] || '';
}
function hasWin(c,marks,drawn,pattern) {
  if(!Array.isArray(c)||c.length!==25||!['line','full'].includes(pattern))return false;
  const called=new Set(drawn||[]);
  const marked=new Set(marks||[]);
  const valid=i=>i===12 || (called.has(c[i]) && marked.has(c[i]));
  // Cartela cheia: 24 números distintos sorteados E marcados (centro é livre).
  // Uma linha completa jamais pode ser declarada vencedora nessa modalidade.
  if(pattern==='full') {
    if(called.size<24)return false;
    return Array.from({length:25},(_,i)=>i).every(valid);
  }
  for(let r=0;r<5;r++){
    if([0,1,2,3,4].every(col=>valid(r*5+col)))return true;
  }
  for(let col=0;col<5;col++){
    if([0,1,2,3,4].every(r=>valid(r*5+col)))return true;
  }
  if([0,6,12,18,24].every(valid)||[4,8,12,16,20].every(valid))return true;
  return false;
}
async function game() {
  if(!mongoReady)return {...memory.game,drawn:[...memory.game.drawn]};
  return Game.findOneAndUpdate({key:'main'},{$setOnInsert:freshGame()},{new:true,upsert:true,lean:true});
}
async function changeGame(g,changes) {
  if(!mongoReady){
    if(memory.game.version!==g.version)return null;
    memory.game={...memory.game,...changes,version:g.version+1};
    return {...memory.game};
  }
  return Game.findOneAndUpdate({key:'main',version:g.version},
    {$set:changes,$inc:{version:1}},{new:true,lean:true});
}
async function guests() {
  if(!mongoReady)return [...memory.guests.values()];
  return Guest.find().sort({createdAt:1}).lean();
}
async function guestFromDevice(device) {
  if(!device)return null;
  if(!mongoReady)return [...memory.guests.values()].find(g=>g.deviceHash===device)||null;
  return Guest.findOne({deviceHash:device}).lean();
}
async function saveGuest(name,device,round) {
  const c=card();
  if(!mongoReady) {
    const g={_id:crypto.randomUUID(),name,deviceHash:device,card:c,marks:[],round,blocked:false,wins:0};
    memory.guests.set(id(g),g); return g;
  }
  return doc(await Guest.create({name,deviceHash:device,card:c,round}));
}
async function updateGuestMark(g,number,marked) {
  if(!mongoReady){
    const old=memory.guests.get(id(g));
    if(!old || old.round!==g.round)return null;
    old.marks=marked?[...new Set([...old.marks,number])]:old.marks.filter(x=>x!==number);
    return old;
  }
  const update=marked?{$addToSet:{marks:number}}:{$pull:{marks:number}};
  return Guest.findOneAndUpdate({_id:id(g),round:g.round},update,{new:true,lean:true});
}
async function incrementWinner(guestId){
  if(!mongoReady){const g=memory.guests.get(guestId);if(g)g.wins++;}
  else await Guest.updateOne({_id:guestId},{$inc:{wins:1}});
}
function publicGuest(g) {
  return {id:id(g),name:g.name,card:g.card,marks:g.marks||[],round:g.round,wins:g.wins||0,blocked:!!g.blocked};
}
async function allCodes(){
  if(!mongoReady)return [...memory.codes.values()];
  return AccessCode.find().sort({createdAt:-1}).lean();
}
function makeCode() {
  const abc='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return 'AG-'+Array.from({length:8},()=>abc[crypto.randomInt(abc.length)]).join('');
}
async function newCodes(count){
  const codes=[];
  for(let i=0;i<count;i++){
    for(let j=0;j<10;j++){
      const code=makeCode();
      try {
        if(!mongoReady){if(memory.codes.has(code))continue;memory.codes.set(code,{code,usedBy:''});}
        else await AccessCode.create({code});
        codes.push(code);break;
      }catch(e){if(e.code!==11000)throw e;}
    }
  }
  return codes;
}
async function useCode(code,device){
  if(!mongoReady){
    const c=memory.codes.get(code);if(!c||c.usedBy)return false;
    c.usedBy=device;return true;
  }
  return !!await AccessCode.findOneAndUpdate({code,usedBy:''},{$set:{usedBy:device,usedAt:new Date()}});
}
async function releaseCode(code,device){
  if(!mongoReady){const c=memory.codes.get(code);if(c?.usedBy===device)c.usedBy='';}
  else await AccessCode.updateOne({code,usedBy:device},{$set:{usedBy:'',usedAt:null}});
}
async function state(){
  const [g,p]=await Promise.all([game(),guests()]);
  return { game:{status:g.status,round:g.round,pattern:g.pattern,prize:g.prize,
    drawn:g.drawn||[],lastBall:g.lastBall,winner:g.winner||null,
    autoEnabled:!!g.autoEnabled,autoIntervalSec:g.autoIntervalSec||10,
    nextAutoDrawAt:g.nextAutoDrawAt||null},
    online:p.length,registered:p.length,databaseConnected:mongoReady,
    registration:{open:g.registrationOpen!==false,inviteOnly:!!g.inviteOnly},
    lastFive:(g.drawn||[]).slice(-5).reverse(),totalDrawn:(g.drawn||[]).length };
}
async function broadcast(){
  io.emit('bingo:state',await state());
}
async function newCards(round){
  const p=await guests();
  if(!mongoReady){
    for(const g of p){const found=memory.guests.get(id(g));found.card=card();found.marks=[];found.round=round;}
  }else if(p.length){
    await Guest.bulkWrite(p.map(g=>({updateOne:{filter:{_id:g._id},update:{$set:{card:card(),marks:[],round}}}})));
  }
}
async function resetAll(){
  if(!mongoReady){memory.guests.clear();memory.codes.clear();memory.game=freshGame();}
  else {
    await Promise.all([Guest.deleteMany({}),AccessCode.deleteMany({}),Game.deleteMany({})]);
    await game();
  }
}

app.get('/health',(req,res)=>res.json({ok:true,databaseConnected:mongoReady,realtime:true}));
app.get('/api/state',route(async(req,res)=>{deviceHash(req,res);res.json(await state());}));
app.get('/api/me',route(async(req,res)=>{
  const g=await guestFromDevice(getDeviceHash(req));
  if(!g)return fail(res,'Cadastre seu nome para receber uma cartela.',401);
  res.json(publicGuest(g));
}));
app.post('/api/join',route(async(req,res)=>{
  const device=deviceHash(req,res);
  if(await guestFromDevice(device))return fail(res,'Este navegador já possui uma cartela. Abra sua cartela existente.',409);
  const g=await game();
  if(g.registrationOpen===false)return fail(res,'Os cadastros foram encerrados pelo anfitrião.',403);
  const name=clean(req.body?.name,32);
  if(name.length<2)return fail(res,'Digite um nome de pelo menos 2 letras.');
  if(throttle('join:'+device,750))return fail(res,'Aguarde um instante para tentar novamente.',429);
  const accessCode=String(req.body?.code||'').trim().toUpperCase();
  let claimed=false;
  if(g.inviteOnly){
    if(!/^AG-[A-HJ-NP-Z2-9]{8}$/.test(accessCode))return fail(res,'Digite o código individual fornecido pelo anfitrião.',403);
    claimed=await useCode(accessCode,device);
    if(!claimed)return fail(res,'Código inválido ou já utilizado.',403);
  }
  let participant;
  try{participant=await saveGuest(name,device,g.round);}
  catch(e){
    if(claimed)await releaseCode(accessCode,device);
    if(e.code===11000)return fail(res,'Já existe um cadastro neste aparelho.',409);
    throw e;
  }
  res.status(201).json(publicGuest(participant));
  await broadcast();
}));
app.post('/api/mark',route(async(req,res)=>{
  const g=await guestFromDevice(getDeviceHash(req));
  if(!g)return fail(res,'Entre no bingo para marcar a cartela.',401);
  if(g.blocked)return fail(res,'Seu acesso foi bloqueado pelo anfitrião.',403);
  const current=await game();
  if(g.round!==current.round)return fail(res,'Cartela antiga. Recarregue a página.',409);
  if(current.status!=='live'&&current.status!=='paused')return fail(res,'Aguarde o início de uma rodada.',409);
  const number=Number(req.body?.number);
  if(!Number.isInteger(number)||number<1||number>75||!g.card.includes(number))return fail(res,'Número não pertence à sua cartela.');
  if(!current.drawn.includes(number))return fail(res,'Este número ainda não foi sorteado.',409);
  const marked=Boolean(req.body?.marked);
  const updated=await updateGuestMark(g,number,marked);
  if(!updated)return fail(res,'A cartela foi renovada. Atualize a página.',409);
  res.json({marks:updated.marks,canClaim:hasWin(updated.card,updated.marks,current.drawn,current.pattern)});
}));
app.post('/api/claim',route(async(req,res)=>{
  const participant=await guestFromDevice(getDeviceHash(req));
  if(!participant)return fail(res,'Cadastre-se antes de pedir bingo.',401);
  if(participant.blocked)return fail(res,'Seu acesso foi bloqueado.',403);
  if(throttle('claim:'+id(participant),900))return fail(res,'Aguarde um instante.',429);
  const current=await game();
  if(current.status!=='live'&&current.status!=='paused')
    return fail(res,current.status==='won'?'Esta rodada já tem vencedor!':'O bingo não está em andamento.',409);
  if(participant.round!==current.round)return fail(res,'Sua cartela não pertence a esta rodada.',409);
  if(!hasWin(participant.card,participant.marks,current.drawn,current.pattern)) {
    const message=current.pattern==='full'
      ? 'Cartela cheia exige os 24 números sorteados e marcados. Ainda não é BINGO!'
      : 'Ainda não completou linha, coluna ou diagonal com números sorteados e marcados.';
    return fail(res,message,400);
  }
  const winner={guestId:id(participant),name:participant.name,round:current.round,prize:current.prize};
  const updated=await changeGame(current,{status:'won',winner,autoEnabled:false,nextAutoDrawAt:null});
  if(!updated)return fail(res,'O bingo foi atualizado. Confira o resultado.',409);
  await incrementWinner(id(participant));
  res.json({ok:true,winner});
  await broadcast();
}));

app.post('/api/admin/login',(req,res)=>{
  if(!process.env.ADMIN_PASSWORD||!process.env.SESSION_SECRET)
    return fail(res,'Configure ADMIN_PASSWORD e SESSION_SECRET no Render.',503);
  if(throttle('login:'+req.ip,1000))return fail(res,'Aguarde antes de tentar novamente.',429);
  if(!safeCompare(req.body?.password||'',process.env.ADMIN_PASSWORD))return fail(res,'Senha incorreta.',401);
  const token=adminToken({role:'admin',exp:Date.now()+12*3600000});
  res.cookie('bingo_admin',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',
    sameSite:'strict',maxAge:12*3600000,path:'/'});
  res.json({ok:true});
});
app.post('/api/admin/logout',(req,res)=>{res.clearCookie('bingo_admin',{path:'/'});res.json({ok:true});});
app.get('/api/admin/data',adminOnly,route(async(req,res)=>{
  const [g,p,c]=await Promise.all([game(),guests(),allCodes()]);
  res.json({game:g,guests:p.map(x=>({id:id(x),name:x.name,wins:x.wins||0,blocked:!!x.blocked,round:x.round,createdAt:x.createdAt})),
    codes:c.map(x=>({code:x.code,used:!!x.usedBy})),databaseConnected:mongoReady});
}));
app.post('/api/admin/config',adminOnly,route(async(req,res)=>{
  const g=await game();
  const pattern=req.body?.pattern;
  if(!['line','full'].includes(pattern))return fail(res,'Escolha linha ou cartela cheia.');
  if(typeof req.body?.registrationOpen!=='boolean'||typeof req.body?.inviteOnly!=='boolean')
    return fail(res,'Configurações inválidas.');
  if(['live','paused','resetting'].includes(g.status) && (pattern!==g.pattern || clean(req.body?.prize,60)!==g.prize))
    return fail(res,'Encerre a rodada antes de alterar prêmio ou regra de vitória.');
  const update={pattern,prize:clean(req.body?.prize,60)||'Prêmio Surpresa',
    registrationOpen:req.body.registrationOpen,inviteOnly:req.body.inviteOnly};
  if(!await changeGame(g,update))return fail(res,'Houve outra alteração. Tente novamente.',409);
  res.json({ok:true});await broadcast();
}));
app.post('/api/admin/codes',adminOnly,route(async(req,res)=>{
  const count=Number(req.body?.count);
  if(!Number.isInteger(count)||count<1||count>100)return fail(res,'Gere de 1 a 100 códigos por vez.');
  if((await allCodes()).length+count>1000)return fail(res,'Limite de 1.000 códigos.');
  const codes=await newCodes(count);res.json({codes});
}));
app.post('/api/admin/guests/:id/block',adminOnly,route(async(req,res)=>{
  if(typeof req.body?.blocked!=='boolean')return fail(res,'Valor inválido.');
  if(!mongoReady){
    const x=memory.guests.get(req.params.id);if(!x)return fail(res,'Convidado não encontrado.',404);
    x.blocked=req.body.blocked;
  }else{
    if(!mongoose.isValidObjectId(req.params.id))return fail(res,'Convidado não encontrado.',404);
    const x=await Guest.findByIdAndUpdate(req.params.id,{$set:{blocked:req.body.blocked}});
    if(!x)return fail(res,'Convidado não encontrado.',404);
  }
  res.json({ok:true});await broadcast();
}));
app.post('/api/admin/start',adminOnly,route(async(req,res)=>{
  const g=await game();
  if(g.status!=='idle')return fail(res,'Inicie apenas uma rodada preparada. Use Nova rodada após terminar.');
  // A seleção visível no Admin é aplicada atomica e obrigatoriamente ao iniciar,
  // mesmo que o organizador não tenha clicado em "Salvar configurações".
  const pattern=req.body?.pattern===undefined?g.pattern:req.body.pattern;
  if(!['line','full'].includes(pattern))return fail(res,'Escolha linha ou cartela cheia.',400);
  const prize=req.body?.prize===undefined?g.prize:(clean(req.body.prize,60)||'Prêmio Surpresa');
  if(!await changeGame(g,{status:'live',pattern,prize,autoEnabled:false,nextAutoDrawAt:null}))return fail(res,'O estado mudou. Tente novamente.',409);
  res.json({ok:true,pattern,prize});await broadcast();
}));
app.post('/api/admin/pause',adminOnly,route(async(req,res)=>{
  const g=await game();if(g.status!=='live')return fail(res,'A rodada não está em andamento.');
  if(!await changeGame(g,{status:'paused',nextAutoDrawAt:null}))return fail(res,'Estado atualizado por outro admin.',409);
  res.json({ok:true});await broadcast();
}));
app.post('/api/admin/resume',adminOnly,route(async(req,res)=>{
  const g=await game();if(g.status!=='paused')return fail(res,'A rodada não está pausada.');
  const nextAutoDrawAt=g.autoEnabled
    ? new Date(Date.now()+(g.autoIntervalSec||10)*1000) : null;
  if(!await changeGame(g,{status:'live',nextAutoDrawAt}))return fail(res,'Estado atualizado por outro admin.',409);
  res.json({ok:true});await broadcast();
}));
// Manual and automatic draws use the same cryptographic RNG and optimistic game version.
async function drawFromGame(current,automatic) {
  if(current.status!=='live')return {error:'Inicie ou retome a rodada para sortear.',status:409};
  if(!automatic && current.autoEnabled)return {error:'Desative o sorteio automático para usar o botão manual.',status:409};
  if(automatic && (!current.autoEnabled || !current.nextAutoDrawAt ||
    Date.now()<new Date(current.nextAutoDrawAt).getTime()))return {error:'Ainda não chegou a hora do próximo sorteio.',status:409};
  const unused=Array.from({length:75},(_,i)=>i+1).filter(x=>!current.drawn.includes(x));
  if(!unused.length)return {error:'Todas as 75 bolinhas já foram sorteadas.',status:400};
  const number=unused[crypto.randomInt(unused.length)];
  const finalBall=unused.length===1;
  const updated=await changeGame(current,{
    drawn:[...current.drawn,number],lastBall:number,
    autoEnabled:automatic && !finalBall,
    nextAutoDrawAt:automatic && !finalBall
      ? new Date(Date.now()+(current.autoIntervalSec||10)*1000):null
  });
  if(!updated)return {error:'Outro sorteio ocorreu. Confira o telão.',status:409};
  await broadcast();
  return {number,letter:letter(number),drawn:updated.drawn.length};
}
app.post('/api/admin/auto',adminOnly,route(async(req,res)=>{
  const g=await game();
  if(typeof req.body?.enabled!=='boolean')return fail(res,'Selecione iniciar ou parar o automático.');
  const interval=Number(req.body?.intervalSec ?? g.autoIntervalSec ?? 10);
  const validIntervals=process.env.NODE_ENV==='test'?[1,5,10,15,20,30]:[5,10,15,20,30];
  if(!validIntervals.includes(interval))return fail(res,'Selecione um intervalo permitido de 5 a 30 segundos.');
  if(req.body.enabled && !['live','paused'].includes(g.status))
    return fail(res,'Inicie a rodada antes de ativar o sorteio automático.',409);
  if(req.body.enabled && g.drawn.length>=75)
    return fail(res,'As 75 bolinhas já foram sorteadas. Inicie outra rodada.',409);
  const updated=await changeGame(g,{
    autoEnabled:req.body.enabled,autoIntervalSec:interval,
    nextAutoDrawAt:req.body.enabled && g.status==='live'
      ? new Date(Date.now()+interval*1000):null
  });
  if(!updated)return fail(res,'O sorteio foi atualizado. Tente novamente.',409);
  res.json({ok:true,enabled:!!updated.autoEnabled,intervalSec:updated.autoIntervalSec,
    nextAutoDrawAt:updated.nextAutoDrawAt});
  await broadcast();
}));
app.post('/api/admin/draw',adminOnly,route(async(req,res)=>{
  if(throttle('draw:'+req.ip,process.env.NODE_ENV==='test'?0:500))
    return fail(res,'Aguarde um instante antes de sortear novamente.',429);
  const result=await drawFromGame(await game(),false);
  if(result.error)return fail(res,result.error,result.status);
  res.json(result);
}));
let autoTickBusy=false;
setInterval(async()=>{
  if(autoTickBusy)return;
  autoTickBusy=true;
  try{
    const g=await game();
    if(g.status==='live' && g.autoEnabled && g.nextAutoDrawAt &&
      Date.now()>=new Date(g.nextAutoDrawAt).getTime()) {
      const result=await drawFromGame(g,true);
      if(result.error && result.status!==409)console.warn('Sorteio automático:',result.error);
    }
  }catch(e){console.error('Erro no sorteio automático:',e);}
  finally{autoTickBusy=false;}
},350).unref();
app.post('/api/admin/next',adminOnly,route(async(req,res)=>{
  const g=await game();
  if(g.status==='resetting')return fail(res,'As cartelas ainda estão sendo preparadas.',409);
  if(['live','paused'].includes(g.status))return fail(res,'Pause e finalize a rodada antes de iniciar outra. Use Encerrar.',409);
  const next=g.round+1;
  if(!await changeGame(g,{status:'resetting',round:next,drawn:[],lastBall:null,winner:null,
    autoEnabled:false,nextAutoDrawAt:null,
    prize:'Prêmio Surpresa #'+String(next).padStart(2,'0')}))
    return fail(res,'O estado foi alterado. Tente novamente.',409);
  await newCards(next);
  const again=await game();
  if(!await changeGame(again,{status:'idle'}))return fail(res,'Falha ao preparar a rodada.',409);
  res.json({ok:true,round:next});await broadcast();
}));
app.post('/api/admin/finish',adminOnly,route(async(req,res)=>{
  const g=await game();
  if(!['live','paused'].includes(g.status))return fail(res,'Não há rodada ativa.');
  if(!await changeGame(g,{status:'finished',autoEnabled:false,nextAutoDrawAt:null}))return fail(res,'Estado atualizado.',409);
  res.json({ok:true});await broadcast();
}));
app.post('/api/admin/reset',adminOnly,route(async(req,res)=>{
  if(req.body?.confirmation!=='ZERAR TUDO')return fail(res,'Confirmação inválida.');
  await resetAll();res.json({ok:true});await broadcast();
}));
app.get(['/telao','/telao/','/admin','/admin/'],(req,res)=>
  res.sendFile(path.join(__dirname,'public/index.html')));
app.use('/api',(req,res)=>fail(res,'Rota não encontrada.',404));
app.use((error,req,res,next)=>{
  console.error('API error:',error);
  if(res.headersSent)return next(error);
  res.status(500).json({error:'Não foi possível concluir a operação. Tente novamente.'});
});
io.on('connection',socket=>{state().then(x=>socket.emit('bingo:state',x)).catch(()=>{});});
async function startup(){
  if(MONGO_URI){
    try{
      await mongoose.connect(MONGO_URI,{serverSelectionTimeoutMS:12000});
      await Promise.all([Guest.init(),Game.init(),AccessCode.init()]);
      mongoReady=true;await game();
      console.log('MongoDB conectado. Cartelas e sorteios persistentes.');
    }catch(e){console.error('MongoDB indisponível. Modo demonstração volátil:',e.message);}
  }else console.warn('MONGODB_URI ausente: dados temporários em memória!');
  server.listen(PORT,'0.0.0.0',()=>console.log('Bingo Surpresa da Agnes ouvindo na porta',PORT));
}
startup();
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));