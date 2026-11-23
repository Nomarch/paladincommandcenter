import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {bindings} from '../scripts/local-bindings.mjs';
import worker from '../dist/server/index.js';
const dir=path.resolve('.sites-runtime/tests-'+Date.now());let env=bindings(dir);
const domain=vm.createContext({});vm.runInContext(fs.readFileSync('src/domain.js','utf8')+';globalThis.rules={buildPlan,rotation,parseProgress,currentRoute,talentAdvice};',domain);
const profile={name:'QA Paladin',realm:'QA realm',level:6,zone:'Elwynn Forest',xp:100,xpMax:1000,gold:0,strength:null,agility:null,stamina:null,intellect:null,spirit:null,health:null,mana:null,attackPower:null,armor:null,weaponDps:null,weaponSpeed:null,trainedAt:null,unspentTalents:null,abilities:'Holy Light\nJudgement',talents:'',legacy:'',professions:[],gear:{},mount:'unknown',notes:'',solo:true};
async function call(route,method='GET',body,owner='qa-owner',origin='https://test.local'){
 const headers=new Headers();if(owner){headers.set('oai-authenticated-user-id',owner);headers.set('oai-authenticated-user-email','qa@example.test')}if(method!=='GET')headers.set('Origin',origin);
 if(!(body instanceof FormData))headers.set('Content-Type','application/json');
 const res=await worker.fetch(new Request('https://test.local'+route,{method,headers,body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)}),env);
 return {status:res.status,body:res.headers.get('content-type')?.includes('application/json')?await res.json():await res.text()};
}
test('first use has no invented character; auth and origin restrictions hold',async()=>{
 assert.equal((await call('/api/state','GET',undefined,null)).status,401);
 const first=await call('/api/state');assert.equal(first.body.profile,null);
 assert.equal((await call('/api/profile','PUT',{profile,revision:0},'qa-owner','https://evil.test')).status,403);
 assert.equal((await call('/api/profile','PUT',{profile:{...profile,level:0},revision:0})).status,400);
 assert.equal((await call('/api/profile','PUT',{profile:{...profile,xp:2000},revision:0})).status,400);
});
test('profile is persisted; another owner cannot see it; stale writes fail atomically',async()=>{
 const save=await call('/api/profile','PUT',{profile,revision:0});assert.equal(save.status,200);assert.equal(save.body.revision,1);assert.equal(save.body.profile.gold,0);
 assert.equal((await call('/api/state','GET',undefined,'other-owner')).body.profile,null);
 const before=save.body.history.length;
 const stale=await call('/api/profile','PUT',{profile:{...profile,level:12},revision:0});assert.equal(stale.status,409);
 const after=await call('/api/state');assert.equal(after.body.profile.level,6);assert.equal(after.body.history.length,before);
 env.close();env=bindings(dir);assert.equal((await call('/api/state')).body.profile.level,6);
});
test('task completion, reopening, custom quests, history, and level changes persist',async()=>{
 let result=await call('/api/objectives','POST',{key:'learn-holy-strike',done:true});assert.equal(result.status,200);assert.equal(result.body.objectives[0].done,1);
 result=await call('/api/profile','PUT',{profile:{...profile,level:12},revision:1});assert.equal(result.body.objectives.find(o=>o.key==='learn-holy-strike').done,1);
 assert.equal((await call('/api/objectives','POST',{key:'custom-qa-quest',title:'Complete a local quest',category:'Quests',done:false})).status,200);
 result=await call('/api/objectives','POST',{key:'learn-holy-strike',done:false});assert.equal(result.body.objectives.find(o=>o.key==='learn-holy-strike').done,0);
 assert(result.body.history.some(e=>e.summary.startsWith('Reopened')));
 env.close();env=bindings(dir);assert((await call('/api/state')).body.objectives.some(o=>o.key==='custom-qa-quest'));
});
test('natural language extraction is reviewable and never guesses unrecognized stats',()=>{
 const patch=domain.rules.parseProgress('I reached level 12. XP 2400/8000. I have 2.5 gold. Now in Westfall. Trained Holy Strike.',profile);
 assert.equal(patch.level,12);assert.equal(patch.xp,2400);assert.equal(patch.gold,2.5);assert.equal(patch.zone,'Westfall');assert(patch.abilities.includes('Holy Strike'));assert.equal(patch.strength,undefined);
 assert.equal(Object.keys(domain.rules.parseProgress('Finished some quests and felt stronger.',profile)).length,0);
});
test('recommendations follow actual abilities, talents, mount status, and quest history',()=>{
 assert(domain.rules.buildPlan(profile,[]).some(a=>a.key==='learn-holy-strike'));
 assert(!domain.rules.rotation(profile).some(x=>x.name==='Holy Strike'));
 assert(domain.rules.rotation({...profile,abilities:profile.abilities+'\nHoly Strike'}).some(x=>x.name==='Holy Strike'));
 assert(domain.rules.buildPlan({...profile,unspentTalents:2},[]).some(x=>x.category==='Talents'));
 assert(domain.rules.buildPlan({...profile,level:40},[]).some(x=>x.key==='warhorse'));
 assert(!domain.rules.buildPlan({...profile,level:40,mount:'warhorse'},[]).some(x=>x.key==='warhorse'));
 assert.equal(domain.rules.currentRoute(38).name,'Riverglades');
});
test('screenshots use persistent storage, require ownership, and reject unsafe formats',async()=>{
 const bad=new FormData();bad.set('file',new File(['<svg onload=alert(1)>unsafe image</svg>'],'bad.svg',{type:'image/svg+xml'}));
 assert.equal((await call('/api/screenshots','POST',bad)).status,400);
 const f=new FormData();f.set('file',new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/5u8AAAAASUVORK5CYII=','base64')],'qa.png',{type:'image/png'}));
 const saved=await call('/api/screenshots','POST',f);assert.equal(saved.status,200);const id=saved.body.screenshots[0].id;
 assert.equal((await call('/api/screenshots?id='+id,'GET',undefined,'other-owner')).status,404);
 env.close();env=bindings(dir);assert.equal((await call('/api/screenshots?id='+id)).status,200);
 assert.equal((await call('/api/screenshots?id='+id,'DELETE')).status,200);assert.equal((await call('/api/screenshots?id='+id)).status,404);
});
test('journal notes are retained and app assets load from the built Worker',async()=>{
 assert.equal((await call('/api/journal','POST',{note:'Test note',kind:'coaching'})).status,200);
 assert((await call('/api/state')).body.history.some(e=>e.kind==='coaching'));
 for(const route of ['/','/app.js','/style.css','/icons.js','/favicon.svg'])assert.equal((await call(route)).status,200);
 env.close();
});
