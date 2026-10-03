'use strict';
const fs = require('node:fs');
const path = require('node:path');
const tag = Buffer.from('<script src="/sofia-access-check.js"></script>');
const anchor = Buffer.from('<head>');
function wrapHandler(handle) {
  return (req, res) => {
    if (process.env.SOFIA_ACCESS_CHECK !== '1') return handle(req, res);
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/sofia-access-check.js' && ['GET', 'HEAD'].includes(req.method)) {
      const body = fs.readFileSync(path.join(__dirname, 'sofia-access-check-client.js'));
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    if (req.method !== 'GET' || !['/office', '/office/'].includes(url.pathname)
        || !String(req.headers.accept || '').includes('text/html') || req.headers.rsc) return handle(req, res);
    // Next must send uncompressed HTML because the prefix is modified before streaming.
    delete req.headers['accept-encoding'];
    delete req.headers['if-none-match'];
    delete req.headers['if-modified-since'];
    const write = res.write.bind(res);
    const end = res.end.bind(res);
    const setHeader = res.setHeader.bind(res);
    const writeHead = res.writeHead.bind(res);
    let prefix = Buffer.alloc(0);
    let decided = false;
    const responseHeaders = {};
    const strip = name => /^(content-length|etag)$/i.test(name);
    res.setHeader = (name, value) => strip(name) ? res : setHeader(name, String(name).toLowerCase() === 'cache-control' ? 'no-store' : value);
    setHeader('Cache-Control', 'no-store');
    res.writeHead = (status, ...args) => {
      const last = args[args.length - 1];
      if (last && typeof last === 'object') {
        const entries = Array.isArray(last) ? Array.from({ length: last.length / 2 }, (_, i) => [last[i * 2], last[i * 2 + 1]]) : Object.entries(last);
        for (const [name, value] of entries) responseHeaders[String(name).toLowerCase()] = value;
        if (Array.isArray(last)) {
          const headers = [];
          for (let i = 0; i < last.length; i += 2) if (!strip(last[i])) headers.push(last[i], last[i + 1]);
          args[args.length - 1] = headers;
        } else args[args.length - 1] = Object.fromEntries(Object.entries(last).filter(([name]) => !strip(name)));
      }
      res.removeHeader('Content-Length');
      res.removeHeader('ETag');
      return writeHead(status, ...args);
    };
    function take(chunk, encoding, final) {
      prefix = Buffer.concat([prefix, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk || '', encoding || 'utf8')]);
      const getHeader = name => res.getHeader(name) || responseHeaders[name];
      const html = String(getHeader('content-type') || '').includes('text/html');
      const index = prefix.indexOf(anchor);
      if (html && !getHeader('content-encoding') && index !== -1) {
        const position = index + anchor.length;
        prefix = Buffer.concat([prefix.subarray(0, position), tag, prefix.subarray(position)]);
        decided = true;
      } else if (!html || getHeader('content-encoding') || prefix.length >= 65536 || final) decided = true;
      if (!decided) return null;
      const output = prefix;
      prefix = Buffer.alloc(0);
      return output;
    }
    res.write = (chunk, encoding, callback) => {
      if (typeof encoding === 'function') { callback = encoding; encoding = undefined; }
      if (decided) return write(chunk, encoding, callback);
      const output = take(chunk, encoding, false);
      if (output) return write(output, callback);
      if (callback) queueMicrotask(callback);
      return true;
    };
    res.end = (chunk, encoding, callback) => {
      if (typeof chunk === 'function') { callback = chunk; chunk = undefined; encoding = undefined; }
      if (typeof encoding === 'function') { callback = encoding; encoding = undefined; }
      if (decided) return end(chunk, encoding, callback);
      const output = take(chunk, encoding, true);
      return end(output, callback);
    };
    return handle(req, res);
  };
}
module.exports = { wrapHandler };
