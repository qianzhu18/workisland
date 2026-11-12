"use strict";
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {snapshot,dispatchAction}=require('./atoll-state.cjs');
async function createAtollServer({coordinator,rendererRoot=path.resolve(__dirname,'../renderer'),openExternal,getAgentMeta=()=>require('./agent-registry.cjs').listPluginAgentMeta(),getLocaleState=()=>({locale:'en',messages:require('../locales/en.json'),fallbackMessages:require('../locales/en.json')})}){
 const token=crypto.randomBytes(32).toString('hex'),resolved=new Set();let url;
 const server=http.createServer(async(req,res)=>{
  const send=(status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-headers':'Content-Type','access-control-allow-methods':'GET,POST,OPTIONS'});res.end(JSON.stringify(data))};
  try{
   if(req.headers.host!==new URL(url).host)return send(403,{error:'Invalid host'});
   const u=new URL(req.url,url);
   if(u.pathname.startsWith('/api/')){
    if(req.method==='OPTIONS')return send(200,{});
    const a=Buffer.from(u.searchParams.get('token')||''),b=Buffer.from(token);
    if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return send(401,{error:'Authorization required'});
    if(req.method==='GET'){
     if(u.pathname==='/api/state')return send(200,snapshot(coordinator));
     if(u.pathname==='/api/locale')return send(200,getLocaleState());
     if(u.pathname==='/api/agents')return send(200,getAgentMeta());
     if(u.pathname==='/api/usage')return send(200,coordinator.getUsageSummary(Number(u.searchParams.get('days'))||7));
     if(u.pathname==='/api/insights')return send(200,coordinator.getSessionInsights(Number(u.searchParams.get('days'))||7));
    }
    if(u.pathname!=='/api/action'||req.method!=='POST')return send(405,{error:'Unsupported request'});
    let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>65536)return send(413,{error:'Request too large'});chunks.push(chunk)}
    const p=JSON.parse(Buffer.concat(chunks).toString()),key=['approve','deny','answer','cancelQuestion'].includes(p.action)?`${p.sessionId}:${p.requestId||p.questionId||'pending'}`:null;
    if(key&&resolved.has(key))return send(409,{error:'Request already handled'});
    if(key)resolved.add(key);
    try{const result=await dispatchAction(coordinator,p.action,p,{openExternal});if(resolved.size>1024)resolved.delete(resolved.values().next().value);return send(200,{success:true,result})}catch(e){if(key)resolved.delete(key);return send(409,{error:e.message})}
   }
   if(req.method!=='GET'||!u.pathname.startsWith('/renderer/'))return send(404,{error:'Not found'});
   const file=path.resolve(rendererRoot,decodeURIComponent(u.pathname.slice('/renderer/'.length)));
   if(!file.startsWith(rendererRoot+path.sep))return send(404,{error:'Not found'});
   const data=await fs.readFile(file),ext=path.extname(file);
   res.writeHead(200,{'content-type':({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.html':'text/html','.woff2':'font/woff2'})[ext]||'application/octet-stream','cache-control':'no-store','access-control-allow-origin':'*'});res.end(data);
  }catch(e){send(e.code==='ENOENT'?404:400,{error:'Invalid request'})}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});url=`http://127.0.0.1:${server.address().port}`;
 return {url,token,close:()=>new Promise(resolve=>{server.close(resolve);server.closeIdleConnections()})};
}
module.exports={createAtollServer};
