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
  assert.equal(out.text,'Train Holy Strike rank 2.\n\n_(Answered without a web lookup.)_');assert.equal(out.model,'claude-sonnet-5-5');assert.deepEqual(out.usage,{input:900,output:120});
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
  assert.match(srv.output(),/AI coach: on \(claude-sonnet-5-5, effort medium\), web search on/);
  const c=JSON.parse((await raw(port,{pathname:'/api/state'})).body).coach;
  assert.deepEqual([c.enabled,c.model,c.effort],[true,'claude-sonnet-5-5','medium']);
 }finally{await srv.stop()}
});

// ---- screenshot reading ----
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/5u8AAAAASUVORK5CYII=','base64');
const reading=(over={})=>({seen:'Character sheet',notes:'Armor value partly hidden',name:null,realm:null,zone:null,level:null,xp:null,xpMax:null,gold:null,strength:null,agility:null,stamina:null,intellect:null,spirit:null,health:null,mana:null,attackPower:null,armor:null,weaponDps:null,weaponSpeed:null,unspentTalents:null,talents:null,abilities:[],gear:[],...over});

test('screenshot reading: proposes only valid, changed values and saves nothing by itself',async()=>{
 const store=bindings(path.join(tmp,'reader'));const seenArgs=[];let next=reading();
 const coach=async()=>({text:'x',model:'claude-sonnet-5-5',usage:{}});coach.config={model:'claude-sonnet-5-5',effort:'medium'};
 coach.read=async args=>{seenArgs.push(args);await new Promise(r=>setTimeout(r,40));if(next instanceof Error)throw next;return {data:next,model:'claude-sonnet-5-5',usage:{}}};
 const env={DB:store.DB,BUCKET:store.BUCKET,COACH:coach,COACH_DAILY_LIMIT:'5'};const call=workerCall(env);
 const upload=async(owner='qa-owner')=>{const f=new FormData();f.set('file',new File([PNG],'sheet.png',{type:'image/png'}));
  const res=await worker.fetch(new Request('https://test.local/api/screenshots',{method:'POST',headers:{'oai-authenticated-user-id':owner,'oai-authenticated-user-email':'qa@example.test',Origin:'https://test.local'},body:f}),env);return (await res.json()).screenshots[0].id};
 await call('/api/profile','PUT',{profile,revision:0});
 const id=await upload();

 assert.equal((await workerCall({DB:store.DB,BUCKET:store.BUCKET})('/api/screenshots/read?id='+id,'POST',{})).status,503);
 assert.equal((await call('/api/screenshots/read?id=nope','POST',{})).status,404);
 await call('/api/profile','PUT',{profile,revision:0},'other-owner');
 assert.equal((await call('/api/screenshots/read?id='+id,'POST',{},'other-owner')).status,404);
 assert.equal(seenArgs.length,0);

 next=reading({name:'Coach QA',level:15,xp:500,xpMax:9000,gold:3,strength:42,stamina:-5,armor:1e12,unspentTalents:2.5,zone:'  Redridge Mountains ',
  abilities:['Holy Strike','Seal of Righteousness','seal of righteousness',''],gear:[{slot:'Main hand',item:'Rusty Hatchet'},{slot:'Chest',item:'Militia Chain Vest'},{slot:'Pocket',item:'Lint'}],talents:'Benediction 2/5'});
 let r=await call('/api/screenshots/read?id='+id,'POST',{});
 assert.equal(r.status,200);
 assert.deepEqual(r.body.reading.patch,{zone:'Redridge Mountains',talents:'Benediction 2/5',level:15,xp:500,xpMax:9000,strength:42,abilities:'Holy Light\nJudgement\nHoly Strike\nSeal of Righteousness',gear:{Chest:'Militia Chain Vest'}});
 assert.equal(r.body.reading.seen,'Character sheet');assert.equal(r.body.reading.notes,'Armor value partly hidden');assert.equal(r.body.reading.name,'sheet.png');
 assert.equal(r.body.state.profile.level,14);assert.equal(r.body.state.revision,1);// nothing saved
 assert.equal(r.body.state.coach.usedToday,1);assert.equal(r.body.state.coach.messages.length,0);
 assert.equal(seenArgs[0].mime,'image/png');assert.ok(Buffer.from(seenArgs[0].bytes).equals(PNG));

 next=reading({abilities:['Holy','Judgement']});// a shorter name is new; an exact match is not
 assert.deepEqual((await call('/api/screenshots/read?id='+id,'POST',{})).body.reading.patch,{abilities:'Holy Light\nJudgement\nHoly Strike\nHoly'});
 next=reading({xp:9000,xpMax:9000});// impossible pair is dropped
 assert.deepEqual((await call('/api/screenshots/read?id='+id,'POST',{})).body.reading.patch,{});
 next=reading({level:15});
 const two=await Promise.all([call('/api/screenshots/read?id='+id,'POST',{}),call('/api/coach','POST',{question:'hi'})]);
 assert.deepEqual(two.map(x=>x.status).sort(),[200,409]);// one AI request at a time
 const e=new Error('The AI declined to read this screenshot. Try a different one.');e.status=502;e.expose=true;next=e;
 r=await call('/api/screenshots/read?id='+id,'POST',{});assert.equal(r.status,502);assert.match(r.body.error,/declined to read/);
 assert.equal((await call('/api/screenshots/read?id='+id,'POST',{})).status,429);// 5 attempts used, failures included
 assert.equal((await call('/api/state')).body.profile.level,14);
 store.close();
});

