"use strict";
function normalizeAtollSettings(s={}){return {atollIntegrationEnabled:s.atollIntegrationEnabled===true,agentDisplayTarget:s.agentDisplayTarget==='atoll'?'atoll':'native'}}
function usesAtoll(s,platform=process.platform){return platform==='darwin'&&s?.atollIntegrationEnabled===true&&s?.agentDisplayTarget==='atoll'}
module.exports={normalizeAtollSettings,usesAtoll};
