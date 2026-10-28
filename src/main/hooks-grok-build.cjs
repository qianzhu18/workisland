'use strict';
const os=require('node:os'),path=require('node:path'),electron=require('electron');
const {GrokBuildHookStore}=require('./grok-build-hooks.cjs');
const {createHooksCliCommand}=require('./hooks-cli-command.cjs');
const {wrapWithInstallCheck}=require('./hook-shared.cjs');
function buildGrokHookCommand({appPath,executable,platform=process.platform}){
  // Grok's native Windows command runner uses PowerShell, not cmd.exe.
  if(platform==='win32'){
    const quote=value=>`'${String(value).replaceAll("'","''")}'`;
    const cli=path.win32.resolve(appPath,'src','island','hooks-cli','index.cjs');
    return `if (Test-Path -LiteralPath ${quote(executable)}) { $env:ELECTRON_RUN_AS_NODE = '1'; & ${quote(executable)} ${quote(cli)} --source 'grok-build' }`;
  }
  return wrapWithInstallCheck(executable,createHooksCliCommand({appPath,source:'grok-build',nodePath:executable,electronNodePath:executable,platform}),{platform});
}
class GrokBuildHookManager extends GrokBuildHookStore{
  agentId='grok-build';
  constructor(){super({homeDir:os.homedir(),grokHome:process.env.GROK_HOME&&path.isAbsolute(process.env.GROK_HOME)?process.env.GROK_HOME:path.join(os.homedir(),'.grok'),hookCommand:buildGrokHookCommand({appPath:electron.app.getAppPath(),executable:process.execPath})});}
}
module.exports={GrokBuildHookManager,buildGrokHookCommand};
