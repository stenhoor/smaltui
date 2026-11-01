// Puts a smaltdb build in vendor/smaltdb/ (smaltdb.js + smaltdb-worker.js), the engine the page loads by default.
//
// smaltdb is not on npm yet, so by default this bundles it from source:
//   node scripts/vendor-smaltdb.mjs                      # clone github.com/stenhoor/smaltdb (main) into .cache/ and bundle
//   node scripts/vendor-smaltdb.mjs --ref <sha|branch>   # a specific revision
//   node scripts/vendor-smaltdb.mjs --from ../smaltdb    # an existing checkout
//   node scripts/vendor-smaltdb.mjs --npm                # once published: copy node_modules/smaltdb/dist
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'vendor', 'smaltdb');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const repo = opt('--repo') ?? process.env.SMALTDB_REPO ?? 'https://github.com/stenhoor/smaltdb.git';
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

if (args.includes('--npm')) {
  const pkgDir = join(root, 'node_modules', 'smaltdb');
  if (!existsSync(pkgDir)) throw new Error('smaltdb is not installed: npm install smaltdb');
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  for (const f of ['smaltdb.js', 'smaltdb-worker.js']) cpSync(join(pkgDir, 'dist', f), join(out, f));
  writeFileSync(join(out, 'VERSION.json'), JSON.stringify({ source: 'npm', version: pkg.version }, null, 2) + '\n');
  console.log(`vendored smaltdb@${pkg.version} from npm`);
  process.exit(0);
}

let src = opt('--from') ?? process.env.SMALTDB_DIR;
if (!src) {
  src = join(root, '.cache', 'smaltdb');
  const ref = opt('--ref') ?? process.env.SMALTDB_REF ?? 'main';
  if (!existsSync(join(src, '.git'))) execFileSync('git', ['clone', '--quiet', repo, src], { stdio: 'inherit' });
  git(src, 'fetch', '--quiet', 'origin', ref);
  git(src, 'checkout', '--quiet', '--detach', 'FETCH_HEAD');
}
src = resolve(src);
let commit = 'unknown';
try {
  commit = git(src, 'rev-parse', 'HEAD');
} catch {}

const common = { bundle: true, format: 'esm', target: 'es2022', platform: 'browser', minify: true, legalComments: 'none', logLevel: 'warning' };
await Promise.all([
  build({ ...common, entryPoints: [join(src, 'src/client/index.ts')], outfile: join(out, 'smaltdb.js') }),
  build({ ...common, entryPoints: [join(src, 'src/engine/worker.ts')], outfile: join(out, 'smaltdb-worker.js') }),
]);
const pkg = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'));
writeFileSync(join(out, 'VERSION.json'), JSON.stringify({ source: 'git', repo, commit, version: pkg.version, builtAt: new Date().toISOString() }, null, 2) + '\n');
console.log(`vendored smaltdb ${commit.slice(0, 12)} into vendor/smaltdb/`);
