'use strict';
const fs = require('node:fs');
const path = require('node:path');
if (process.env.SOFIA_ACCESS_CHECK !== '1') {
  console.log('SOFIA_ACCESS_CHECK: disabled');
  process.exit(0);
}
const filename = path.resolve('server/index.js');
const source = fs.readFileSync(filename, 'utf8');
const marker = 'SOFIA_ACCESS_CHECK_HANDLER';
const anchor = '  const handle = app.getRequestHandler();';
if (!source.includes(marker) && source.split(anchor).length !== 2) throw new Error('Unexpected server handler; refusing patch');
for (const [from, to] of [
  ['access-check-server.cjs', 'sofia-access-check-server.cjs'],
  ['access-check-client.js', 'sofia-access-check-client.js']
]) fs.copyFileSync(path.join(__dirname, from), path.resolve('server', to));
if (!source.includes(marker)) fs.writeFileSync(filename, source.replace(anchor,
  '  // ' + marker + ': accessGate still runs before this handler.\n' +
  '  const handle = require("./sofia-access-check-server.cjs").wrapHandler(app.getRequestHandler());'));
console.log('SOFIA_ACCESS_CHECK: staging diagnostic button applied');
