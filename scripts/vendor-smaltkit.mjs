// Copies smaltkit's built modules into vendor/smaltkit/, where the pages load them (same-origin, no bundler):
// app/main.ts imports '../vendor/smaltkit/urls.js'. The .d.ts files come along so `tsc` types those imports.
//
//   node scripts/vendor-smaltkit.mjs   # runs on `npm install`
//
// smaltkit is pinned to a commit in package.json ("github:stenhoor/smaltkit#<commit>") until it is on npm; to move
// to a newer one, `npm install github:stenhoor/smaltkit#<commit>` (this script then runs again).
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'vendor', 'smaltkit');
let pkgDir;
try {
  // smaltkit's exports map lists only its modules, so find the package from its entry point (dist/index.js).
  pkgDir = dirname(dirname(createRequire(join(root, 'package.json')).resolve('smaltkit')));
} catch {
  console.error('smaltkit is not installed: run `npm install`.');
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(pkgDir, 'dist'), out, { recursive: true, filter: (p) => !p.endsWith('.map') });
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const spec = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies.smaltkit;
writeFileSync(join(out, 'VERSION.json'), JSON.stringify({ version: pkg.version, spec }, null, 2) + '\n');
console.log(`vendor/smaltkit: smaltkit@${pkg.version} (${spec})`);
