// Minimal static server for local use: node scripts/serve.mjs [dir] [--port 8080] [--no-isolation]
// Sends COOP/COEP headers by default so the page is cross-origin isolated (smaltdb then uses
// parallel reader workers and can interrupt running statements). OPFS needs a secure context,
// which localhost is.
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : d);
const root = resolve(args.find((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').startsWith('--port')) ?? '.');
const port = Number(opt('--port', process.env.PORT ?? 8080));
const isolate = !flag('--no-isolation');
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.csv': 'text/csv; charset=utf-8', '.tsv': 'text/tab-separated-values; charset=utf-8', '.ndjson': 'application/x-ndjson',
  '.sql': 'text/plain; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json',
};

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let path = normalize(join(root, decodeURIComponent(url.pathname)));
  if (!path.startsWith(root)) return void res.writeHead(403).end();
  try {
    if (statSync(path).isDirectory()) path = join(path, 'index.html');
    const st = statSync(path);
    const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    const headers = {
      'Content-Type': types[extname(path)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Accept-Ranges': 'bytes',
      ETag: etag,
      'Last-Modified': st.mtime.toUTCString(),
      // smaltdb reads Parquet (and checks freshness) with Range / HEAD requests.
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Range',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, ETag, Last-Modified',
    };
    if (isolate) Object.assign(headers, { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless', 'Cross-Origin-Resource-Policy': 'cross-origin' });
    if (req.method === 'OPTIONS') return void res.writeHead(204, headers).end();
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    let start = 0;
    let end = st.size - 1;
    let code = 200;
    if (range && st.size > 0) {
      if (range[1] === '') start = Math.max(0, st.size - Number(range[2]));
      else {
        start = Number(range[1]);
        if (range[2] !== '') end = Math.min(end, Number(range[2]));
      }
      if (start > end || start >= st.size) return void res.writeHead(416, { ...headers, 'Content-Range': `bytes */${st.size}` }).end();
      code = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    }
    headers['Content-Length'] = st.size === 0 ? 0 : end - start + 1;
    res.writeHead(code, headers);
    if (req.method === 'HEAD' || st.size === 0) return void res.end();
    createReadStream(path, { start, end }).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  }
}).listen(port, () => console.log(`smaltui: http://localhost:${port}/  (root ${root}${isolate ? ', cross-origin isolated' : ''})`));
