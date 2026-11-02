// Copies the static site into dist/ (what gets deployed): index.html, app/, vendor/, envs/, _headers.
// The page has no build step of its own; this only gathers the files a static host needs.
import { cpSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, process.argv[2] ?? 'dist');
if (!existsSync(join(root, 'vendor/smaltdb/smaltdb.js'))) {
  console.error('vendor/smaltdb is missing: run `npm install` (it copies the smaltdb npm package there).');
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of ['index.html', 'app', 'vendor', 'envs', '_headers', 'LICENSE']) if (existsSync(join(root, f))) cpSync(join(root, f), join(out, f), { recursive: true });
console.log(`site written to ${out}`);
