// Examples are tests (BRAND.md, Documentation, rule 5): every SQL, TypeScript and Cypher example in the docs runs here, as
// the site's playgrounds run it (docs/.vitepress/theme/examples.ts, the same code), and the result printed under it
// must be what it gives.
//
//   node test/docs-examples.mjs              # check (npm test runs it; CI too)
//   UPDATE_DOCS=1 node test/docs-examples.mjs   # write each example's result under it
//
// Each page runs top to bottom, as a playground's setup is built (the site kit's playground.ts):
// - SQL on one in-memory database (smaltdb's engine with smaltql): `docs:setup` SQL and the SQL examples above.
// - TypeScript (smaltdf) on another: `docs:setup` SQL and the TypeScript examples above. Only an example with a result
//   under it runs (the site's `onlyWithResult`); one without is code for a page.
// - Cypher on smaltcy, one graph per sample dataset (`dataset=…` on the fence, or the page's front matter `play:`,
//   else `social`): the Cypher examples above on the same dataset.
//
// Markers, an HTML comment on the line before a fence: `docs:skip` (not run), `docs:error CODE` (its last statement
// must fail with CODE), `docs:setup <SQL>` (data, run first), `docs:unordered` (rows in any order).
// Results: a Markdown table after the fence (`NULL` for null), or a ```text fence for printed text and notes.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'smaltdb/engine';
import { registerLanguage } from 'smaltdb/language';
import { sqlLanguage } from '@smaltworks/smaltql';
import * as df from '@smaltdb/df';
import { stripTypes } from 'smaltkit/typescript';
import { open as openGraph } from '@smaltworks/smaltcy';
import * as datasets from '@smaltworks/smaltcy/datasets';
import { cellText, cypherTable, isSql, runSql, runTypeScript } from '../docs/.vitepress/theme/examples.ts';

registerLanguage(sqlLanguage);

const UPDATE = process.env.UPDATE_DOCS === '1';
const LANGS = new Set(['sql', 'ts', 'cypher']);
const pages = [];
const walk = (dir) => {
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e.endsWith('.md')) pages.push(p);
  }
};
walk('docs/guide');
walk('docs/reference');
pages.push('docs/playground.md');

