// Bundles smaltui's engine into vendor/smaltdb/, the folder the page loads it from (same-origin, so it works offline
// and under cross-origin isolation):
//
//   smaltdb.js           the smaltdb client, plus the client helpers of the plugins (importCSV, registerFile, …)
//   smaltdb-worker.js    the engine worker: smaltdb with the SQL language (smaltql) and the plugins smaltui uses,
//                        @smaltdb/io (CSV, JSON), @smaltdb/external (files, URLs, S3, Azure) and @smaltdb/parquet
//   chunks/              code the worker loads on first use (hyparquet-compressors, for compressed Parquet)
//   VERSION.json         the pinned commits (packed.json) and package versions
//   THIRD_PARTY_NOTICES.txt  the licences of third-party code in the bundles
//
// and two folders TypeScript tabs load on first use:
//
//   vendor/smaltdf/smaltdf.js          @smaltdb/df, smaltdf's frames and expressions (it builds plans that run in the
//                                      worker)
//   vendor/smaltdb-sucrase/sucrase.js  @smaltworks/smaltdb-sucrase, the plugin that strips TypeScript types with
//                                      sucrase, with its own THIRD_PARTY_NOTICES.txt
//
// smaltdb has no language built in (smaltdb ADR 0015): the worker registers smaltql, and optional features are
// plugins built into it (ADR 0012). None of these packages is on npm yet: packed.json pins each to a commit, and
// `npm run deps` (scripts/fetch-packed.mjs) builds and installs them, then runs this script. To try a local checkout:
// `node scripts/fetch-packed.mjs --local smaltdb=../smaltdb && node scripts/vendor-smaltdb.mjs`.
import { build } from 'esbuild';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'vendor', 'smaltdb');
const pins = JSON.parse(readFileSync(join(root, 'packed.json'), 'utf8'));
const pkg = (name) => join(root, 'node_modules', name, 'package.json');

const missing = Object.keys(pins).filter((name) => !existsSync(pkg(name)));
if (missing.length > 0) {
  // `npm ci` removes the pinned packages: rebuild them, then this script runs again.
  console.warn(`vendor/smaltdb: ${missing.join(', ')} not installed; run \`npm run deps\` (after every npm ci or npm install).`);
  process.exit(0);
}

const CLIENT = `
export * from 'smaltdb';
export { importCSV, importJSON, exportCSV, exportJSON } from '@smaltdb/io/client';
export { registerFile, registerCredentials } from '@smaltdb/external/client';
`;
const WORKER = `
import { defineWorker } from 'smaltdb/worker-runtime';
import { sqlLanguage } from 'smaltql';
import { dfLanguage } from '@smaltdb/df';
import io from '@smaltdb/io';
import external from '@smaltdb/external';
import parquet from '@smaltdb/parquet';
defineWorker({ languages: [sqlLanguage, dfLanguage], plugins: [io, external, parquet] });
`;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const common = { bundle: true, format: 'esm', target: 'es2022', platform: 'browser', minify: true, legalComments: 'none', logLevel: 'warning', metafile: true, absWorkingDir: root };
const dfOut = join(root, 'vendor', 'smaltdf');
const tsOut = join(root, 'vendor', 'smaltdb-sucrase');
rmSync(dfOut, { recursive: true, force: true });
rmSync(tsOut, { recursive: true, force: true });
const [client, worker, df, ts] = await Promise.all([
  build({ ...common, stdin: { contents: CLIENT, resolveDir: root, sourcefile: 'smaltdb-client.js' }, outfile: join(out, 'smaltdb.js') }),
  build({ ...common, stdin: { contents: WORKER, resolveDir: root, sourcefile: 'smaltdb-worker.js' }, outdir: out, entryNames: 'smaltdb-worker', splitting: true, chunkNames: 'chunks/[name]-[hash]' }),
  build({ ...common, stdin: { contents: "export * from '@smaltdb/df';", resolveDir: root, sourcefile: 'smaltdf.js' }, outfile: join(dfOut, 'smaltdf.js') }),
  build({ ...common, stdin: { contents: "export { transpile } from '@smaltworks/smaltdb-sucrase';", resolveDir: root, sourcefile: 'sucrase.js' }, outfile: join(tsOut, 'sucrase.js') }),
]);

// Notices: every package from node_modules in a folder's bundles, other than the smalt family (MIT, ours), written
// into that folder. Packages a nested node_modules holds (sucrase's own dependencies) are found there.
const ours = new Set([...Object.keys(pins), 'smaltkit']);
function writeNotices(folder, results) {
  const packages = new Map();
  for (const r of results) {
    for (const input of Object.keys(r.metafile.inputs)) {
      const m = /^(.*node_modules\/((?:@[^/]+\/)?[^/]+))\//.exec(input);
      if (m && !ours.has(m[2])) packages.set(m[2], m[1]);
    }
  }
  const notices = [];
  for (const [name, path] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    const dir = join(root, path);
    const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const licence = readdirSync(dir).find((f) => /^(licen[cs]e|copying|notice)/i.test(f));
    notices.push(`${name}@${meta.version} (${meta.license ?? 'see below'})\n\n${licence ? readFileSync(join(dir, licence), 'utf8').trim() : '(no licence file in the package)'}`);
  }
  const rel = folder.slice(root.length + 1);
  writeFileSync(join(folder, 'THIRD_PARTY_NOTICES.txt'), `Third-party code bundled into ${rel}/ by scripts/vendor-smaltdb.mjs.\n\n${notices.join('\n\n' + '-'.repeat(78) + '\n\n')}\n`);
  return notices.length;
}
const noticeCount = writeNotices(out, [client, worker, df]);
const tsNotices = writeNotices(tsOut, [ts]);

const versions = Object.fromEntries(Object.keys(pins).map((name) => [name, { version: JSON.parse(readFileSync(pkg(name), 'utf8')).version, commit: pins[name].ref ?? null }]));
const smaltdb = versions.smaltdb;
writeFileSync(join(out, 'VERSION.json'), JSON.stringify({ source: 'packed', version: smaltdb.version, commit: smaltdb.commit, packages: versions }, null, 2) + '\n');
console.log(`vendor/smaltdb: smaltdb@${smaltdb.version} (${smaltdb.commit?.slice(0, 7)}) with ${Object.keys(pins).filter((n) => n !== 'smaltdb' && n !== '@smaltworks/smaltdb-sucrase').join(', ')}${noticeCount ? `; notices for ${noticeCount} third-party packages` : ''}`);
console.log(`vendor/smaltdb-sucrase: @smaltworks/smaltdb-sucrase@${versions['@smaltworks/smaltdb-sucrase'].version}; notices for ${tsNotices} third-party packages`);
