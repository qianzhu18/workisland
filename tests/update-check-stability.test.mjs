import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createUpdateService } = require('../src/main/update-service.cjs');
const api = 'https://api.github.com/repos/qianzhu18/workisland/releases/latest';
const bytes = Buffer.from('12345678');
const hash = createHash('sha256').update(bytes).digest('hex');
const payload = (version = '1.0.0') => ({ tag_name: `v${version}`, assets: [
  {name: 'WorkIsland-1.0.0-arm64.dmg', size: 8, browser_download_url: 'https://github.com/dmg'},
  {name: 'SHA256SUMS.txt', browser_download_url: 'https://github.com/SHA256SUMS.txt'}
] });
function service(options = {}) {
  return createUpdateService({ platform: 'darwin', arch: 'arm64', app: {isPackaged:true,getVersion:()=> '0.9.0'},
    userDataPath:mkdtempSync(join(tmpdir(),'wi-check-')), logger:{warn(){},debug(){}},
    downloadRetryDelaysMs:[0,0,0], ...options });
}
function transport(url) {
  if (url === api) return Promise.resolve({ok:true,json:async()=>payload()});
  if (url.endsWith('SHA256SUMS.txt')) return Promise.resolve({ok:true,text:async()=>`${hash}  WorkIsland-1.0.0-arm64.dmg\n`});
  return Promise.resolve({ok:true,status:200,body:(async function*(){yield bytes;})()});
}
test('concurrent checks join the same pending network request', async () => {
  let resolve, calls = 0;
  const s = service({fetchImpl:()=>{calls++;return new Promise(r=>{resolve=r;});}});
  const a=s.check(), b=s.check(); assert.equal(a,b); assert.equal(calls,1);
  resolve({ok:true,json:async()=>payload()}); assert.equal((await b).status,'update-available');
});
test('failed checks never advance successful timestamp and automatically retry after short backoff', async () => {
  let clock=100000, calls=0, offline=true;
  const s=service({now:()=>clock,fetchImpl:async()=>{calls++;if(offline)throw new Error('offline');return {ok:true,json:async()=>payload()};}});
  assert.equal((await s.check()).status,'error'); assert.equal(calls,3); assert.equal(s.getState().lastCheckedAt,0);
  assert.equal((await s.check()).reason,'retry-backoff');
  clock+=61000;offline=false;assert.equal((await s.check()).status,'update-available');assert.equal(calls,4);
  assert.equal(s.getState().lastCheckedAt,clock);
});
test('forced checks bypass failure backoff and permanent HTTP errors do not retry', async () => {
  let calls=0;
  const s=service({fetchImpl:async()=>{calls++;return {ok:false,status:404};}});
  assert.equal((await s.check()).status,'error');assert.equal(calls,1);
  await s.check({force:true});assert.equal(calls,2);
});
test('metadata body timeout releases in-flight state and does not poison successful cache', async () => {
  let calls=0;
  const s=service({requestTimeoutMs:10,fetchImpl:async()=>{calls++;return {ok:true,json:()=>new Promise(()=>{})};}});
  assert.equal((await s.check()).status,'error');assert.equal(calls,3);assert.equal(s.getState().lastCheckedAt,0);
  assert.equal((await s.check({force:true})).status,'error');assert.equal(calls,6);
});
test('observer exceptions do not turn successful checks into network failures',async()=>{
  const s=service({fetchImpl:transport,onUpdateAvailable(){throw new Error('listener');}});
  assert.equal((await s.check()).status,'update-available');assert.ok(s.getState().lastCheckedAt>0);
});
test('duplicate download clicks join one operation including initial check',async()=>{
  const calls=[];
  const s=service({fetchImpl:async url=>{calls.push(url);return transport(url);}});
  const a=s.download(),b=s.download();assert.equal(a,b);assert.equal((await a).phase,'ready');
  assert.equal(calls.filter(x=>x===api).length,1);assert.equal(calls.filter(x=>x.endsWith('/dmg')).length,1);
});
test('checksum metadata is retried before downloading the large asset',async()=>{
  const calls=[];let failures=2;
  const s=service({fetchImpl:async url=>{calls.push(url);if(url.endsWith('SHA256SUMS.txt')&&failures-->0)return {ok:false,status:503};return transport(url);}});
  assert.equal((await s.download()).phase,'ready');
  assert.deepEqual(calls.slice(1),['https://github.com/SHA256SUMS.txt','https://github.com/SHA256SUMS.txt','https://github.com/SHA256SUMS.txt','https://github.com/dmg']);
});
test('unavailable checksum never starts large asset transfer and later retry refreshes release',async()=>{
  let offline=true,checks=0,dmgCalls=0;
  const s=service({fetchImpl:async url=>{if(url===api)checks++;if(url.endsWith('SHA256SUMS.txt')&&offline)return {ok:false,status:503};if(url.endsWith('/dmg'))dmgCalls++;return transport(url);}});
  assert.equal((await s.download()).phase,'error');assert.equal(dmgCalls,0);
  offline=false;assert.equal((await s.download()).phase,'ready');assert.equal(checks,2);assert.equal(dmgCalls,1);
});
test('downloads cannot install an older or equal cached release',async()=>{
  let dmgCalls=0;
  const s=service({app:{isPackaged:true,getVersion:()=> '1.0.0'},fetchImpl:async url=>{if(url.endsWith('/dmg'))dmgCalls++;return transport(url);}});
  await s.check({force:true});assert.equal((await s.download()).phase,'idle');assert.equal(dmgCalls,0);
});
test('transiently failed prefixes resume on manual retry with complete checksum verification',async()=>{
  let attempts=0,recovered=false;const ranges=[];
  const s=service({fetchImpl:async(url,options)=>{
    if(!url.endsWith('/dmg'))return transport(url);
    ranges.push(options.headers.Range??null);attempts++;
    if(!recovered){if(attempts===1)return {ok:true,status:200,body:(async function*(){yield bytes.subarray(0,4);throw new Error('drop');})()};throw new Error('offline');}
    return {ok:true,status:206,headers:new Headers({'Content-Range':'bytes 4-7/8'}),body:(async function*(){yield bytes.subarray(4);})()};
  }});
  assert.equal((await s.download()).phase,'error');recovered=true;
  const result=await s.download();assert.equal(result.phase,'ready');assert.deepEqual(readFileSync(result.downloadedPath),bytes);
  assert.deepEqual(ranges,[null,'bytes=4-','bytes=4-','bytes=4-']);
});