/** The page's examples: fences of the playground languages, their markers, attributes and the result printed under them. */
function examples(text) {
  const lines = text.split('\n');
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const play = {};
  if (fm) {
    const block = /^play:\n((?:[ \t]+\S.*\n?)+)/m.exec(fm[1] + '\n');
    for (const m of (block?.[1] ?? '').matchAll(/^[ \t]+(\w+):\s*(\S+)/gm)) play[m[1]] = m[2];
  }
  const out = [];
  let markers = [];
  for (let i = 0; i < lines.length; i++) {
    const marker = /^\s*<!--\s*(docs:[\s\S]*?)\s*-->\s*$/.exec(lines[i]);
    if (marker) {
      markers.push(marker[1]);
      continue;
    }
    const open = /^(`{3,})(\w+)(.*)$/.exec(lines[i]);
    if (!open) {
      if (lines[i].trim()) markers = [];
      continue;
    }
    const fence = open[1];
    let j = i + 1;
    while (j < lines.length && !lines[j].startsWith(fence)) j++;
    const code = lines.slice(i + 1, j).join('\n');
    const flags = open[3].trim().split(/\s+/).filter(Boolean);
    const attrs = { ...play };
    for (const f of flags) {
      const kv = /^(\w+)=(\S+)$/.exec(f);
      if (kv) attrs[kv[1]] = kv[2];
    }
    // What is printed under it: a table, or a text fence, after blank lines.
    let k = j + 1;
    while (k < lines.length && !lines[k].trim()) k++;
    let result = null;
    if (LANGS.has(open[2])) {
      if (lines[k]?.startsWith('|')) {
        let e = k;
        while (e < lines.length && lines[e].startsWith('|')) e++;
        result = { kind: 'table', start: k, end: e };
      } else if (/^```text\s*$/.test(lines[k] ?? '')) {
        let e = k + 1;
        while (e < lines.length && !/^```\s*$/.test(lines[e])) e++;
        result = { kind: 'text', start: k, end: e + 1 };
      }
    }
    out.push({ lang: open[2], code, line: i + 1, markers, attrs, result, lines: [i, j] });
    markers = [];
    i = j;
  }
  return out;
}

const splitRow = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => {
      const t = c.trim().replace(/\\\|/g, '|');
      const m = /^`(.*)`$/.exec(t);
      return m ? m[1] : t;
    });

function printed(lines, result) {
  if (result.kind === 'text') return { text: lines.slice(result.start + 1, result.end - 1).join('\n') };
  const rows = lines.slice(result.start, result.end).map(splitRow);
  return { columns: rows[0], rows: rows.slice(2) };
}

const escCell = (s) => {
  const t = cellText(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return /^\s|\s$|^$/.test(t) && t !== '' ? `\`${t}\`` : t;
};

function render(r) {
  if (r.columns.length) {
    return [`| ${r.columns.join(' | ')} |`, `| ${r.columns.map(() => '---').join(' | ')} |`, ...r.rows.map((row) => `| ${row.map(escCell).join(' | ')} |`)];
  }
  return ['```text', ...String(r.text ?? r.note ?? '').split('\n'), '```'];
}

let failures = 0;
let ran = 0;
const fail = (where, msg) => {
  failures++;
  console.error(`✗ ${where}: ${msg}`);
};

for (const page of pages) {
  let text;
  try {
    text = readFileSync(page, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split('\n');
  const blocks = examples(text);
  if (!blocks.some((b) => LANGS.has(b.lang))) continue;
  const sqlDb = Database.openMemory();
  const tsDb = Database.openMemory();
  const sqlOf = (db) => ({ exec: async (s) => db.execAsync(s), query: async (s) => db.queryAsync(s) });
  const graphs = new Map();
  const graphFor = (name) => {
    if (!graphs.has(name)) {
      const make = datasets[name.replace(/-(\w)/g, (_m, c) => c.toUpperCase())];
      if (typeof make !== 'function') throw new Error(`no sample dataset ${name}`);
      const g = openGraph();
      g.load(make());
      graphs.set(name, g);
    }
    return graphs.get(name);
  };
  const edits = [];
  for (const b of blocks) {
    for (const m of b.markers) {
      const setup = /^docs:setup\s+([\s\S]*)$/.exec(m);
      if (setup) {
        await runSql(setup[1], sqlOf(sqlDb));
        await runSql(setup[1], sqlOf(tsDb));
      }
    }
    if (!LANGS.has(b.lang) || b.markers.includes('docs:skip')) continue;
    const where = `${page}:${b.line}`;
    if (b.lang === 'ts' && !b.result) {
      // No playground of its own (onlyWithResult), but the examples after it run it first, as their setup.
      if (isSql(b.code)) continue;
      try {
        await runTypeScript(b.code, { df, db: tsDb, strip: stripTypes });
      } catch (e) {
        fail(where, `${e.message}\n${b.code}`);
      }
      continue;
    }
    const err = b.markers.map((m) => /^docs:error\s+(\S+)/.exec(m)?.[1]).find(Boolean);
    let result;
    try {
      if (b.lang === 'sql') result = await runSql(b.code, sqlOf(sqlDb));
      else if (b.lang === 'ts') result = await runTypeScript(b.code, { df, db: tsDb, strip: stripTypes });
      else result = cypherTable(graphFor(b.attrs.dataset ?? 'social').run(b.code));
      ran++;
    } catch (e) {
      if (err) {
        ran++;
        const code = e.code ?? e.message;
        if (code !== err) fail(where, `expected error ${err}, got ${code}`);
        continue;
      }
      fail(where, `${e.message}\n${b.code}`);
      continue;
    }
    if (err) {
      fail(where, `expected error ${err}, but it ran`);
      continue;
    }
    if (UPDATE) {
      if (b.lang === 'sql' && !result.columns.length && !b.result) continue; // a statement that writes needs no result
      edits.push({ at: b.result ? [b.result.start, b.result.end] : [b.lines[1] + 1, b.lines[1] + 1], text: render(result), blank: !b.result });
      continue;
    }
    if (!b.result) continue;
    const want = printed(lines, b.result);
    if (want.text !== undefined) {
      const got = String(result.text ?? result.note ?? '');
      if (got.trim() !== want.text.trim()) fail(where, `printed\n${got}\nexpected\n${want.text}`);
      continue;
    }
    if (JSON.stringify(result.columns) !== JSON.stringify(want.columns)) {
      fail(where, `columns ${JSON.stringify(result.columns)}, expected ${JSON.stringify(want.columns)}`);
      continue;
    }
    const got = result.rows.map((r) => r.map((v) => cellText(v)));
    const key = (r) => JSON.stringify(r);
    const [g, w] = b.markers.includes('docs:unordered') ? [got.map(key).sort(), want.rows.map(key).sort()] : [got.map(key), want.rows.map(key)];
    if (JSON.stringify(g) !== JSON.stringify(w)) fail(where, `rows\n${got.map(key).join('\n')}\nexpected\n${want.rows.map(key).join('\n')}`);
  }
  sqlDb.close();
  tsDb.close();
  if (UPDATE && edits.length) {
    for (const e of edits.sort((a, b) => b.at[0] - a.at[0])) lines.splice(e.at[0], e.at[1] - e.at[0], ...(e.blank ? ['', ...e.text] : e.text));
    writeFileSync(page, lines.join('\n'));
    console.log(`wrote ${edits.length} result(s) in ${page}`);
  }
}

if (failures) {
  console.error(`\n${failures} example(s) failed of ${ran} run`);
  process.exit(1);
}
console.log(`docs examples: ${ran} ran, every printed result matches`);
