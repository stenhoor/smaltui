// Copies smaltui's brand assets from stenhoor/smalt-brand into brand/, pinned to a commit.
//
//   node scripts/sync-brand.mjs                 # re-copy at the commit recorded in brand/VERSION.json
//   node scripts/sync-brand.mjs --ref <full sha|branch|tag> # move to another smalt-brand commit
//   node scripts/sync-brand.mjs --from ../smalt-brand   # from a local checkout (its HEAD)
//   node scripts/sync-brand.mjs --check         # fail if brand/ differs from smalt-brand at the recorded commit (CI)
//
// smalt-brand is the source of truth (see CLAUDE.md): brand/ is a verbatim copy, never edited by hand.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'brand');
const REPO = 'stenhoor/smalt-brand';
const FILES = [
  'tokens/tokens.css',
  'logos/smaltui/app-icon.svg',
  'logos/smaltui/chevron-mark.svg',
  'logos/smaltui/chevron-mark-on-dark.svg',
  'logos/smaltui/favicon-16.svg',
  'logos/smaltui/favicon-32.svg',
  'logos/smaltui/lockup.svg',
  'logos/smaltui/lockup-on-dark.svg',
  'logos/smaltui/wordmark.svg',
  'logos/smaltui/wordmark-on-dark.svg',
  'badges/powered-by-smaltdb.svg',
  'badges/powered-by-smaltdb-on-dark.svg',
  'badges/powered-by-smaltui.svg',
  'badges/powered-by-smaltui-on-dark.svg',
  // Before 1.0 (BRAND.md): the stage badge, and the smaltworks endorsement for footers and READMEs.
  'badges/work-in-progress.svg',
  'badges/work-in-progress-on-dark.svg',
  'badges/a-smaltworks-project.svg',
  'badges/a-smaltworks-project-on-dark.svg',
];

const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const check = args.includes('--check');
const from = opt('--from') ? resolve(opt('--from')) : null;
const recorded = existsSync(join(out, 'VERSION.json')) ? JSON.parse(readFileSync(join(out, 'VERSION.json'), 'utf8')) : null;

let commit;
let read;
if (from) {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: from, encoding: 'utf8' }).trim();
  read = async (f) => readFileSync(join(from, f));
} else {
  const ref = opt('--ref') ?? recorded?.commit ?? 'main';
  if (/^[0-9a-f]{7,39}$/.test(ref)) throw new Error(`--ref ${ref}: use the full 40-character commit SHA, or a branch or tag name`);
  commit = /^[0-9a-f]{40}$/.test(ref) ? ref : await resolveRef(ref);
  read = async (f) => {
    const url = `https://raw.githubusercontent.com/${REPO}/${commit}/${f}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  };
}

async function resolveRef(ref) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/commits/${encodeURIComponent(ref)}`, { headers: { Accept: 'application/vnd.github.sha' } });
  if (r.ok) return (await r.text()).trim();
  // The API can be rate-limited or blocked: fall back to git.
  const line = execFileSync('git', ['ls-remote', `https://github.com/${REPO}.git`, ref], { encoding: 'utf8' }).split('\n')[0];
  if (!line) throw new Error(`cannot resolve ${REPO}@${ref}`);
  return line.split(/\s+/)[0];
}

const files = Object.fromEntries(await Promise.all(FILES.map(async (f) => [f, await read(f)])));

if (check) {
  const diffs = FILES.filter((f) => !existsSync(join(out, f)) || !readFileSync(join(out, f)).equals(files[f]));
  if (recorded?.commit !== commit) diffs.unshift(`VERSION.json (records ${recorded?.commit ?? 'nothing'})`);
  if (diffs.length) {
    console.error(`brand/ differs from ${REPO}@${commit.slice(0, 7)}:\n  ${diffs.join('\n  ')}\nRun: node scripts/sync-brand.mjs`);
    process.exit(1);
  }
  console.log(`brand/ matches ${REPO}@${commit.slice(0, 7)} (${FILES.length} files)`);
} else {
  rmSync(out, { recursive: true, force: true });
  for (const [f, data] of Object.entries(files)) {
    mkdirSync(dirname(join(out, f)), { recursive: true });
    writeFileSync(join(out, f), data);
  }
  writeFileSync(join(out, 'VERSION.json'), JSON.stringify({ source: `https://github.com/${REPO}`, commit, files: FILES }, null, 2) + '\n');
  writeFileSync(join(out, 'README.md'), `# brand/\n\nA verbatim copy of smaltui's assets from [${REPO}](https://github.com/${REPO}/tree/${commit}) at \`${commit.slice(0, 7)}\`.\nDon't edit these files: change them in smalt-brand, then run \`npm run brand:sync -- --ref <commit>\`.\nCI runs \`node scripts/sync-brand.mjs --check\` to keep the copy exact.\n`);
  console.log(`brand/: ${FILES.length} files from ${REPO}@${commit.slice(0, 7)}`);
}
