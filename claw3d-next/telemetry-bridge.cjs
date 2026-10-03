'use strict';
// Same-process, metadata-only staging ingress. Does not publish to upstream OpenClaw.
const { timingSafeEqual } = require('node:crypto');
const MAX_BYTES = 16000;
const MAX_RUNS = 100;
const MAX_BUFFERED = 128 * 1024;
const TTL_MS = 5 * 60 * 1000;
const STATUS = new Set(['workflow.running', 'workflow.completed', 'workflow.failed']);
const clients = new Set();
const runs = new Map();
let rateStart = 0;
let rateCount = 0;
const enabled = () => process.env.SOFIA_THIRD_FLOOR_TELEMETRY === '1';
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(value);
const normalize = body => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (body.source !== 'n8n' || body.floorId !== 'dev-third' || !STATUS.has(body.status)) return null;
  if (![body.id, body.agentId, body.runId].every(identifier)) return null;
  if (!Number.isSafeInteger(body.sequence) || body.sequence < 1) return null;
  // Explicit allowlist: never retain free-form payloads, summaries or patient data.
  return { id: body.id, source: 'n8n', floorId: 'dev-third', agentId: body.agentId,
    runId: body.runId, sequence: body.sequence, status: body.status };
};
const prune = () => {
  const now = Date.now();
  for (const [key, value] of runs) if (now - value.receivedAt > TTL_MS) runs.delete(key);
};
const transmit = (socket, event) => {
  if (socket.readyState !== 1) { clients.delete(socket); return; }
  // Slow readers cannot accumulate an unlimited queue of telemetry frames.
  if (socket.bufferedAmount > MAX_BUFFERED) return;
  try { socket.send(JSON.stringify({ type: 'event', event: 'sofia.ops', payload: event })); }
  catch { clients.delete(socket); }
};
const publish = event => {
  prune();
  const key = JSON.stringify([event.agentId, event.runId]);
  const previous = runs.get(key);
  if (previous && (event.sequence <= previous.event.sequence || event.id === previous.event.id)) return false;
  // A finished execution cannot return to running even with a higher sequence.
  if (previous && previous.event.status !== 'workflow.running' && event.status === 'workflow.running') return false;
  runs.delete(key);
  runs.set(key, { event, receivedAt: Date.now() });
  while (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value);
  for (const socket of clients) transmit(socket, event);
  return true;
};
const authenticate = (socket, hello) => {
  if (!enabled() || hello?.type !== 'hello-ok' || hello.auth?.role !== 'operator') return false;
  const scopes = hello.auth.scopes;
  if (!Array.isArray(scopes) || !scopes.some(scope => scope === 'operator.read' || scope === 'operator.admin')) return false;
  if (clients.has(socket) || socket.readyState !== 1) return false;
  clients.add(socket);
  const remove = () => clients.delete(socket);
  socket.once('close', remove);
  socket.once('error', remove);
  prune();
  // At most 100 current run states, sent only AFTER the matching hello response.
  for (const value of runs.values()) transmit(socket, value.event);
  return true;
};
const reply = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
};
const handleIngress = (req, res) => {
  if (!enabled() || req.method !== 'POST') return false;
  const pathname = new URL(req.url, 'http://localhost').pathname;
  // Explicit new route preserves the existing generic events API and its consumers.
  if (pathname !== '/api/sofia-ops/events/third-floor') return false;
  const expected = process.env.SOFIA_OPS_EVENT_TOKEN?.trim();
  if (!expected) { reply(res, 503, { error: 'ingress_not_configured' }); req.resume(); return true; }
  const actual = Buffer.from(String(req.headers.authorization || ''));
  const wanted = Buffer.from('Bearer ' + expected);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
    reply(res, 401, { error: 'unauthorized' }); req.resume(); return true;
  }
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) {
    reply(res, 415, { error: 'application_json_required' }); req.resume(); return true;
  }
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') {
    reply(res, 415, { error: 'compressed_body_not_supported' }); req.resume(); return true;
  }
  const now = Date.now();
  if (now - rateStart >= 60000) { rateStart = now; rateCount = 0; }
  if (++rateCount > 60) { reply(res, 429, { error: 'rate_limited' }); req.resume(); return true; }
  if (Number(req.headers['content-length']) > MAX_BYTES) {
    reply(res, 413, { error: 'payload_too_large' }); req.resume(); return true;
  }
  let bytes = 0;
  const chunks = [];
  let done = false;
  req.on('data', chunk => {
    if (done) return;
    bytes += chunk.length;
    if (bytes > MAX_BYTES) { done = true; chunks.length = 0; reply(res, 413, { error: 'payload_too_large' }); return; }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (done) return;
    done = true;
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { reply(res, 400, { error: 'invalid_json' }); return; }
    const event = normalize(body);
    if (!event) { reply(res, 422, { error: 'invalid_third_floor_event' }); return; }
    const accepted = publish(event);
    reply(res, 202, { ok: true, accepted, id: event.id });
  });
  req.on('error', () => { if (!done) { done = true; reply(res, 400, { error: 'request_failed' }); } });
  return true;
};
module.exports = { handleIngress, authenticate };
