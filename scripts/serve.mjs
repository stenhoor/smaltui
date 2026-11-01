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
    const headers = { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' };
    if (isolate) Object.assign(headers, { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless', 'Cross-Origin-Resource-Policy': 'cross-origin' });
    res.writeHead(200, headers);
    createReadStream(path).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  }
}).listen(port, () => console.log(`smaltui: http://localhost:${port}/  (root ${root}${isolate ? ', cross-origin isolated' : ''})`));
