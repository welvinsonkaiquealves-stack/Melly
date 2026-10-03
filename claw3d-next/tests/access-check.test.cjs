'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { wrapHandler } = require('../access-check-server.cjs');
async function response(handler, route = '/office', headers = { accept: 'text/html' }) {
  const server = http.createServer(wrapHandler(handler));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    return await new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port: server.address().port, path: route, headers }, res => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ body, headers: res.headers, status: res.statusCode }));
      }).on('error', reject);
    });
  } finally { await new Promise(resolve => server.close(resolve)); }
}
test('injection precedes app scripts, handles split head and UTF8, strips stale lengths', async () => {
  process.env.SOFIA_ACCESS_CHECK = '1';
  const html = '<html><head><script src="next.js"></script></head><body>Olá 👋</body></html>';
  const result = await response((req, res) => {
    assert.equal(req.headers['accept-encoding'], undefined);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Length', Buffer.byteLength(html));
    res.setHeader('ETag', 'old');
    res.write('<html><he');
    res.end(html.slice(9));
  }, '/office', { accept: 'text/html', 'accept-encoding': 'gzip' });
  assert.equal(result.body, html.replace('<head>', '<head><script src="/sofia-access-check.js"></script>'));
  assert.equal(result.headers['content-length'], undefined);
  assert.equal(result.headers.etag, undefined);
});
test('writeHead headers and streamed chunks preserve security headers', async () => {
  const result = await response((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': '99', 'X-Frame-Options': 'DENY' });
    res.write('<html><head>');
    res.write('</head>');
    res.end('</html>');
  });
  assert.equal(result.headers['x-frame-options'], 'DENY');
  assert.match(result.body, /sofia-access-check.js/);
});
test('other routes, RSC, compressed output and non-HTML remain unchanged', async () => {
  const html = '<head>unchanged</head>';
  const handler = (req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(html); };
  assert.equal((await response(handler, '/login')).body, html);
  assert.equal((await response(handler, '/office', { accept: '*/*', rsc: '1' })).body, html);
  assert.equal((await response((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}'); })).body, '{"ok":true}');
  assert.equal((await response((req, res) => { res.setHeader('Content-Type', 'text/html'); res.setHeader('Content-Encoding', 'identity'); res.end(html); })).body, html);
});
test('disabled gate does not inject or expose diagnostic route', async () => {
  process.env.SOFIA_ACCESS_CHECK = '0';
  assert.equal((await response((req, res) => res.end('base'), '/sofia-access-check.js')).body, 'base');
  assert.equal((await response((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<head>base</head>'); })).body, '<head>base</head>');
  process.env.SOFIA_ACCESS_CHECK = '1';
});
test('patch opt-in, unique anchor, idempotence and accessGate order', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sofia-access-test-'));
  try {
    fs.mkdirSync(path.join(directory, 'server'));
    const file = path.join(directory, 'server/index.js');
    const base = '  const handle = app.getRequestHandler();\nif (accessGate.handleHttp(req, res)) return;\nhandle(req, res);';
    fs.writeFileSync(file, base);
    const patch = path.resolve(__dirname, '../patch-access-check.cjs');
    const run = enabled => spawnSync(process.execPath, [patch], { cwd: directory, env: { ...process.env, SOFIA_ACCESS_CHECK: enabled }, encoding: 'utf8' });
    assert.equal(run('0').status, 0);
    assert.equal(fs.readFileSync(file, 'utf8'), base);
    assert.equal(run('1').status, 0);
    const once = fs.readFileSync(file, 'utf8');
    assert.match(once, /accessGate.handleHttp\(req, res\).*\nhandle\(req, res\)/);
    assert.equal(run('1').status, 0);
    assert.equal(fs.readFileSync(file, 'utf8'), once);
    fs.writeFileSync(file, 'unexpected');
    assert.notEqual(run('1').status, 0);
    assert.equal(fs.readFileSync(file, 'utf8'), 'unexpected');
  } finally { fs.rmSync(directory, { recursive: true }); }
});
function clientHarness() {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.style = {}; }
    setAttribute(name, value) { this[name] = value; }
    append(...nodes) { this.children.push(...nodes); }
    addEventListener(type, callback) { this.listeners[type] = callback; }
  }
  class Socket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 1; this.listeners = {}; this.sent = []; }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    receive(frame) { this.listeners.message?.({ data: JSON.stringify(frame) }); }
    send(raw) {
      const frame = JSON.parse(raw);
      this.sent.push(frame);
      queueMicrotask(() => this.receive(frame.method === 'sessions.list'
        ? { type: 'res', id: frame.id, ok: false, error: { message: 'missing scope: operator.read' } }
        : { type: 'res', id: frame.id, ok: true, payload: { private: 'must never be displayed' } }));
    }
  }
  const document = { readyState: 'complete', body: new Element('body'), createElement: tag => new Element(tag) };
  const events = [];
  const window = { WebSocket: Socket, listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    dispatchEvent(event) { events.push(event); this.listeners[event.type]?.(event); return true; } };
  class CustomEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } }
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../access-check-client.js'), 'utf8'), {
    window, document, location: { href: 'https://sofia.example/office', host: 'sofia.example' },
    URL, CustomEvent, setTimeout, clearTimeout, console, Math
  });
  return { window, document, Socket, events };
}
test('client uses existing authenticated socket with three read-only RPCs; no secrets displayed', async () => {
  const { window, document, Socket } = clientHarness();
  const socket = new window.WebSocket('wss://sofia.example/api/gateway/ws');
  assert.ok(socket instanceof Socket);
  socket.receive({ type: 'res', ok: true, payload: { type: 'hello-ok', auth: { scopes: ['operator.admin'], deviceToken: 'secret' } } });
  const root = document.body.children[0];
  const [panel, , button] = root.children;
  await button.listeners.click();
  assert.deepEqual(socket.sent.map(frame => frame.method), ['status', 'sessions.list', 'cron.list']);
  assert.ok(socket.sent.every(frame => frame.type === 'req' && Object.keys(frame.params).length === 0));
  const text = panel.children.map(child => child.textContent).join(' ');
  assert.match(text, /Dados: ✅ Funcionou/);
  assert.match(text, /Sessões: ❌ Sem permissão/);
  assert.match(text, /administrativa: ✅ Informada/);
  assert.doesNotMatch(text, /secret|private|must never/);
});
test('unrelated socket is not used; diagnostic requests wait for authentication', async () => {
  const { window, document } = clientHarness();
  const socket = new window.WebSocket('wss://other.example/api/gateway/ws');
  await document.body.children[0].children[2].listeners.click();
  assert.equal(socket.sent.length, 0);
  const own = new window.WebSocket('wss://sofia.example/api/gateway/ws');
  await document.body.children[0].children[2].listeners.click();
  assert.equal(own.sent.length, 0);
});

test('mobile visual preview emits only local states and never sends Gateway RPCs', () => {
  const { window, document, events } = clientHarness();
  const socket = new window.WebSocket('wss://sofia.example/api/gateway/ws');
  const [, panel, , toggle] = document.body.children[0].children;
  toggle.listeners.click();
  assert.equal(panel.hidden, false);
  assert.equal(events.at(-1).detail, 'workflow.running');
  panel.children[4].listeners.click();
  assert.equal(events.at(-1).detail, 'workflow.completed');
  panel.children[5].listeners.click();
  assert.equal(events.at(-1).detail, 'workflow.failed');
  panel.children[6].listeners.click();
  assert.equal(events.at(-1).detail, null);
  assert.equal(panel.hidden, true);
  assert.equal(socket.sent.length, 0);
});
