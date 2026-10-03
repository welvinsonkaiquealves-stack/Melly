'use strict';
const fs = require('node:fs');
const path = require('node:path');
if (process.env.SOFIA_THIRD_FLOOR_TELEMETRY !== '1') {
  console.log('SOFIA_THIRD_FLOOR_TELEMETRY: disabled');
  process.exit(0);
}
const marker = 'SOFIA_THIRD_FLOOR_TELEMETRY';
const indexFile = 'server/index.js';
const proxyFile = 'server/gateway-proxy.js';
let index = fs.readFileSync(indexFile, 'utf8');
let proxy = fs.readFileSync(proxyFile, 'utf8');
const gate = '          if (accessGate.handleHttp(req, res)) return;';
const forward = '          browserWs.send(String(upRaw ?? ""));';
const isNewIndex = !index.includes('// ' + marker);
const isNewProxy = !proxy.includes('// ' + marker);
if (isNewIndex && index.split(gate).length !== 3) throw new Error('Unexpected HTTP gate anchors; refusing telemetry patch');
if (isNewProxy && proxy.split(forward).length !== 2) throw new Error('Unexpected upstream forward anchor; refusing telemetry patch');
if (isNewIndex) index = index.split(gate).join(
  '          // ' + marker + ': exact ingress has its own bearer authentication.\n' +
  '          if (require("./sofia-telemetry-bridge.cjs").handleIngress(req, res)) return;\n' + gate);
if (isNewProxy) proxy = proxy.replace(forward, forward + '\n' +
  '          // ' + marker + ': subscribe only after forwarding the authenticated hello.\n' +
  '          if (upParsed && upParsed.type === "res" && upParsed.id === connectRequestId &&\n' +
  '              upParsed.ok === true && upParsed.payload?.type === "hello-ok") {\n' +
  '            require("./sofia-telemetry-bridge.cjs").authenticate(browserWs, upParsed.payload);\n' +
  '          }');
fs.copyFileSync(path.join(__dirname, 'telemetry-bridge.cjs'), 'server/sofia-telemetry-bridge.cjs');
if (isNewIndex) fs.writeFileSync(indexFile, index);
if (isNewProxy) fs.writeFileSync(proxyFile, proxy);
console.log('SOFIA_THIRD_FLOOR_TELEMETRY: authenticated HTTP-to-browser WS bridge applied');
