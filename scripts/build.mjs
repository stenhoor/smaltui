// Assembles the static site in dist/ (what GitHub Pages serves, at /smaltui/):
//
//   dist/                                       the product site: docs/, built with VitePress on the smaltworks docs
//                                               theme (brand/themes/vitepress), as smaltworks.dev and smaltbi are
//   dist/console.html, console.css, demo.js     the live SQL console (from site/), embedded in the home page
//   dist/workbench/                             the full workbench: index.html, app/, vendor/, envs/, brand/
//
// The site's base is /smaltui/ (DOCS_BASE overrides it), so serve the folder at that path: `npm run preview` does.
// It compiles the TypeScript (scripts/compile.mjs), gathers files (the .js output, not the .ts sources), then stamps every local CSS and JS reference with a build version
// (`styles.css?v=<hash>`, `from './sql.js?v=<hash>'`). GitHub Pages lets browsers reuse files for up to 10 minutes,
// so without it a new page can run with the previous deploy's stylesheet or modules (seen after the brand deploy:
// new HTML with old CSS showed the light and dark logos at once). Preview it with `npm run preview`.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from './compile.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, process.argv[2] ?? 'dist');
if (!existsSync(join(root, 'vendor/smaltdb/smaltdb.js'))) {
  console.error('vendor/smaltdb is missing: run `npm run deps` (it builds the pinned smaltdb packages and bundles the engine there).');
  process.exit(1);
}
await compile({ quiet: true });
rmSync(out, { recursive: true, force: true });
// VitePress first: it empties its output folder. Its assets are content-hashed already.
execFileSync(process.execPath, [join(root, 'node_modules/vitepress/bin/vitepress.js'), 'build', 'docs', '--outDir', out], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
// TypeScript sources stay out of the site; the .js and its source map (with the sources embedded) are enough.
const noTs = (src) => !/\.ts$/.test(src);
mkdirSync(join(out, 'workbench'), { recursive: true });
for (const f of ['index.html', 'app', 'vendor', 'envs', 'brand']) cpSync(join(root, f), join(out, 'workbench', f), { recursive: true, filter: noTs });
cpSync(join(root, 'site'), out, { recursive: true, filter: noTs });
// The console imports the workbench modules as ../app/ and ../vendor/ in the repo; in the site they live under ./workbench/.
writeFileSync(join(out, 'demo.js'), readFileSync(join(out, 'demo.js'), 'utf8').replace(/(["'])\.\.\/(app|vendor)\//g, '$1./workbench/$2/'));
for (const f of ['_headers', 'LICENSE']) if (existsSync(join(root, f))) cpSync(join(root, f), join(out, f));
writeFileSync(join(out, '.nojekyll'), '');

const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
const all = files(out).sort();

// One version for the whole build: a hash of every file's path and content, so any change gives new URLs.
const hash = createHash('sha256');
for (const f of all) hash.update(relative(out, f)).update('\0').update(readFileSync(f));
const version = hash.digest('hex').slice(0, 12);

const local = (url) => !/^([a-z]+:|\/\/|#|\/)/i.test(url) && !url.includes('?');
let stamped = 0;
const stamp = (url) => {
  stamped++;
  return `${url}?v=${version}`;
};
for (const f of all) {
  // The smaltdb engine in vendor/ is loaded by computed URL and changes only with its pins; VitePress's assets/ are
  // content-hashed, and its pages refer to them by absolute URL.
  const parts = relative(out, f).split(/[\\/]/);
  if (parts.includes('vendor') || parts[0] === 'assets') continue;
  if (f.endsWith('.html')) {
    const html = readFileSync(f, 'utf8').replace(/(<(?:link|script)\b[^>]*?\s(?:href|src)=")([^"]+\.(?:css|js))"/g, (m, pre, url) => (local(url) ? `${pre}${stamp(url)}"` : m));
    writeFileSync(f, html);
  } else if (f.endsWith('.js')) {
    const js = readFileSync(f, 'utf8').replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+\.js)\2/g, (m, pre, q, url) => (local(url) ? `${pre}${q}${stamp(url)}${q}` : m));
    writeFileSync(f, js);
  }
}
writeFileSync(join(out, 'workbench', 'BUILD.json'), JSON.stringify({ version, builtAt: new Date().toISOString() }, null, 2) + '\n');
console.log(`site written to ${out}  (site: /, console: /console.html, workbench: /workbench/; build ${version}, ${stamped} asset references versioned)`);
