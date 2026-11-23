// AI coach + local server tests. No real API calls: the Anthropic API is replaced by
// a fake HTTP endpoint (ANTHROPIC_BASE_URL) so the exact request the SDK sends is checked.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {bindings} from '../scripts/local-bindings.mjs';
import worker from '../dist/server/index.js';
import {createCoach,COACH_MODEL} from '../server/coach.mjs';

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'paladin-coach-'));
const profile={name:'Coach QA',realm:'QA',level:14,zone:'Westfall',xp:null,xpMax:null,gold:3,strength:null,agility:null,stamina:null,intellect:null,spirit:null,health:null,mana:null,attackPower:null,armor:null,weaponDps:null,weaponSpeed:null,trainedAt:12,unspentTalents:1,abilities:'Holy Light\nJudgement\nHoly Strike',talents:'',legacy:'',professions:[],gear:{'Main hand':'Rusty Hatchet'},mount:'unknown',notes:'',solo:true};

function workerCall(env){return async(route,method='GET',body,owner='qa-owner')=>{
 const headers=new Headers({'Content-Type':'application/json'});if(owner){headers.set('oai-authenticated-user-id',owner);headers.set('oai-authenticated-user-email','qa@example.test')}if(method!=='GET')headers.set('Origin','https://test.local');
 const res=await worker.fetch(new Request('https://test.local'+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env);
 return {status:res.status,body:await res.json()};
}}

test('coach routes: setup gate, persistence, history, new conversation, limits, isolation',async()=>{
 const dir=path.join(tmp,'worker');let store=bindings(dir);
 const calls=[];
 const fake=async args=>{calls.push(args);return {text:'**Next:** finish Westfall. Answer '+calls.length,model:'claude-sonnet-5-5',usage:{input:100,output:20}}};
 fake.config={model:'claude-sonnet-5-5',effort:'medium'};
 let env={DB:store.DB,BUCKET:store.BUCKET,COACH:fake,COACH_DAILY_LIMIT:'3'};let call=workerCall(env);

 // not configured
 const off=workerCall({DB:store.DB,BUCKET:store.BUCKET});
 assert.equal((await off('/api/state')).body.coach.enabled,false);
 assert.equal((await off('/api/coach','POST',{question:'hi'})).status,503);
 // needs a character, valid question, sign-in
 assert.equal((await call('/api/coach','POST',{question:'hi'})).status,400);
 assert.equal((await call('/api/coach','POST',{question:'hi'},null)).status,401);
 assert.equal((await call('/api/profile','PUT',{profile,revision:0})).status,200);
 assert.equal((await call('/api/coach','POST',{question:'   '})).status,400);
 assert.equal((await call('/api/coach','POST',{question:'x'.repeat(4001)})).status,400);
 assert.equal(calls.length,0);

 let r=await call('/api/coach','POST',{question:'What should I do this session?'});
 assert.equal(r.status,200);
 assert.deepEqual(r.body.coach.messages.map(m=>m.role),['user','assistant']);
 assert.equal(r.body.coach.messages[1].model,'claude-sonnet-5-5');
 assert.equal(r.body.coach.usedToday,1);assert.equal(r.body.coach.dailyLimit,3);assert.equal(r.body.coach.enabled,true);
 assert.equal(calls[0].question,'What should I do this session?');
 assert.deepEqual(calls[0].history,[]);
 assert.match(calls[0].briefing,/Rusty Hatchet/);assert.match(calls[0].briefing,/Allocate 1 unspent talent point/);assert.match(calls[0].briefing,/checked November 22, 2026/);

 r=await call('/api/coach','POST',{question:'And after that?'});
 assert.deepEqual(calls[1].history.map(m=>m.role),['user','assistant']);
 assert.equal(calls[1].history[0].content,'What should I do this session?');
 assert.equal(r.body.coach.messages.length,4);

 // other owner sees nothing
 assert.equal((await call('/api/state','GET',undefined,'other-owner')).body.coach.messages.length,0);

 // survives closing and reopening the database
 store.close();store=bindings(dir);env={...env,DB:store.DB,BUCKET:store.BUCKET};call=workerCall(env);
 assert.equal((await call('/api/state')).body.coach.messages.length,4);

 // new conversation hides old messages from view and from history, keeps the daily count
 r=await call('/api/coach/new','POST',{});
 assert.equal(r.status,200);assert.equal(r.body.coach.messages.length,0);assert.equal(r.body.coach.usedToday,2);
 r=await call('/api/coach','POST',{question:'Fresh start'});
 assert.deepEqual(calls[2].history,[]);assert.equal(r.body.coach.messages.length,2);

 // daily limit (3)
 r=await call('/api/coach','POST',{question:'One more'});
 assert.equal(r.status,429);assert.equal(calls.length,3);

 // failures save nothing; exposed messages reach the user, others are generic
 const failing=async()=>{const e=new Error('The Anthropic API rejected the API key in .env.');e.status=502;e.expose=true;throw e};
 const failEnv=workerCall({DB:store.DB,BUCKET:store.BUCKET,COACH:failing,COACH_DAILY_LIMIT:'50'});
 r=await failEnv('/api/coach','POST',{question:'Will fail'});
 assert.equal(r.status,502);assert.match(r.body.error,/rejected the API key/);
 const crashing=async()=>{throw new TypeError('internal detail')};
 const origErr=console.error;console.error=()=>{};
 r=await workerCall({DB:store.DB,BUCKET:store.BUCKET,COACH:crashing,COACH_DAILY_LIMIT:'50'})('/api/coach','POST',{question:'Will crash'});
 console.error=origErr;
 assert.equal(r.status,502);assert.doesNotMatch(r.body.error,/internal detail/);
 assert.equal((await call('/api/state')).body.coach.messages.length,2);

 // failed calls still count toward the cap; concurrent calls cannot exceed it or interleave
 const d2=path.join(tmp,'worker2'),store2=bindings(d2);let upstream=0;
 const slow=async({question})=>{upstream++;await new Promise(r=>setTimeout(r,60));if(question==='bad'){const e=new Error('declined');e.status=502;e.expose=true;throw e}return {text:'ok',model:'claude-sonnet-5-5',usage:{}}};
 const c2=workerCall({DB:store2.DB,BUCKET:store2.BUCKET,COACH:slow,COACH_DAILY_LIMIT:'3'});
 await c2('/api/profile','PUT',{profile,revision:0});
 const burst=await Promise.all([1,2,3,4,5,6].map(i=>c2('/api/coach','POST',{question:'q'+i})));
 assert.equal(burst.filter(x=>x.status===200).length,1);assert.equal(burst.filter(x=>x.status===409).length,5);assert.equal(upstream,1);
 const pending=c2('/api/coach','POST',{question:'bad'});
 await new Promise(r=>setTimeout(r,20));
 assert.equal((await c2('/api/coach/new','POST',{})).status,409);// no reset while an answer is pending
 assert.equal((await pending).status,502);
 assert.equal((await c2('/api/state')).body.coach.usedToday,2);
 assert.equal((await c2('/api/coach','POST',{question:'bad'})).status,502);
 assert.equal((await c2('/api/coach','POST',{question:'q'})).status,429);assert.equal(upstream,3);
 assert.deepEqual((await c2('/api/state')).body.coach.messages.map(m=>m.role),['user','assistant']);
 store2.close();
 store.close();
});

// ---- fake Anthropic API ----
function fakeApi(handler){
 return new Promise(resolve=>{const requests=[];const s=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const rec={url:req.url,headers:req.headers,body:JSON.parse(body||'{}')};requests.push(rec);const [status,payload]=handler(rec);res.writeHead(status,{'Content-Type':'application/json','request-id':'req_test'});res.end(JSON.stringify(payload))});s.listen(0,'127.0.0.1',()=>resolve({server:s,requests,url:'http://127.0.0.1:'+s.address().port}))});
}
const message=(over={})=>({id:'msg_1',type:'message',role:'assistant',model:'claude-sonnet-5-5',content:[{type:'thinking',thinking:'',signature:'sig'},{type:'text',text:'Train Holy Strike rank 2.'}],stop_reason:'end_turn',stop_sequence:null,stop_details:null,usage:{input_tokens:900,output_tokens:120},...over});

