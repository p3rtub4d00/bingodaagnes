import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const port=16000+Math.floor(Math.random()*1000),base='http://127.0.0.1:'+port;
const child=spawn(process.execPath,['server.js'],{
 env:{...process.env,PORT:String(port),MONGODB_URI:'',NODE_ENV:'test',
 ADMIN_PASSWORD:'senha-teste-de-bingo',SESSION_SECRET:'chave-para-bingo-teste-super-segura-com-40-caracteres'},
 stdio:['ignore','pipe','pipe']
});
let serverErrors='';
child.stderr.on('data',c=>serverErrors+=c.toString());
async function call(path,body,options={}){
 const headers={...options.headers};
 if(body!==undefined)headers['Content-Type']='application/json';
 const response=await fetch(base+path,{
  method:options.method||(body===undefined?'GET':'POST'),headers,
  body:body===undefined?undefined:JSON.stringify(body)});
 let result;try{result=await response.json();}catch{result={};}
 return {response,result};
}
async function wait(){
 for(let i=0;i<100;i++){
  try{if((await call('/health')).response.ok)return;}catch{}
  await new Promise(done=>setTimeout(done,130));
 }
 throw new Error('O servidor não iniciou: '+serverErrors);
}
async function freshDevice(){
 const r=await call('/api/state');
 assert.equal(r.response.status,200);
 const cookie=r.response.headers.get('set-cookie')?.split(';')[0];
 assert.ok(cookie?.startsWith('bingo_device='));
 return {cookie};
}
try{
 await wait();
 assert.equal((await call('/health')).result.databaseConnected,false);
 const aliceH={headers:await freshDevice()};
 const alice=await call('/api/join',{name:'Alice'},aliceH);
 assert.equal(alice.response.status,201);
 assert.equal(alice.result.card.length,25);
 assert.equal(alice.result.card[12],0);
 assert.equal(new Set(alice.result.card.filter(n=>n>0)).size,24);
 for(let c=0;c<5;c++)for(let r=0;r<5;r++){
  const num=alice.result.card[r*5+c];
  if(num)assert.ok(num>c*15&&num<=(c+1)*15);
 }
 const duplicate=await call('/api/join',{name:'Alice clone'},aliceH);
 assert.equal(duplicate.response.status,409,'não pode criar conta duplicada no mesmo navegador');
 const restored=await call('/api/me',undefined,aliceH);
 assert.equal(restored.result.id,alice.result.id,'cartela restaurada pelo cookie');
 const bobH={headers:await freshDevice()};
 const bob=await call('/api/join',{name:'Bob'},bobH);
 assert.equal(bob.response.status,201);
 const loginBad=await call('/api/admin/login',{password:'errada'});
 assert.equal(loginBad.response.status,401);
 await new Promise(done=>setTimeout(done,1050));
 const login=await call('/api/admin/login',{password:'senha-teste-de-bingo'});
 assert.equal(login.response.status,200);
 const admin={headers:{cookie:login.response.headers.get('set-cookie').split(';')[0]}};
 const newCodes=await call('/api/admin/codes',{count:3},admin);
 assert.equal(newCodes.response.status,200);
 assert.equal(newCodes.result.codes.length,3);
 const config=await call('/api/admin/config',{prize:'Surpresa Rosa',pattern:'line',
  registrationOpen:true,inviteOnly:true},admin);
 assert.equal(config.response.status,200);
 const charlieH={headers:await freshDevice()};
 const noCode=await call('/api/join',{name:'Charlie'},charlieH);
 assert.equal(noCode.response.status,403);
 await new Promise(done=>setTimeout(done,800));
 const charlie=await call('/api/join',{name:'Charlie',code:newCodes.result.codes[0]},charlieH);
 assert.equal(charlie.response.status,201);
 const daveH={headers:await freshDevice()};
 const reused=await call('/api/join',{name:'Dave',code:newCodes.result.codes[0]},daveH);
 assert.equal(reused.response.status,403,'códigos de uso único não podem ser reutilizados');
 const closed=await call('/api/admin/config',{prize:'Surpresa Rosa',pattern:'line',
  registrationOpen:false,inviteOnly:true},admin);
 assert.equal(closed.response.status,200);
 const denied=await call('/api/join',{name:'Dave',code:newCodes.result.codes[1]},daveH);
 assert.equal(denied.response.status,403);
 const blocked=await call('/api/admin/guests/'+charlie.result.id+'/block',{blocked:true},admin);
 assert.equal(blocked.response.status,200);
 const started=await call('/api/admin/start',{},admin);assert.equal(started.response.status,200);
 const invalidClaim=await call('/api/claim',{},aliceH);
 assert.equal(invalidClaim.response.status,400);
 const invalidMark=await call('/api/mark',{number:alice.result.card[0],marked:true},aliceH);
 assert.equal(invalidMark.response.status,409,'não é possível marcar número não sorteado');
 const charlieDenied=await call('/api/mark',{number:charlie.result.card[0],marked:true},charlieH);
 assert.equal(charlieDenied.response.status,403);
 const drawn=new Set();
 for(let i=0;i<75;i++){
  const ball=await call('/api/admin/draw',{},admin);
  assert.equal(ball.response.status,200,'sorteio #'+i+' deveria funcionar');
  assert.ok(!drawn.has(ball.result.number),'número não pode se repetir');
  drawn.add(ball.result.number);
 }
 assert.equal(drawn.size,75);
 assert.equal((await call('/api/state')).result.game.drawn.length,75);
 const extra=await call('/api/admin/draw',{},admin);
 assert.equal(extra.response.status,400);
 for(const number of alice.result.card.slice(0,5)){
  const mark=await call('/api/mark',{number,marked:true},aliceH);
  assert.equal(mark.response.status,200);
 }
 const winner=await call('/api/claim',{},aliceH);
 assert.equal(winner.response.status,200);
 assert.equal(winner.result.winner.name,'Alice');
 const duplicateWinner=await call('/api/claim',{},aliceH);
 assert.equal(duplicateWinner.response.status,409);
 const won=await call('/api/state');
 assert.equal(won.result.game.status,'won');
 assert.equal(won.result.game.prize,'Surpresa Rosa');
 const newRound=await call('/api/admin/next',{},admin);
 assert.equal(newRound.response.status,200);
 const aliceNew=await call('/api/me',undefined,aliceH);
 assert.equal(aliceNew.result.round,2);
 assert.equal(aliceNew.result.marks.length,0);
 const secondStart=await call('/api/admin/start',{},admin);assert.equal(secondStart.response.status,200);
 const paused=await call('/api/admin/pause',{},admin);assert.equal(paused.response.status,200);
 const noDraw=await call('/api/admin/draw',{},admin);assert.equal(noDraw.response.status,409);
 const resumed=await call('/api/admin/resume',{},admin);assert.equal(resumed.response.status,200);
 const finish=await call('/api/admin/finish',{},admin);assert.equal(finish.response.status,200);
 console.log('✅ Bingo smoke passed: 75 unique balls, cards, one-device login, invite codes, admin controls, marking, bingo validation, winner, new round.');
}catch(e){console.error('❌ Falha no bingo:',e);process.exitCode=1;}
finally{child.kill('SIGTERM');}
