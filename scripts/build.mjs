// Assembles the static site in dist/ (what GitHub Pages serves):
//
//   dist/index.html, site.css, demo.js   landing page with a live console (from site/)
//   dist/workbench/                      the full workbench: index.html, app/, vendor/, envs/, brand/
//
// Nothing is compiled; this only gathers files. Preview it with `npm run preview`.
import { cpSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, process.argv[2] ?? 'dist');
if (!existsSync(join(root, 'vendor/smaltdb/smaltdb.js'))) {
  console.error('vendor/smaltdb is missing: run `npm install` (it copies the smaltdb npm package there).');
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'workbench'), { recursive: true });
for (const f of ['index.html', 'app', 'vendor', 'envs', 'brand']) cpSync(join(root, f), join(out, 'workbench', f), { recursive: true });
cpSync(join(root, 'site'), out, { recursive: true });
for (const f of ['_headers', 'LICENSE']) if (existsSync(join(root, f))) cpSync(join(root, f), join(out, f));
writeFileSync(join(out, '.nojekyll'), '');
console.log(`site written to ${out}  (landing: /, workbench: /workbench/)`);
