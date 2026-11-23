const gearSlots=['Main hand','Off hand','Head','Neck','Shoulders','Back','Chest','Wrists','Hands','Waist','Legs','Feet','Ring 1','Ring 2','Trinket 1','Trinket 2','Ranged / relic'];
const numericFields=['xp','xpMax','gold','strength','agility','stamina','intellect','spirit','health','mana','attackPower','armor','weaponDps','weaponSpeed','trainedAt','unspentTalents'];
function validateProfile(p){
 if(!p||typeof p!=='object'||Array.isArray(p))throw new ApiError(400,'Invalid character.');
 if(!Number.isInteger(p.level)||p.level<1||p.level>60)throw new ApiError(400,'Enter your actual current level, from 1 to 60.');
 for(const k of ['name','realm','zone','abilities','talents','legacy','notes'])if(typeof p[k]!=='string'||p[k].length>(['abilities','talents','notes'].includes(k)?6000:k==='legacy'?2000:k==='name'?60:300))throw new ApiError(400,'Check the '+k+' field.');
 for(const k of numericFields)if(p[k]!==null&&(!Number.isFinite(p[k])||p[k]<0||p[k]>100000000))throw new ApiError(400,'Check the '+k+' value.');
 for(const k of ['trainedAt','unspentTalents'])if(p[k]!==null&&(!Number.isInteger(p[k])||p[k]>60))throw new ApiError(400,'Check your talent points or trainer level.');
 if(p.trainedAt!==null&&(p.trainedAt<1||p.trainedAt>p.level))throw new ApiError(400,'Trainer visit level must be between 1 and your current level.');
 if(p.xp!==null&&p.xpMax!==null&&(p.xpMax===0||p.xp>=p.xpMax))throw new ApiError(400,'Current XP must be below XP needed for the next level.');
 if(!['unknown','none','warhorse','charger','other'].includes(p.mount)||typeof p.solo!=='boolean')throw new ApiError(400,'Invalid mount or play preference.');
 if(!p.gear||Array.isArray(p.gear)||typeof p.gear!=='object'||Object.entries(p.gear).some(([k,v])=>!gearSlots.includes(k)||typeof v!=='string'||v.length>300))throw new ApiError(400,'Check your equipment.');
 if(!Array.isArray(p.professions)||p.professions.length>5||p.professions.some(x=>!x||typeof x.name!=='string'||x.name.length>60||x.skill!==null&&(!Number.isInteger(x.skill)||x.skill<0||x.skill>1000)))throw new ApiError(400,'Check your professions.');
 const allowed=['name','realm','level','zone',...numericFields,'abilities','talents','legacy','notes','gear','professions','mount','solo'];
 if(Object.keys(p).some(k=>!allowed.includes(k)))throw new ApiError(400,'Unknown character field.');
 return p;
}
class ApiError extends Error{constructor(status,message){super(message);this.status=status}}
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
async function readBody(request){const text=await request.text();if(text.length>80000)throw new ApiError(413,'This update is too large.');try{return JSON.parse(text)}catch{throw new ApiError(400,'Invalid update format.')}}
async function readState(db,owner){
 const [c,os,hs,ss]=await Promise.all([
 db.prepare('SELECT data,revision,updated_at FROM characters WHERE owner=?').bind(owner).first(),
 db.prepare('SELECT key,title,category,custom,done,created_at,completed_at FROM objectives WHERE owner=? ORDER BY created_at DESC').bind(owner).all(),
 db.prepare('SELECT id,kind,summary,detail,created_at FROM events WHERE owner=? ORDER BY created_at DESC LIMIT 100').bind(owner).all(),
 db.prepare('SELECT id,name,size,created_at FROM screenshots WHERE owner=? ORDER BY created_at DESC').bind(owner).all()]);
 return {profile:c?JSON.parse(c.data):null,revision:c?.revision??0,updatedAt:c?.updated_at??null,objectives:os.results,history:hs.results,screenshots:ss.results};
}
function event(db,owner,kind,summary,detail,now=new Date().toISOString()){return db.prepare('INSERT INTO events(id,owner,kind,summary,detail,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),owner,kind,summary,JSON.stringify(detail),now)}
async function api(request,env){
 const owner=request.headers.get('oai-authenticated-user-id');
 if(!owner||!request.headers.get('oai-authenticated-user-email'))throw new ApiError(401,'Sign in with ChatGPT to access your character.');
 const path=new URL(request.url).pathname;
 if(!['GET','HEAD'].includes(request.method)&&request.headers.get('origin')!==new URL(request.url).origin)throw new ApiError(403,'Updates must come from your Command Center.');
 const db=env.DB;if(!db)throw new ApiError(503,'Character storage is unavailable. Try again shortly.');
 if(request.method==='GET'&&path==='/api/state')return json(await readState(db,owner));
 if(request.method==='PUT'&&path==='/api/profile'){
  const b=await readBody(request);const p=validateProfile(b.profile);if(!Number.isInteger(b.revision)||b.revision<0||b.note!==undefined&&(typeof b.note!=='string'||b.note.length>6000))throw new ApiError(400,'Invalid update.');
  const now=new Date().toISOString(),id=crypto.randomUUID();const prev=await db.prepare('SELECT data FROM characters WHERE owner=?').bind(owner).first();const old=prev?JSON.parse(prev.data):{};
  const changes=Object.entries(p).filter(([k,v])=>JSON.stringify(old[k])!==JSON.stringify(v)).map(([field,after])=>({field,before:old[field]??null,after}));
  const summary=b.revision===0?'Your journey began':old.level!==p.level?'Level updated: '+old.level+' to '+p.level:b.note?'Progress update recorded':'Character updated';
  const mutation=b.revision===0?db.prepare('INSERT OR IGNORE INTO characters(owner,data,revision,last_write,updated_at) VALUES(?,?,1,?,?)').bind(owner,JSON.stringify(p),id,now):db.prepare('UPDATE characters SET data=?,revision=revision+1,last_write=?,updated_at=? WHERE owner=? AND revision=?').bind(JSON.stringify(p),id,now,owner,b.revision);
  const result=await db.batch([mutation,db.prepare('INSERT INTO events(id,owner,kind,summary,detail,created_at) SELECT ?,owner,?,?,?,? FROM characters WHERE owner=? AND last_write=?').bind(id,'profile',summary,JSON.stringify({changes,note:b.note||''}),now,owner,id)]);
  if(result[0].meta.changes===0)throw new ApiError(409,'Your character changed in another tab. Refresh before applying this edit; your saved progress is safe.');
  return json(await readState(db,owner));
 }
 if(request.method==='POST'&&path==='/api/objectives'){
  const b=await readBody(request);if(typeof b.key!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(b.key)||typeof b.done!=='boolean')throw new ApiError(400,'Invalid objective.');
  const s=await readState(db,owner);if(!s.profile)throw new ApiError(400,'Set up your character first.');
  const old=s.objectives.find(o=>o.key===b.key),generated=buildPlan(s.profile,s.objectives).find(a=>a.key===b.key);
  if(!old&&!generated&&(!b.key.startsWith('custom-')||typeof b.title!=='string'||!b.title.trim()||b.title.length>200||!['Quests','Personal'].includes(b.category)))throw new ApiError(400,'Check your objective details.');
  if(old&&Boolean(old.done)===b.done)return json(s);
  const title=old?.title||generated?.title||b.title.trim(),category=old?.category||generated?.category||b.category,custom=old?.custom??(!generated?1:0),now=new Date().toISOString();
  await db.batch([db.prepare('INSERT INTO objectives(owner,key,title,category,custom,done,created_at,completed_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner,key) DO UPDATE SET done=excluded.done,completed_at=excluded.completed_at').bind(owner,b.key,title,category,custom?1:0,b.done?1:0,now,b.done?now:null),event(db,owner,'objective',(b.done?'Completed':old?'Reopened':'Added')+': '+title,{key:b.key,done:b.done},now)]);
  return json(await readState(db,owner));
 }
 if(request.method==='POST'&&path==='/api/journal'){
  const b=await readBody(request);if(typeof b.note!=='string'||!b.note.trim()||b.note.length>6000||b.kind&&!['note','coaching'].includes(b.kind))throw new ApiError(400,'Enter a note of 1–6,000 characters.');
  await event(db,owner,b.kind||'note',b.kind==='coaching'?'AI coaching note · unverified':'Field note',{note:b.note.trim()}).run();return json(await readState(db,owner));
 }
 if(path==='/api/screenshots'){
  const bucket=env.BUCKET;if(!bucket)throw new ApiError(503,'Screenshot storage is unavailable.');const id=new URL(request.url).searchParams.get('id')||'';
  if(request.method==='GET'||request.method==='DELETE'){
   const row=await db.prepare('SELECT object_key,name,mime FROM screenshots WHERE id=? AND owner=?').bind(id,owner).first();if(!row)throw new ApiError(404,'Screenshot not found.');
   if(request.method==='GET'){const image=await bucket.get(row.object_key);if(!image)throw new ApiError(404,'Screenshot not found.');return new Response(image.body,{headers:{'Content-Type':row.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}})}
   await db.batch([db.prepare('DELETE FROM screenshots WHERE id=? AND owner=?').bind(id,owner),event(db,owner,'screenshot','Removed screenshot: '+row.name,{})]);await bucket.delete(row.object_key);return json(await readState(db,owner));
  }
  if(request.method==='POST'){
   if(Number(request.headers.get('content-length')||0)>9*1024*1024)throw new ApiError(413,'Choose an image smaller than 8 MB.');
   const count=await db.prepare('SELECT COUNT(*) AS count FROM screenshots WHERE owner=?').bind(owner).first();if(count.count>=100)throw new ApiError(400,'Your 100-image collection is full.');
   const form=await request.formData(),file=form.get('file');if(!(file instanceof File)||file.size>8*1024*1024||file.size<12)throw new ApiError(400,'Choose a PNG, JPEG, or WebP image up to 8 MB.');
   const bytes=new Uint8Array(await file.arrayBuffer());let mime='';
   if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)mime='image/png';
   if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)mime='image/jpeg';
   if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')mime='image/webp';
   if(!mime)throw new ApiError(400,'Unsupported image. Use PNG, JPEG, or WebP.');
   const imageId=crypto.randomUUID(),key='screenshots/'+imageId,name=file.name.replace(/[^a-zA-Z0-9._ -]/g,'_').slice(0,150)||'Screenshot',now=new Date().toISOString();
   await bucket.put(key,bytes,{httpMetadata:{contentType:mime}});
   try{await db.batch([db.prepare('INSERT INTO screenshots(id,owner,object_key,name,mime,size,created_at) VALUES(?,?,?,?,?,?,?)').bind(imageId,owner,key,name,mime,bytes.length,now),event(db,owner,'screenshot','Added screenshot: '+name,{},now)])}catch(e){await bucket.delete(key);throw e}
   return json(await readState(db,owner));
  }
 }
 throw new ApiError(404,'This action is not available.');
}
const worker={async fetch(request,env){
 try{const path=new URL(request.url).pathname;if(path.startsWith('/api/'))return await api(request,env);
 const asset=ASSETS[path==='/'?'/index.html':path];if(!asset)return new Response('Not found',{status:404});
 return new Response(asset.body,{headers:{'Content-Type':asset.type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"}})
 }catch(e){return json({error:e instanceof ApiError?e.message:'Your change was not confirmed. Refresh before trying again.'},e instanceof ApiError?e.status:500)}
}};
export default worker;