test('screenshot reader sends the image to Sonnet 5.5 at medium effort with a JSON schema',async()=>{
 let mode='ok';
 const api=await fakeApi(()=>mode==='refuse'?[200,message({content:[],stop_reason:'refusal',stop_details:{type:'refusal',category:'general_harms',explanation:'x'}})]:mode==='garbage'?[200,message({content:[{type:'text',text:'not json'}]})]:[200,message({content:[{type:'thinking',thinking:'',signature:'s'},{type:'text',text:JSON.stringify(reading({level:22}))}]})]);
 try{
  const coach=createCoach({apiKey:'sk-ant-test',baseURL:api.url});
  const out=await coach.read({bytes:PNG,mime:'image/png'});
  assert.equal(out.data.level,22);assert.equal(out.model,'claude-sonnet-5-5');
  const b=api.requests[0].body;
  assert.equal(b.model,'claude-sonnet-5-5');assert.equal(b.output_config.effort,'medium');assert.equal(b.fallbacks,'default');
  assert.equal(b.output_config.format.type,'json_schema');
  const sch=b.output_config.format.schema;assert.equal(sch.additionalProperties,false);
  assert.deepEqual([...sch.required].sort(),Object.keys(sch.properties).sort());
  assert.deepEqual(b.messages[0].content[0],{type:'image',source:{type:'base64',media_type:'image/png',data:PNG.toString('base64')}});
  assert.equal(b.messages[0].content[1].type,'text');
  for(const banned of ['thinking','temperature','top_p','top_k','tool_choice'])assert.equal(b[banned],undefined,banned);
  mode='refuse';await assert.rejects(coach.read({bytes:PNG,mime:'image/png'}),e=>e.expose&&/declined to read/.test(e.message));
  mode='garbage';await assert.rejects(coach.read({bytes:PNG,mime:'image/png'}),e=>e.expose&&/unreadable result/.test(e.message));
 }finally{api.server.close()}
});

test('coach can search the web: capped tools sent, paused turns resumed, sources listed',async()=>{
 let calls=0;
 const api=await fakeApi(rec=>{calls++;
  if(calls===1)return [200,message({stop_reason:'pause_turn',content:[{type:'text',text:'Checking current guides. '},{type:'server_tool_use',id:'srvtoolu_1',name:'web_search',input:{query:'wow forever paladin'}}]})];
  return [200,message({content:[{type:'web_search_tool_result',tool_use_id:'srvtoolu_1',content:[{type:'web_search_result',url:'https://example.test/other',title:'Other page',encrypted_content:'x',page_age:null}]},
   {type:'text',text:'Train Holy Strike at level 6'},{type:'text',text:' per the class notes.',citations:[{type:'web_search_result_location',url:'https://news.blizzard.com/paladin',title:'Paladin deep dive',cited_text:'x',encrypted_index:'y'},{type:'web_search_result_location',url:'javascript:alert(1)',title:'bad',cited_text:'x',encrypted_index:'y'}]}]})]});
 const prev=process.env.PALADIN_COACH_WEB;
 try{
  delete process.env.PALADIN_COACH_WEB;
  const coach=createCoach({apiKey:'sk-ant-test',baseURL:api.url});assert.equal(coach.config.web,true);
  const out=await coach({briefing:'b',history:[],question:'When do I get Holy Strike?'});
  assert.equal(calls,2);
  const [first,second]=api.requests.map(r=>r.body);
  assert.deepEqual(first.tools,[{type:'web_search_20260209',name:'web_search',max_uses:5},{type:'web_fetch_20260209',name:'web_fetch',max_uses:5}]);
  assert.equal(first.model,'claude-sonnet-5-5');assert.equal(first.output_config.effort,'medium');
  assert.deepEqual(second.messages.map(m=>m.role),['user','assistant']);
  assert.equal(second.messages[1].content[1].type,'server_tool_use');
  assert.match(out.text,/^Checking current guides\. Train Holy Strike at level 6 per the class notes\./);
  assert.match(out.text,/\*\*Sources\*\*\n- Paladin deep dive: https:\/\/news\.blizzard\.com\/paladin$/);
  assert.doesNotMatch(out.text,/javascript:|example\.test/);
  assert.deepEqual(out.usage,{input:1800,output:240});

  process.env.PALADIN_COACH_WEB='off';calls=5;
  const plain=createCoach({apiKey:'sk-ant-test',baseURL:api.url});assert.equal(plain.config.web,false);
  await plain({briefing:'b',history:[],question:'q'});
  assert.equal(api.requests.at(-1).body.tools,undefined);
 }finally{if(prev===undefined)delete process.env.PALADIN_COACH_WEB;else process.env.PALADIN_COACH_WEB=prev;api.server.close()}
});

test('a turn that keeps pausing stops after the continuation limit',async()=>{
 const api=await fakeApi(()=>[200,message({stop_reason:'pause_turn',content:[{type:'text',text:'Still looking. '},{type:'server_tool_use',id:'s',name:'web_search',input:{query:'q'}}]})]);
 try{
  const out=await createCoach({apiKey:'sk-ant-test',baseURL:api.url})({briefing:'b',history:[],question:'q'});
  assert.equal(api.requests.length,2);// first call + 1 continuation
  assert.match(out.text,/web lookup ran long/);
 }finally{api.server.close()}
});
