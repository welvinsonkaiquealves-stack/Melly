const fs = require('node:fs');

const file = 'server/gateway-proxy.js';
const text = fs.readFileSync(file, 'utf8');
const anchor = '    const forwardConnectFrame = (frame) => {\n';
const marker = 'SOFIA_V341_PRESERVE_DEVICE_AUTH';
const first = text.indexOf(anchor);
if (first < 0 || text.indexOf(anchor, first + 1) >= 0 || text.includes(marker)) {
  throw new Error(`SOFIA v3.4.1 anchor missing/non-unique or already patched: ${file}`);
}
if (!text.includes('if (isObject(connectParams.device)) delete connectParams.device;')) {
  throw new Error(`SOFIA v3.4.1 requires the v3.4 proxy baseline: ${file}`);
}

// This optional overlay leaves the legacy path intact. Only staging should
// enable the runtime flag; the Gateway still validates signatures and grants.
const insertion = `      // ${marker}
      if (
        upstreamAdapterType === "openclaw" &&
        process.env.SOFIA_GATEWAY_PRESERVE_DEVICE_AUTH === "1"
      ) {
        const hasBrowserCredential =
          hasNonEmptyToken(frame.params) ||
          hasNonEmptyPassword(frame.params) ||
          hasNonEmptyDeviceToken(frame.params);
        if (!hasCompleteDeviceAuth(frame.params) || !hasBrowserCredential) {
          sendConnectError(
            "studio.device_pairing_required",
            "Complete browser device authentication and a credential are required. Use the supported Gateway pairing flow."
          );
          return;
        }
        // Never mutate any signed field or inject the private server token.
        upstreamWs.send(JSON.stringify(frame));
        return;
      }

`;
fs.writeFileSync(file, text.slice(0, first) + anchor + insertion + text.slice(first + anchor.length), 'utf8');
console.log('SOFIA_CHAIN: v3.4.1 optional device-auth preservation applied');