test('coach sends Sonnet 5.5 at medium effort with Sonnet-only fallback, and handles refusals and auth errors',async()=>{
 const api=await fakeApi(rec=>rec.body.messages.at(-1).content.includes('REFUSE')?[200,message({content:[],stop_reason:'refusal',stop_details:{type:'refusal',category:'general_harms',explanation:'x'}})]:rec.body.messages.at(-1).content.includes('CUTOFF')?[200,message({stop_reason:'max_tokens'})]:[200,message()]);
 const prevEffort=process.env.PALADIN_COACH_EFFORT;
 try{
  process.env.PALADIN_COACH_EFFORT='max';// not allowed: must clamp to medium
  const coach=createCoach({apiKey:'sk-ant-test',baseURL:api.url});
  assert.equal(coach.config.effort,'medium');
  const out=await coach({briefing:'LEVEL 14 PALADIN',history:[{role:'user',content:'earlier q'},{role:'assistant',content:'earlier a'}],question:'What now?'});
  assert.equal(out.text,'Train Holy Strike rank 2.');assert.equal(out.model,'claude-sonnet-5-5');assert.deepEqual(out.usage,{input:900,output:120});
  const req=api.requests[0];
  assert.equal(req.url.split('?')[0],'/v1/messages');
  assert.equal(req.body.model,'claude-sonnet-5-5');assert.equal(COACH_MODEL,'claude-sonnet-5-5');
  assert.deepEqual(req.body.output_config,{effort:'medium'});
  assert.equal(req.body.fallbacks,'default');
  assert.match(String(req.headers['anthropic-beta']),/server-side-fallback-2026-07-01/);
  assert.ok(req.headers['x-api-key']==='sk-ant-test'||req.headers.authorization==='Bearer sk-ant-test','API key sent');
  for(const banned of ['thinking','temperature','top_p','top_k','tool_choice'])assert.equal(req.body[banned],undefined,banned);
  assert.ok(req.body.max_tokens<=8000);
  assert.deepEqual(req.body.messages.map(m=>m.role),['user','assistant','user']);
  assert.match(req.body.messages[2].content,/<character_briefing>\nLEVEL 14 PALADIN\n<\/character_briefing>\n\nWhat now\?/);
  assert.match(req.body.system,/Retribution Paladin/);

  process.env.PALADIN_COACH_EFFORT='low';
  const low=createCoach({apiKey:'sk-ant-test',baseURL:api.url});
  await low({briefing:'b',history:[],question:'q'});
  assert.deepEqual(api.requests.at(-1).body.output_config,{effort:'low'});

  await assert.rejects(coach({briefing:'b',history:[],question:'REFUSE'}),e=>e.expose&&e.status===502&&/declined/.test(e.message)&&/general_harms/.test(e.message));
  const cut=await coach({briefing:'b',history:[],question:'CUTOFF'});assert.match(cut.text,/cut off/);
 }finally{if(prevEffort===undefined)delete process.env.PALADIN_COACH_EFFORT;else process.env.PALADIN_COACH_EFFORT=prevEffort;api.server.close()}

 const denied=await fakeApi(()=>[401,{type:'error',error:{type:'authentication_error',message:'invalid x-api-key'}}]);
 try{
  const coach=createCoach({apiKey:'sk-ant-bad',baseURL:denied.url});
  await assert.rejects(coach({briefing:'b',history:[],question:'q'}),e=>e.expose&&/rejected the API key/.test(e.message));
 }finally{denied.server.close()}
 assert.equal(createCoach({apiKey:''}),null);
});

