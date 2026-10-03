'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { once } = require('node:events');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const upstreamPath = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw Error('Usage: node telemetry-bridge.test.cjs /pinned/Claw3D/with/ws');
const wsRequire = createRequire(path.join(upstreamPath, 'package.json'));
const { WebSocket, WebSocketServer } = wsRequire('ws');
const repo = path.resolve(__dirname, '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofia-bridge-'));
const originalCwd = process.cwd();
const sockets = [];
let server, upstream, proxy;
const event = { id: 'run-1-start', source: 'n8n', floorId: 'dev-third', agentId: 'n8n-reviewer', runId: 'run-1', sequence: 1, status: 'workflow.running' };
async function post(body, options = {}) {
  return new Promise((resolve, reject) => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: server.address().port,
      path: options.path || '/api/sofia-ops/events/third-floor', method: 'POST',
      headers: { authorization: options.authorization ?? 'Bearer local-ingress-test',
        'content-type': options.contentType ?? 'application/json', 'content-length': Buffer.byteLength(raw) } }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(raw);
  });
}
async function browser(mode = 'read', authenticated = true) {
  const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/api/gateway/ws`, { headers: { cookie: authenticated ? 'studio=local' : '' } });
  sockets.push(socket);
  const frames = [];
  socket.on('message', raw => frames.push(JSON.parse(String(raw))));
  if (!authenticated) {
    await new Promise(resolve => { socket.on('error', resolve); });
    return { socket, frames };
  }
  await once(socket, 'open');
  if (mode !== 'pending') {
    socket.send(JSON.stringify({ type: 'req', id: 'connect-' + mode, method: 'connect', params: {
      auth: { token: 'local-browser-test' }, client: { id: 'webchat-ui', mode: 'webchat' },
      device: { id: 'local-device', publicKey: 'local-public', signature: 'local-signature', signedAt: 1, nonce: 'local-nonce' },
      role: 'operator', scopes: mode === 'read' ? ['operator.read'] : mode === 'admin' ? ['operator.admin'] : []
    } }));
    await new Promise(resolve => socket.on('message', raw => { if (JSON.parse(String(raw)).type === 'res') resolve(); }));
  }
  return { socket, frames };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
(async () => {
  fs.mkdirSync(path.join(dir, 'server'));
  fs.copyFileSync(path.join(upstreamPath, 'server/gateway-proxy.js'), path.join(dir, 'server/gateway-proxy.js'));
  const index = '          if (accessGate.handleHttp(req, res)) return;\n          if (accessGate.handleHttp(req, res)) return;\n';
  fs.writeFileSync(path.join(dir, 'server/index.js'), index);
  process.chdir(dir);
  for (const stage of ['v3.3', 'v3.4']) {
    const source = fs.readFileSync(path.join(repo, 'claw3d/patch-ops-' + stage + '.js'), 'utf8');
    vm.runInNewContext(source.slice(0, source.indexOf('// 2)')), { require, console });
  }
  for (const patch of ['claw3d-next/patch-ops-v3.6.js', 'claw3d/patch-ops-v3.4.1.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(repo, patch), 'utf8'), { require, process, console });
  }
  const baseline = fs.readFileSync('server/gateway-proxy.js', 'utf8');
  const patch = path.join(repo, 'claw3d-next/patch-telemetry-bridge.cjs');
  execFileSync(process.execPath, [patch], { env: { ...process.env, SOFIA_THIRD_FLOOR_TELEMETRY: '0' } });
  assert.equal(fs.readFileSync('server/gateway-proxy.js', 'utf8'), baseline);
  process.env.SOFIA_THIRD_FLOOR_TELEMETRY = '1';
  process.env.SOFIA_GATEWAY_PRESERVE_DEVICE_AUTH = '1';
  process.env.SOFIA_OPS_EVENT_TOKEN = 'local-ingress-test';
  process.env.UPSTREAM_ALLOWLIST = '127.0.0.1';
  execFileSync(process.execPath, [patch]);
  const first = fs.readFileSync('server/gateway-proxy.js', 'utf8');
  execFileSync(process.execPath, [patch]);
  assert.equal(fs.readFileSync('server/gateway-proxy.js', 'utf8'), first);
  const bridge = require(path.join(dir, 'server/sofia-telemetry-bridge.cjs'));
  const proxyContext = { require: name => name === 'ws' ? { WebSocket, WebSocketServer } : name === './sofia-telemetry-bridge.cjs' ? bridge : require(name),
    module: { exports: {} }, process, console, URL, setTimeout, clearTimeout };
  vm.runInNewContext(first, proxyContext);
  upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(upstream, 'listening');
  const received = [];
  upstream.on('connection', socket => {
    socket.send(JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'local-nonce', ts: 1 } }));
    socket.on('message', raw => {
      const frame = JSON.parse(String(raw)); received.push(frame);
      socket.send(JSON.stringify({ type: 'res', id: frame.id, ok: true,
        payload: { type: 'hello-ok', auth: { role: 'operator', scopes: frame.params.scopes } } }));
    });
  });
  proxy = proxyContext.module.exports.createGatewayProxy({ loadUpstreamSettings: async () => ({
    url: `ws://127.0.0.1:${upstream.address().port}`, token: 'LOCAL_PRIVATE_SERVER_TOKEN', adapterType: 'openclaw'
  }), verifyClient: info => info.req.headers.cookie === 'studio=local' });
  server = http.createServer((req, res) => {
    if (bridge.handleIngress(req, res)) return;
    res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"legacy":true}');
  });
  server.on('upgrade', proxy.handleUpgrade);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  assert.equal((await post(event, { authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await post(event, { contentType: 'text/plain' })).status, 415);
  assert.equal((await post('{broken')).status, 400);
  assert.equal((await post({ ...event, floorId: 'audit-second' })).status, 422);
  assert.equal((await post({ ...event, sequence: -1 })).status, 422);
  assert.equal((await post('x'.repeat(16001))).status, 413);
  assert.equal((await post(event, { path: '/api/sofia-ops/events' })).status, 404);
  await browser('read', false);
  const pending = await browser('pending');
  const noRead = await browser('none');
  assert.equal((await post({ ...event, patient: 'DROP-ME', token: 'DROP-SECRET' })).body.accepted, true);
  await settle();
  assert.equal(pending.frames.filter(frame => frame.event === 'sofia.ops').length, 0);
  assert.equal(noRead.frames.filter(frame => frame.event === 'sofia.ops').length, 0);
  const allowed = await browser('read');
  await settle();
  const snapshot = allowed.frames.find(frame => frame.event === 'sofia.ops');
  assert.deepEqual(snapshot.payload, event);
  assert.equal(snapshot.seq, undefined);
  assert.ok(allowed.frames.findIndex(frame => frame.type === 'res') < allowed.frames.indexOf(snapshot));
  assert.equal(JSON.stringify(allowed.frames).includes('DROP-'), false);
  assert.equal((await post(event)).body.accepted, false);
  assert.equal((await post({ ...event, id: 'older', sequence: 1, status: 'workflow.failed' })).body.accepted, false);
  assert.equal((await post({ ...event, id: 'run-1-done', sequence: 2, status: 'workflow.completed' })).body.accepted, true);
  assert.equal((await post({ ...event, id: 'restart', sequence: 3 })).body.accepted, false);
  await settle();
  assert.equal(allowed.frames.filter(frame => frame.event === 'sofia.ops').length, 2);
  assert.ok(received.every(frame => frame.params.auth.token === 'local-browser-test' && frame.params.device.signature === 'local-signature'));
  assert.equal(JSON.stringify(received).includes('LOCAL_PRIVATE_SERVER_TOKEN'), false);
  const admin = await browser('admin'); await settle();
  assert.equal(admin.frames.filter(frame => frame.event === 'sofia.ops').length, 1);
  delete process.env.SOFIA_OPS_EVENT_TOKEN;
  assert.equal((await post(event)).status, 503);
  process.env.SOFIA_THIRD_FLOOR_TELEMETRY = '0';
  assert.equal((await post(event)).status, 404);
  console.log('PASS: real HTTP→WS, Studio auth gate, hello-before-snapshot, read/admin scopes, strict metadata, duplicate/old events, payload bound, idempotence, disabled equivalence and signed connect preservation');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const socket of sockets) socket.terminate();
  for (const socket of upstream?.clients || []) socket.terminate();
  await Promise.all([server && new Promise(resolve => server.close(resolve)), upstream && new Promise(resolve => upstream.close(resolve))]);
  proxy?.wss.close();
  process.chdir(originalCwd); fs.rmSync(dir, { recursive: true, force: true });
});
