// Local, single-owner server for Paladin Command Center.
// - Listens on 127.0.0.1 only, so other devices on your network cannot reach it.
// - Accepts only Host headers for this machine (blocks DNS-rebinding pages from
//   reading or writing your data through your browser).
// - Every accepted request is treated as the one local owner.
// - Data lives in ./data (SQLite database + screenshot files) unless PALADIN_DATA_DIR is set.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {bindings} from '../scripts/local-bindings.mjs';
import {createCoach} from './coach.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const envFile=path.join(root,'.env');
if(fs.existsSync(envFile)){try{process.loadEnvFile(envFile)}catch(e){console.error('Could not read .env: '+e.message)}}

const port=Number(process.env.PORT||5173);
const dataDir=path.resolve(root,process.env.PALADIN_DATA_DIR||'data');
const OWNER_ID='local-owner',OWNER_EMAIL='owner@localhost';
const MAX_BODY=10*1024*1024;
const allowedHosts=new Set(['127.0.0.1:'+port,'localhost:'+port]);

const workerPath=path.join(root,'dist/server/index.js');
if(!fs.existsSync(workerPath)){console.error('Build missing. Run: npm run build');process.exit(1)}
const {default:worker}=await import(pathToFileURL(workerPath).href);

const store=bindings(dataDir);
const coach=createCoach();
const env={DB:store.DB,BUCKET:store.BUCKET,COACH:coach||undefined,COACH_DAILY_LIMIT:process.env.COACH_DAILY_LIMIT};

export const server=http.createServer(async(req,res)=>{
 try{
  const host=String(req.headers.host||'').toLowerCase();
  if(!allowedHosts.has(host)){res.writeHead(421,{'Content-Type':'text/plain'});res.end('Open this app at http://127.0.0.1:'+port);return}
  const url=new URL(req.url,'http://'+host);
  const headers=new Headers();
  for(const [k,v] of Object.entries(req.headers)){if(v!==undefined&&!k.startsWith(':'))headers.set(k,Array.isArray(v)?v.join(', '):v)}
  headers.set('oai-authenticated-user-id',OWNER_ID);headers.set('oai-authenticated-user-email',OWNER_EMAIL);
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY){res.writeHead(413,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'This upload is too large.'}));req.destroy();return}chunks.push(chunk)}
  const request=new Request(url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
  const response=await worker.fetch(request,env);
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(e){console.error(e);if(!res.headersSent)res.writeHead(500,{'Content-Type':'text/plain'});res.end('Server error')}
});

function openBrowser(url){
 const cmd=process.platform==='win32'?['cmd',['/c','start','',url]]:process.platform==='darwin'?['open',[url]]:['xdg-open',[url]];
 try{spawn(cmd[0],cmd[1],{stdio:'ignore',detached:true}).unref()}catch{}
}

server.on('error',e=>{
 if(e.code==='EADDRINUSE')console.error('Port '+port+' is already in use. Is the Command Center already running? Close it, or set PORT=5174 in .env.');
 else console.error(e);
 process.exit(1);
});
server.listen(port,'127.0.0.1',()=>{
 const url='http://127.0.0.1:'+port;
 console.log('Paladin Command Center is running at '+url);
 console.log('Data folder: '+dataDir);
 console.log(coach?'AI coach: on ('+coach.config.model+', effort '+coach.config.effort+')':'AI coach: off (add ANTHROPIC_API_KEY to .env and restart)');
 console.log('Press Ctrl+C to stop.');
 if(process.argv.includes('--open'))openBrowser(url);
});
const shutdown=()=>{server.close();try{store.close()}catch{}process.exit(0)};
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
