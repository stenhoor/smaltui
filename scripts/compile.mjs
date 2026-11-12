// Compiles the TypeScript sources (app/*.ts, site/*.ts) to JavaScript next to them: app/main.ts → app/main.js.
// The pages load those .js files directly, so serving the repo, building dist/ and the tests all work on the output.
// The compiled files are generated (gitignored). Type checking is separate: `npm run typecheck` (tsc 7, strict).
//
//   node scripts/compile.mjs           # compile once (runs on npm install, serve, build and test)
//   node scripts/compile.mjs --watch   # recompile on change (npm run dev)
import { context } from 'esbuild';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['app', 'site'];

export function sources() {
  return DIRS.flatMap((d) => readdirSync(join(root, d)).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts')).map((f) => join(root, d, f)));
}

/** Compile once, or keep watching. Returns the esbuild context (disposed unless watching). */
export async function compile({ watch = false, quiet = false } = {}) {
  const ctx = await context({
    entryPoints: sources(),
    outbase: root,
    outdir: root,
    bundle: false, // one .js per .ts: imports stay as written ('./sql.js'), as the pages and the build expect
    format: 'esm',
    target: 'es2022',
    sourcemap: 'linked',
    logLevel: quiet ? 'error' : 'warning',
  });
  if (watch) {
    await ctx.watch();
    console.log(`compile: watching ${DIRS.map((d) => d + '/*.ts').join(', ')}`);
    return ctx;
  }
  await ctx.rebuild();
  await ctx.dispose();
  if (!quiet) console.log(`compile: ${sources().length} TypeScript files → .js`);
  return null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await compile({ watch: process.argv.includes('--watch') });
}