// ---- the real local server process ----
async function startServer(port,dataDir,extraEnv={}){
 const child=spawn(process.execPath,['server/local.mjs'],{env:{...process.env,PORT:String(port),PALADIN_DATA_DIR:dataDir,ANTHROPIC_API_KEY:'',...extraEnv},stdio:['ignore','pipe','pipe']});
 let out='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>out+=d);
 for(let i=0;i<100&&!out.includes('is running at');i++)await new Promise(r=>setTimeout(r,50));
 assert.match(out,/is running at http:\/\/127\.0\.0\.1:/,out);
 return {child,output:()=>out,stop:()=>new Promise(r=>{child.once('exit',r);child.kill('SIGTERM')})};
}
function raw(port,{method='GET',pathname='/',host,origin,body}={}){
 return new Promise((resolve,reject)=>{const headers={Host:host??'127.0.0.1:'+port};if(origin)headers.Origin=origin;if(body){headers['Content-Type']='application/json';headers['Content-Length']=Buffer.byteLength(body)}
  const req=http.request({host:'127.0.0.1',port,method,path:pathname,headers},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>resolve({status:res.statusCode,body:d,headers:res.headers}))});req.on('error',reject);if(body)req.write(body);req.end()});
}

test('local server: owner-only host check, same-origin writes, persistence across restarts',async()=>{
 const port=46000+Math.floor(Math.random()*1000),dataDir=path.join(tmp,'server-data');
 let srv=await startServer(port,dataDir);
 try{
  assert.match(srv.output(),/AI coach: off/);
  const page=await raw(port);assert.equal(page.status,200);assert.match(page.body,/Paladin Command Center/);
  assert.match(page.headers['content-security-policy'],/script-src 'self'/);
  assert.equal((await raw(port,{host:'evil.example:'+port})).status,421);// DNS rebinding blocked
  assert.equal((await raw(port,{host:'evil.example',pathname:'/api/state'})).status,421);
  const state=JSON.parse((await raw(port,{pathname:'/api/state'})).body);
  assert.equal(state.profile,null);assert.equal(state.coach.enabled,false);
  const body=JSON.stringify({profile,revision:0});
  assert.equal((await raw(port,{method:'PUT',pathname:'/api/profile',origin:'https://evil.example',body})).status,403);
  assert.equal((await raw(port,{method:'PUT',pathname:'/api/profile',body})).status,403);// no Origin
  assert.equal((await raw(port,{method:'PUT',pathname:'/api/profile',host:'localhost:'+port,origin:'http://localhost:'+port,body})).status,200);
  assert.equal((await raw(port,{method:'POST',pathname:'/api/coach',origin:'http://127.0.0.1:'+port,body:JSON.stringify({question:'hi'})})).status,503);
 }finally{await srv.stop()}
 assert.ok(fs.existsSync(path.join(dataDir,'character.sqlite')));
 srv=await startServer(port,dataDir);
 try{
  const state=JSON.parse((await raw(port,{pathname:'/api/state'})).body);
  assert.equal(state.profile.name,'Coach QA');assert.equal(state.revision,1);
  assert.ok(state.history.some(e=>e.summary==='Your journey began'));
 }finally{await srv.stop()}
});

test('local server reports the coach as on when a key is configured',async()=>{
 const port=47000+Math.floor(Math.random()*1000);
 const srv=await startServer(port,path.join(tmp,'server-key'),{ANTHROPIC_API_KEY:'sk-ant-test-not-used'});
 try{
  assert.match(srv.output(),/AI coach: on \(claude-sonnet-5-5, effort medium\)/);
  const c=JSON.parse((await raw(port,{pathname:'/api/state'})).body).coach;
  assert.deepEqual([c.enabled,c.model,c.effort],[true,'claude-sonnet-5-5','medium']);
 }finally{await srv.stop()}
});
