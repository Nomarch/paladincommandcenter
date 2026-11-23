import http from 'node:http';
import worker from '../dist/server/index.js';
import {bindings} from './local-bindings.mjs';
const env=bindings('.sites-runtime/preview');
const port=5173;
http.createServer(async(req,res)=>{
 try{
 const origin='http://127.0.0.1:'+port,url=new URL(req.url,origin);
 // This file is development-only and is excluded from the deployed Worker.
 if(url.pathname==='/signin-with-chatgpt'){res.writeHead(302,{'Set-Cookie':'paladin_preview=local; HttpOnly; SameSite=Strict; Path=/','Location':'/'});res.end();return}
 if(url.pathname==='/signout-with-chatgpt'){res.writeHead(302,{'Set-Cookie':'paladin_preview=; Max-Age=0; Path=/','Location':'/'});res.end();return}
 const headers=new Headers(req.headers);
 headers.delete('oai-authenticated-user-id');headers.delete('oai-authenticated-user-email');
 if((req.headers.cookie||'').split(';').some(c=>c.trim()==='paladin_preview=local')){headers.set('oai-authenticated-user-id','local-preview-owner');headers.set('oai-authenticated-user-email','preview@sites.test')}
 const chunks=[];for await(const chunk of req)chunks.push(chunk);
 const request=new Request(url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks),duplex:'half'});
 const response=await worker.fetch(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(e){res.writeHead(500,{'Content-Type':'text/plain'});res.end(String(e))}
}).listen(port,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+port));
