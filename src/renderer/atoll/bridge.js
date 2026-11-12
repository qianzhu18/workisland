const cfg=window.ATOLL_CONFIG||{};
let state={sessions:[],settings:{},quotas:{}};
const burn=new Set(),settingsListeners=new Set(),localeListeners=new Set();
export async function request(route,options){
 const r=await fetch(`${cfg.baseURL}/api/${route}${route.includes('?')?'&':'?'}token=${encodeURIComponent(cfg.token)}`,options);
 const data=await r.json();if(!r.ok)throw Error(data.error||`Request failed (${r.status})`);return data;
}
async function action(name,sessionId,extra={}){
 const s=state.sessions.find(s=>s.id===sessionId);
 try{return await request('action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:name,sessionId,requestId:s?.permissionRequest?.id,questionId:s?.questionPrompt?.id,...extra})})}
 catch(e){window.dispatchEvent(new CustomEvent('atoll-error',{detail:e.message}));throw e}
}
export function updateBridge(next){const before=JSON.stringify(state.usage);const oldSettings=JSON.stringify(state.settings);state=next;if(before!==JSON.stringify(next.usage))for(const f of burn)f();if(oldSettings!==JSON.stringify(next.settings))for(const f of settingsListeners)f(next.settings);if(oldSettings!==JSON.stringify(next.settings))request("locale").then(value=>{for(const f of localeListeners)f(value)}).catch(()=>{})}
const subscribe=set=>fn=>{set.add(fn);return()=>set.delete(fn)};
window.islandBridge={getLocaleState:()=>request('locale'),onLocaleChanged:subscribe(localeListeners),getSettings:async()=>state.settings,getQuotaMap:async()=>state.quotas,onSettingsChanged:subscribe(settingsListeners),onTodayBurnUpdate:subscribe(burn),getUsageSummary:days=>request(`usage?days=${days}`),getSessionInsights:days=>request(`insights?days=${days}`),approveSession:(id,choice)=>action('approve',id,{choice}),denySession:id=>action('deny',id),answerSession:(id,answer)=>action('answer',id,{answer}),cancelQuestion:id=>action('cancelQuestion',id),jumpToSession:id=>action('jump',id),deleteSession:id=>action('delete',id),openSettings:()=>action('openSettings'),openAgentPanel:()=>action('openAgentPanel'),continueSessionViaTerminalPrompt:(id,text)=>action('continue',id,{text}).then(response=>response.result),openExternal:url=>action('openExternal',undefined,{url}),getPluginAgentMeta:()=>request('agents')};
