const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const { createRequire } = require('node:module');
const upstreamSource = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage: node gateway-v3.4.1.test.cjs /path/to/pinned-Claw3D-with-ws-installed');
const { WebSocket, WebSocketServer } = createRequire(path.join(upstreamSource, 'package.json'))('ws');
const repo = path.resolve(__dirname, '../..');
const target = fs.mkdtempSync(path.join(os.tmpdir(), 'sofia-v341-'));
const originalCwd = process.cwd();
fs.mkdirSync(path.join(target, 'server'));
fs.copyFileSync(path.join(upstreamSource, 'server/gateway-proxy.js'), path.join(target, 'server/gateway-proxy.js'));
process.chdir(target);
for (const stage of ['v3.3', 'v3.4']) {
  const source = fs.readFileSync(path.join(repo, 'claw3d', `patch-ops-${stage}.js`), 'utf8');
  vm.runInNewContext(source.slice(0, source.indexOf('// 2)')), { require, console });
}
const legacy = fs.readFileSync('server/gateway-proxy.js', 'utf8');
vm.runInNewContext(fs.readFileSync(path.join(repo, 'claw3d/patch-ops-v3.4.1.js'), 'utf8'), { require, console, process });
const patched = fs.readFileSync('server/gateway-proxy.js', 'utf8');
assert.throws(()=>vm.runInNewContext(fs.readFileSync(path.join(repo,'claw3d/patch-ops-v3.4.1.js'),'utf8'),{require,console,process}),/already patched/);
assert.equal(fs.readFileSync('server/gateway-proxy.js','utf8'),patched);
const patchDir = path.join(target,'chain-fixtures');
fs.mkdirSync(patchDir);
const stages = ['v2.2','v2.3','v2.4','v2.5','v2.6','v2.7','v2.8','v2.9','v2.9.1','v3.0','v3.0.1','v3.1','v3.2','v3.2.1','v3.3','v3.4','v3.4.1'];
for(const name of ['patch-building-v1.js','patch-health.js','patch-ops-v2.js','patch-ops-v2.1.js',...stages.map(s=>`patch-ops-${s}.js`)]) fs.writeFileSync(path.join(patchDir,name),`require('node:fs').appendFileSync('chain-calls',${JSON.stringify(name+'\n')});`);
fs.writeFileSync(path.join(patchDir,'fetch-assets.sh'),'#!/bin/sh\nexit 0\n');
const chainEnv = {...process.env,SOFIA_STORAGE_FIX_JS:'',SOFIA_SETTINGS_FIX_JS:'',SOFIA_HEALTH_PATCH_JS:''};
for(const selected of [undefined,'v3.1','v3.4','v3.4.1']) {
  fs.writeFileSync('chain-calls','');
  execFileSync('sh',[path.join(repo,'claw3d/apply-chain.sh'),patchDir,...(selected?[selected]:[])],{env:chainEnv,stdio:'pipe'});
  const calls=fs.readFileSync('chain-calls','utf8').trim().split('\n');
  assert.equal(calls.at(-1),`patch-ops-${selected||'v3.4'}.js`);
  assert.equal(calls.includes('patch-ops-v3.4.1.js'),selected==='v3.4.1');
}
function loadProxy(source) {
  const context = { require: (name) => name === 'ws' ? { WebSocket, WebSocketServer } : require(name), module: { exports: {} }, process, console, URL, setTimeout, clearTimeout };
  vm.runInNewContext(source, context);
  return context.module.exports.createGatewayProxy;
}
const base = {type:'req', id:'connect-1', method:'connect', params:{client:{id:'openclaw-control-ui',mode:'webchat'},role:'operator',scopes:['operator.read','operator.admin'],auth:{token:'local-paired-token'},device:{id:'local-device',publicKey:'local-public',signature:'local-signature',signedAt:1,nonce:'local-nonce'}}};
const keys = crypto.generateKeyPairSync('ed25519');
const publicBytes = keys.publicKey.export({format:'der',type:'spki'}).subarray(-32);
base.params.device.id = crypto.createHash('sha256').update(publicBytes).digest('hex');
base.params.device.publicKey = publicBytes.toString('base64url');
const signedPayload = (p) => ['v2',p.device.id,p.client.id,p.client.mode,p.role,p.scopes.join(','),String(p.device.signedAt),p.auth.token,p.device.nonce].join('|');
base.params.device.signature = crypto.sign(null,Buffer.from(signedPayload(base.params)),keys.privateKey).toString('base64url');
async function exchange(source, flag, frame, adapter='openclaw') {
  if (flag === undefined) delete process.env.SOFIA_GATEWAY_PRESERVE_DEVICE_AUTH;
  else process.env.SOFIA_GATEWAY_PRESERVE_DEVICE_AUTH=flag;
  process.env.UPSTREAM_ALLOWLIST='127.0.0.1';
  const upstream = new WebSocketServer({host:'127.0.0.1',port:0});
  await once(upstream,'listening');
  let received;
  upstream.on('connection', socket => {
    socket.send(JSON.stringify({type:'event',event:'connect.challenge',payload:{nonce:'local-nonce'}}));
    socket.on('message', raw => {
      received=JSON.parse(String(raw));
      socket.send(JSON.stringify({type:'res',id:received.id,ok:true,payload:{type:'hello-ok'}}));
    });
  });
  const server=http.createServer();
  const proxy=loadProxy(source)({loadUpstreamSettings:async()=>({url:`ws://127.0.0.1:${upstream.address().port}`,token:'LOCAL_PRIVATE_SERVER_TOKEN',adapterType:adapter})});
  server.on('upgrade',proxy.handleUpgrade);
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const client=new WebSocket(`ws://127.0.0.1:${server.address().port}/api/gateway/ws`);
  const response=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('bounded mock test timed out')),2000);
    client.on('error',reject);
    client.on('message',raw=>{
      const data=JSON.parse(String(raw));
      if(data.event==='connect.challenge') client.send(JSON.stringify(frame));
      if(data.type==='res') {clearTimeout(timeout);resolve(data);}
    });
  });
  client.terminate(); for(const c of upstream.clients)c.terminate();
  await new Promise(resolve=>server.close(resolve));
  await new Promise(resolve=>upstream.close(resolve));
  proxy.wss.close();
  return {received,response};
}
(async()=>{
  const signed=await exchange(patched,'1',base);
  assert.deepEqual(signed.received,base);
  assert.equal(crypto.verify(null,Buffer.from(signedPayload(signed.received.params)),keys.publicKey,Buffer.from(signed.received.params.device.signature,'base64url')),true);
  assert.equal(JSON.stringify(signed).includes('LOCAL_PRIVATE_SERVER_TOKEN'),false);
  for(const mutation of [f=>delete f.params.device,f=>delete f.params.auth,f=>f.params.device.nonce='',f=>f.params.device.signedAt='bad',f=>f.params.auth.token=' ']) {
    const f=structuredClone(base);mutation(f);
    const r=await exchange(patched,'1',f);
    assert.equal(r.received,undefined);assert.equal(r.response.ok,false);
  }
  for(const flag of [undefined,'0']) {
    const old=await exchange(legacy,flag,base);
    const current=await exchange(patched,flag,base);
    assert.deepEqual(current,old);
    assert.equal(current.received.params.auth.token,'LOCAL_PRIVATE_SERVER_TOKEN');
    assert.equal(current.received.params.device,undefined);
  }
  const otherOld=await exchange(legacy,'1',base,'demo');
  const otherNew=await exchange(patched,'1',base,'demo');
  assert.deepEqual(otherNew,otherOld);
  assert.match(fs.readFileSync(path.join(repo,'claw3d/apply-chain.sh'),'utf8'),/LAST="\$\{2:-v3\.4\}"/);
  assert.match(fs.readFileSync(path.join(repo,'claw3d/Dockerfile'),'utf8'),/ARG SOFIA_CHAIN_STAGE=v3\.4\n/);
  console.log('PASS: unchanged frame + nonce, 5 malformed cases denied, legacy equivalence, adapter equivalence, unchanged defaults');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{process.chdir(originalCwd);fs.rmSync(target,{recursive:true,force:true});});
