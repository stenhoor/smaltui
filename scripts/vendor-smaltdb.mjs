// Copies the smaltdb browser build into vendor/smaltdb/, the engine the page loads by default
// (same-origin, so it works offline and under cross-origin isolation).
//
//   node scripts/vendor-smaltdb.mjs                    # from the installed npm package (runs on `npm install`)
//   node scripts/vendor-smaltdb.mjs --from ../smaltdb  # bundle an unreleased local checkout instead
//
// The npm package is the source of truth: its version is pinned in package.json / package-lock.json.
// To move to a newer smaltdb: `npm install smaltdb@latest` (this script then runs again).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'vendor', 'smaltdb');
const args = process.argv.slice(2);
const from = args.includes('--from') ? resolve(args[args.indexOf('--from') + 1]) : null;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

if (!from) {
  let pkgDir;
  try {
    pkgDir = dirname(createRequire(join(root, 'package.json')).resolve('smaltdb/package.json'));
  } catch {
    console.error('smaltdb is not installed: run `npm install`.');
    process.exit(1);
  }
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  const dist = join(pkgDir, 'dist');
  // The worker loads its Parquet reader from chunks/ on first use; source maps are left out.
  for (const f of ['smaltdb.js', 'smaltdb-worker.js']) cpSync(join(dist, f), join(out, f));
  if (existsSync(join(dist, 'chunks'))) cpSync(join(dist, 'chunks'), join(out, 'chunks'), { recursive: true, filter: (p) => !p.endsWith('.map') });
  writeFileSync(join(out, 'VERSION.json'), JSON.stringify({ source: 'npm', version: pkg.version }, null, 2) + '\n');
  console.log(`vendor/smaltdb: smaltdb@${pkg.version} from npm`);
} else {
  // A local checkout: bundle it the way smaltdb's own build does (the worker code-split so the
  // Parquet reader is a lazily loaded chunk). Its optional dependencies resolve from the checkout.
  const { build } = await import('esbuild');
  const common = { bundle: true, format: 'esm', target: 'es2022', platform: 'browser', minify: true, legalComments: 'none', logLevel: 'warning', nodePaths: [join(from, 'node_modules'), join(root, 'node_modules')] };
  await Promise.all([
    build({ ...common, entryPoints: [join(from, 'src/client/index.ts')], outfile: join(out, 'smaltdb.js') }),
    build({ ...common, entryPoints: { 'smaltdb-worker': join(from, 'src/engine/worker.ts') }, outdir: out, splitting: true, chunkNames: 'chunks/[name]-[hash]' }),
  ]);
  const pkg = JSON.parse(readFileSync(join(from, 'package.json'), 'utf8'));
  let commit = null;
  try {
    const { execFileSync } = await import('node:child_process');
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: from, encoding: 'utf8' }).trim();
  } catch {}
  writeFileSync(join(out, 'VERSION.json'), JSON.stringify({ source: 'checkout', path: from, version: pkg.version, commit }, null, 2) + '\n');
  console.log(`vendor/smaltdb: local checkout ${from}${commit ? ' @ ' + commit.slice(0, 12) : ''} (run \`npm run vendor\` to go back to the npm package)`);
}
