// End-to-end smoke test: serves the folder, drives the page in headless Chromium.
// node test/e2e.mjs [--headed] [--shots <dir>]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = 8000 + Math.floor(Math.random() * 900);
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });

const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs'), root, '--port', String(port)], { stdio: 'pipe' });
await new Promise((r) => server.stdout.once('data', r));
const base = `http://localhost:${port}/`;
const browser = await chromium.launch({ headless: !process.argv.includes('--headed') });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
// The brand fonts come from Google Fonts; serve an empty stylesheet so tests run offline and deterministically
// (the pages fall back to system fonts, as they would if Google Fonts were unreachable).
await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
// TypeScript tabs strip types with smaltkit/typescript from vendor/: nothing for them may come from a CDN.
const cdnRequests = [];
ctx.on('request', (r) => {
  if (/^https:\/\/(cdn\.jsdelivr\.net|unpkg\.com|esm\.sh)\//.test(r.url())) cdnRequests.push(r.url());
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

let failures = 0;
async function step(name, fn) {
  try {
    await fn();
    console.log('  ✓', name);
  } catch (e) {
    failures++;
    console.log('  ✗', name, '\n    ', e.message.split('\n')[0]);
    if (shots) await page.screenshot({ path: join(shots, `fail-${name.replace(/\W+/g, '_')}.png`) });
  }
}
const shot = (n) => shots && page.screenshot({ path: join(shots, n + '.png') });
const activePane = () => page.locator('.pane.active');
async function typeSql(sql) {
  const ta = activePane().locator('textarea.ed-input');
  await ta.click();
  await ta.fill(sql);
}

try {
  await step('page loads and opens a database', async () => {
    await page.goto(base + '?db=e2e&storage=memory');
    await page.waitForFunction(() => window.smaltui?.db && document.querySelector('#dbName').textContent === 'e2e', null, { timeout: 15000 });
  });
  await shot('01-welcome');

  await step('smalt brand: tokens, Chevron favicon and lockup, both themes', async () => {
    const r = await page.evaluate(async () => {
      const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      const visibleLogo = () => [...document.querySelectorAll('.brand img')].find((i) => i.offsetParent !== null);
      const icon = document.querySelector('link[rel="icon"]').href;
      const iconOk = (await fetch(icon)).ok;
      const light = { primary: css('--primary'), font: css('--font-sans'), logo: visibleLogo()?.src.split('/').pop(), logoLoaded: visibleLogo()?.naturalWidth > 0 };
      const btnFont = getComputedStyle(document.querySelector('.btn-label')).fontFamily;
      document.documentElement.dataset.theme = 'dark';
      const dark = { primary: css('--primary'), logo: visibleLogo()?.src.split('/').pop() };
      document.documentElement.dataset.theme = 'light';
      return { icon: icon.split('/').slice(-3).join('/'), iconOk, light, dark, btnFont };
    });
    const ok = r.iconOk && r.icon === 'logos/smaltui/favicon-32.svg' && r.light.primary.toUpperCase() === '#003399' && /Geist/.test(r.light.font) &&
      r.light.logo === 'lockup.svg' && r.light.logoLoaded && r.dark.primary.toUpperCase() === '#9DB4F5' && r.dark.logo === 'lockup-on-dark.svg' && !/Martian/.test(r.btnFont);
    if (!ok) throw new Error(JSON.stringify(r));
  });

  await step('create a table and insert rows from a script', async () => {
    await page.locator('#btnNewQuery').click();
    await typeSql("CREATE TABLE people(id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INT);\nINSERT INTO people(name, age) VALUES ('Ada', 36), ('Grace', 85), ('Alan', 41);\nSELECT * FROM people ORDER BY age;");
    await page.keyboard.press('Control+Shift+Enter');
    await page.waitForFunction(() => document.querySelector('.pane.active .subtab.active')?.textContent.startsWith('Result'), null, { timeout: 10000 });
    const cells = await activePane().locator('.grid-table tbody td[data-col="1"]').allTextContents();
    if (cells.join(',') !== 'Ada,Alan,Grace') throw new Error('unexpected rows ' + cells);
    // The tree refreshes after the script, asynchronously: wait for it rather than look once.
    await page.locator('#tree [data-obj="people"]').first().waitFor({ timeout: 5000 }).catch(() => { throw new Error('tree not refreshed'); });
  });
  await shot('02-query');

  await step('statement at cursor + syntax error marking', async () => {
    await typeSql('SELEC 1');
    await page.keyboard.press('Control+Enter');
    await activePane().locator('.subtab.err').waitFor({ timeout: 5000 });
    if (!(await activePane().locator('mark.ed-err').count())) throw new Error('no error mark');
  });

  await step('bind variables dialog', async () => {
    await typeSql('SELECT name FROM people WHERE age > :min ORDER BY name');
    await page.keyboard.press('Control+Enter');
    await page.locator('dialog[open] input[name=v0]').fill('40');
    await page.locator('dialog[open] button.primary').click();
    await page.waitForFunction(() => document.querySelectorAll('.pane.active .grid-table tbody tr[data-row]').length === 2, null, { timeout: 5000 });
  });

  await step('explain shows a plan', async () => {
    await typeSql('SELECT * FROM people WHERE id = 2');
    await page.keyboard.press('Control+e');
    await activePane().locator('.plan').waitFor({ timeout: 5000 });
    const t = await activePane().locator('.plan').textContent();
    if (!/QUERY PLAN/.test(t)) throw new Error(t);
  });

  await step('large result fetches on demand', async () => {
    await typeSql('WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 5000) SELECT x, x * x AS sq FROM n');
    await page.keyboard.press('Control+Enter');
    await activePane().locator('[data-more]').waitFor({ timeout: 10000 });
    await activePane().locator('[data-all]').click();
    await page.waitForFunction(() => /5,000 rows|5000 rows/.test(document.querySelector('.pane.active .result-bar')?.textContent ?? ''), null, { timeout: 10000 });
  });

  await step('completion popup offers columns', async () => {
    await typeSql('SELECT p. FROM people p');
    const ta = activePane().locator('textarea.ed-input');
    await ta.evaluate((t) => t.setSelectionRange(9, 9));
    await page.keyboard.press('Control+Space');
    await activePane().locator('.ed-complete:not([hidden]) .ac-label', { hasText: 'name' }).first().waitFor({ timeout: 3000 });
    await page.keyboard.press('Escape');
  });

  await step('table viewer: open, edit a cell, filter', async () => {
    await page.locator('#tree [data-obj="people"] .nm').click();
    await activePane().locator('.grid-table tbody tr[data-row="0"]').waitFor({ timeout: 5000 });
    await activePane().locator('.grid-table tbody tr[data-row="0"] td[data-col="2"]').dblclick();
    await activePane().locator('input.grid-edit').fill('37');
    await page.keyboard.press('Enter');
    await page.waitForFunction(async () => (await window.smaltui.db.query('SELECT age FROM people WHERE id = 1'))[0].age === 37, null, { timeout: 5000 });
    await activePane().locator('[data-where]').fill('age > 40');
    await activePane().locator('[data-apply]').click();
    await page.waitForFunction(() => document.querySelector('.pane.active [data-range]')?.textContent === '1–2 of 2', null, { timeout: 5000 });
    for (const v of ['columns', 'indexes', 'constraints', 'ddl']) {
      await activePane().locator(`.subtab[data-view="${v}"]`).click();
      await page.waitForTimeout(150);
    }
    const ddl = await activePane().locator('pre.ddl').textContent();
    if (!/CREATE TABLE people/.test(ddl)) throw new Error('ddl ' + ddl);
  });
  await shot('03-table');

  await step('import CSV into a new table (paste)', async () => {
    await page.locator('#btnImport').click();
    await activePane().locator('[data-src="paste"]').click();
    await activePane().locator('[data-paste]').fill('code,label,score\nA,alpha,1.5\nB,beta,2\nC,,3\n');
    await activePane().locator('[data-use-paste]').click();
    await activePane().locator('[data-table]').fill('codes');
    await page.waitForFunction(() => document.querySelectorAll('.pane.active [data-preview] tbody tr[data-row]').length === 3, null, { timeout: 5000 });
    await activePane().locator('[data-do-import]').click();
    await activePane().locator('[data-imp-result] .inline-ok').waitFor({ timeout: 5000 });
    const n = await page.evaluate(async () => (await window.smaltui.db.query('SELECT count(*) AS n, count(label) AS l FROM codes'))[0]);
    if (n.n !== 3 || n.l !== 2) throw new Error(JSON.stringify(n));
  });
  await shot('04-import');

  await step('link an external table by URL', async () => {
    await activePane().locator('[data-lurl]').fill(base + 'envs/demo/data/exchange_rates.csv');
    await activePane().locator('[data-ltest]').click();
    await page.waitForFunction(() => document.querySelectorAll('.pane.active [data-lpreview] tbody tr[data-row]').length > 3, null, { timeout: 8000 });
    await activePane().locator('[data-lcreate]').click();
    await activePane().locator('[data-lresult] .inline-ok').waitFor({ timeout: 8000 });
    await page.locator('#tree [data-obj="exchange_rates"]').waitFor({ timeout: 3000 });
  });

  await step('Parquet: link by URL (range reads), read_parquet, import into a table', async () => {
    await activePane().locator('[data-lurl]').fill(base + 'test/fixtures/sales-zstd.parquet');
    await activePane().locator('[data-lname]').fill('sales_pq');
    await activePane().locator('[data-ltest]').click();
    await page.waitForFunction(() => document.querySelectorAll('.pane.active [data-lpreview] tbody tr[data-row]').length > 0, null, { timeout: 10000 });
    await activePane().locator('[data-lcreate]').click();
    await activePane().locator('[data-lresult] .inline-ok').waitFor({ timeout: 10000 });
    const r = await page.evaluate(async (url) => {
      const db = window.smaltui.db;
      const ext = (await db.query('SELECT count(*) AS n FROM sales_pq'))[0].n;
      const adhoc = (await db.query(`SELECT count(*) AS n FROM read_parquet('${url}')`))[0].n;
      const { importParquet } = await import('/app/env.js');
      const blob = await (await fetch(url)).blob();
      const imp = await importParquet(db, 'sales_local', blob);
      const local = (await db.query('SELECT count(*) AS n FROM sales_local'))[0].n;
      const kind = (await db.query("SELECT table_type FROM information_schema.tables WHERE table_name = 'sales_local'"))[0].table_type;
      return { ext, adhoc, imp: imp.rows, local, kind };
    }, base + 'test/fixtures/sales-zstd.parquet');
    if (!(r.ext > 0 && r.ext === r.adhoc && r.imp === r.ext && r.local === r.ext && r.kind === 'BASE TABLE')) throw new Error(JSON.stringify(r));
  });

  await step('Parquet: drop a file on the import card', async () => {
    await activePane().locator('[data-src="file"]').click();
    await page.evaluate(async (url) => {
      const blob = await (await fetch(url)).blob();
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'dropped_sales.parquet'));
      document.querySelector('.pane.active [data-drop]').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, base + 'test/fixtures/sales-zstd.parquet');
    await page.waitForFunction(() => document.querySelectorAll('.pane.active [data-preview] tbody tr[data-row]').length > 0, null, { timeout: 8000 });
    if ((await activePane().locator('[data-fmt]').inputValue()) !== 'parquet') throw new Error('format not detected');
    await activePane().locator('[data-do-import]').click();
    await activePane().locator('[data-imp-result] .inline-ok').waitFor({ timeout: 8000 });
    await page.locator('#tree [data-obj="dropped_sales"]').waitFor({ timeout: 3000 });
  });
  await shot('06-parquet-import');

  await step('GitHub page links are rewritten to raw files; CORS errors explain themselves', async () => {
    const r = await page.evaluate(async () => {
      const { normalizeDataUrl, corsHint } = await import('/vendor/smaltkit/urls.js');
      const blob = 'https://github.com/rfordatascience/tidytuesday/blob/main/data/2024/2024-01-23/english_education.csv';
      return {
        blob: normalizeDataUrl(blob).url,
        rawLink: normalizeDataUrl(blob.replace('/blob/', '/raw/') + '?raw=true').url,
        folder: normalizeDataUrl('https://github.com/o/r/tree/main/data').note,
        hint: corsHint(`fetching ${blob} failed: Failed to fetch (a network error, or a CORS error: the server must allow this origin)`),
        none: corsHint('SMALT_SYNTAX: near "x"'),
      };
    });
    const raw = 'https://raw.githubusercontent.com/rfordatascience/tidytuesday/main/data/2024/2024-01-23/english_education.csv';
    if (r.blob !== raw || r.rawLink !== raw || !/folder/.test(r.folder) || !r.hint.includes(raw) || r.none !== '') throw new Error(JSON.stringify(r));
    // The Link tab shows the rewrite and uses the raw URL in its SQL.
    await page.locator('#btnImport').click();
    await activePane().locator('[data-src="url"]').first().waitFor();
    await activePane().locator('[data-lurl]').fill('https://github.com/o/r/blob/main/x.csv');
    const sql = await activePane().locator('[data-lsql]').inputValue();
    const note = await activePane().locator('[data-lurl-note]').textContent();
    if (!sql.includes('https://raw.githubusercontent.com/o/r/main/x.csv') || !/raw file/.test(note)) throw new Error(sql + ' | ' + note);
  });

  await step('demo environment loads', async () => {
    await page.goto(base + '?env=envs/demo/env.json');
    await page.waitForFunction(() => window.smaltui?.db && window.smaltui.schema.tables.has('monthly_revenue'), null, { timeout: 20000 });
    const r = await page.evaluate(async () => (await window.smaltui.db.query('SELECT (SELECT count(*) FROM orders) AS o, (SELECT count(*) FROM customers) AS c, (SELECT count(*) FROM exchange_rates) AS x')));
    if (r[0].o !== 800 || r[0].c !== 60 || r[0].x !== 8) throw new Error(JSON.stringify(r));
    await page.locator('.tab', { hasText: 'Revenue by category' }).click();
    await page.keyboard.press('Control+Shift+Enter'); // focus may not be in editor; click first
    await activePane().locator('textarea.ed-input').click();
    await page.keyboard.press('Control+Shift+Enter');
    await page.waitForFunction(() => document.querySelectorAll('.pane.active .subtab[data-view^="r"]').length === 2, null, { timeout: 10000 });
  });
  await shot('05-demo');

  await step('TypeScript tab: smaltdf frames run in the engine, types are stripped, errors are reported', async () => {
    await page.goto(base + '?env=envs/demo/env.json');
    await page.waitForFunction(() => window.smaltui?.db && window.smaltui.schema.tables.has('orders'), null, { timeout: 20000 });
    // The demo's TypeScript tab: show() and the last expression are both results.
    await page.locator('.tab', { hasText: 'Frames (smaltdf)' }).click();
    await activePane().locator('textarea.ed-input').click();
    await page.keyboard.press('Control+Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('.pane.active .subtab')].some((b) => b.textContent.startsWith('Result')), null, { timeout: 20000 });
    const tabs = await page.evaluate(() => [...document.querySelectorAll('.pane.active .subtab')].map((b) => b.textContent));
    if (!tabs.includes('By category4') || !tabs.includes('Result10') || !tabs.includes('Plan data')) throw new Error(JSON.stringify(tabs));
    await activePane().locator('.subtab', { hasText: 'By category' }).click();
    const cat = await activePane().locator('.subpane.active tbody').innerText();
    if (!/Gear\s+14798\s+215/.test(cat)) throw new Error(cat);
    // Explain and Analyze, as in a SQL tab: the engine's plan of the tab's frame.
    await activePane().locator('[data-explain]').click();
    await page.waitForFunction(() => document.querySelector('.pane.active .subtab.active')?.textContent === 'Plan', null, { timeout: 20000 });
    const tree = await activePane().locator('.subpane.active .plan').innerText();
    if (!/QUERY PLAN[\s\S]*HASH JOIN[\s\S]*SCAN orders/.test(tree)) throw new Error('explain: ' + tree);
    await activePane().locator('[data-analyze]').click();
    await page.waitForFunction(() => document.querySelector('.pane.active .subtab.active')?.textContent === 'Analyze', null, { timeout: 20000 });
    const analyzed = await activePane().locator('.subpane.active thead').innerText();
    if (!/est_rows[\s\S]*rows/.test(analyzed)) throw new Error('analyze: ' + analyzed);
    // Plan data: the plan statement smaltdf sent, laid out by smaltkit/pretty (short parts kept on one line).
    await activePane().locator('.subtab', { hasText: 'Plan data' }).click();
    const planData = await activePane().locator('.subpane.active pre.plan').innerText();
    const parsed = JSON.parse(planData);
    if (!parsed || !/^\{\n {2}"/.test(planData) || !/\{ "[^\n]*\}/.test(planData)) throw new Error('plan data: ' + planData.slice(0, 400));
    // Format re-indents the tab's code, and the code still runs to the same result.
    const flat = "const big = table('products')\n.filter(col('price').gt(10))\n      .sort('price');\nif (big) {\nshow(big, 'Big')\n   }\nbig.head(3)";
    await activePane().locator('textarea.ed-input').fill(flat);
    await activePane().locator('[data-format]').click();
    const formatted = await activePane().locator('textarea.ed-input').inputValue();
    const want = "const big = table('products')\n  .filter(col('price').gt(10))\n  .sort('price');\nif (big) {\n  show(big, 'Big')\n}\nbig.head(3)\n";
    if (formatted !== want) throw new Error('format: ' + JSON.stringify(formatted));
    await activePane().locator('[data-run]').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.pane.active .subtab')].some((t) => t.textContent === 'Result3'), null, { timeout: 20000 }).catch(async (e) => {
      throw new Error(e.message + ' ' + (await page.evaluate(() => [...document.querySelectorAll('.pane.active .subtab, .pane.active .msg')].map((t) => t.textContent).join(' | '))));
    });
    // Code ending with a semicolon still shows its last expression.
    await activePane().locator('textarea.ed-input').fill("const n: number = 2;\ntable('products').sort('price').head(n);\n");
    await activePane().locator('[data-run]').click();
    await page.waitForFunction(() => document.querySelector('.pane.active .subtab.active')?.textContent === 'Result2', null, { timeout: 20000 });
    // A new tab: TypeScript annotations are stripped, smaltdf can be imported explicitly.
    await page.locator('#btnNewTs').click();
    await activePane().locator('textarea.ed-input').fill("import { table, col } from '@smaltdb/df';\nconst min: number = 10;\ntable('products').filter(col('price').gt(min)).select('name', 'price').sort('price')");
    await page.keyboard.press('Control+Enter');
    await page.waitForFunction(() => document.querySelector('.pane.active .subtab.active')?.textContent.startsWith('Result'), null, { timeout: 20000 });
    const rows = await activePane().locator('.subpane.active tbody tr[data-row]').count();
    const all = await page.evaluate(async () => (await window.smaltui.db.query('SELECT count(*) AS n FROM products WHERE price > 10'))[0].n);
    if (!rows || rows !== all) throw new Error(`price > 10: ${rows} rows shown, ${all} expected`);
    // A syntax error says where it is.
    await activePane().locator('textarea.ed-input').fill("const a = 1;\nconst b: number = ;");
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('.pane.active .msg.err', { timeout: 10000 });
    const syntax = await activePane().locator('.msg.err').last().innerText();
    if (!/line 2, column 19: An expression expected/.test(syntax)) throw new Error('syntax error: ' + syntax);
    // Code that would make code of its own (an enum) is refused, with where and what to write instead.
    await activePane().locator('textarea.ed-input').fill("const a = 1;\n  enum Color { Red }");
    await page.keyboard.press('Control+Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('.pane.active .msg.err')].some((m) => /line 2, column 3: An enum/.test(m.textContent ?? '')), null, { timeout: 10000 }).catch(async (e) => {
      throw new Error(e.message + ' ' + (await page.evaluate(() => [...document.querySelectorAll('.pane.active .msg.err')].map((m) => m.textContent).join(' | '))));
    });
    if (cdnRequests.length) throw new Error('TypeScript tabs fetched from a CDN: ' + cdnRequests.join(', '));
    // An unknown table is an error in Messages, and the tab is kept with the others.
    await activePane().locator('textarea.ed-input').fill("table('no_such_table').head(1)");
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('.pane.active .msg.err', { timeout: 10000 });
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('smaltui.tsTabs') ?? '[]'));
    if (!kept.some((t) => /no_such_table/.test(t.source))) throw new Error('TypeScript tab not kept: ' + JSON.stringify(kept));
  });
  await shot('06-typescript');

  await step('TypeScript tab: type errors are warnings, marked as the code is typed, and the code still runs', async () => {
    // Waits until the tab's current code has been checked (the pane records the code last checked).
    const checked = () =>
      page.waitForFunction(() => {
        const pane = document.querySelector('.pane.active');
        return pane?.dataset.checked !== undefined && pane.dataset.checked === pane.querySelector('textarea.ed-input')?.value;
      }, null, { timeout: 15000 });
    const mark = activePane().locator('.ed-hl mark.ed-warn');
    // The demo's tab, as written: no warnings.
    await page.locator('.tab', { hasText: 'Frames (smaltdf)' }).click();
    await checked();
    if (await mark.count()) throw new Error(`the demo tab has ${await mark.count()} warnings: ` + (await mark.first().getAttribute('title')));
    // An argument too many: a warning on it and its line, and the tab still runs.
    await page.locator('#btnNewTs').click();
    await activePane().locator('textarea.ed-input').fill("const n: number = 3;\ntable('products').sort('price').head(n, 'extra')");
    await checked();
    if ((await mark.count()) !== 1 || (await mark.innerText()) !== "'extra'") throw new Error('warnings: ' + (await activePane().locator('.ed-hl').innerHTML()));
    if ((await mark.getAttribute('title')) !== 'Expected 0-1 arguments, but got 2.') throw new Error('message: ' + (await mark.getAttribute('title')));
    const line = await activePane().locator('.sk-ed-warnline').innerText();
    if (line !== '2') throw new Error('gutter: ' + line);
    await activePane().locator('[data-run]').click();
    await page.waitForFunction(() => document.querySelector('.pane.active .subtab.active')?.textContent === 'Result3', null, { timeout: 20000 });
    // An edit clears the marks; fixed code has none.
    await activePane().locator('textarea.ed-input').fill("table('products').sort('price').head(3)");
    if (await mark.count()) throw new Error('marks kept after an edit');
    await checked();
    if (await mark.count()) throw new Error('warnings on fixed code');
    // A misspelt method: tsc's message, with its suggestion.
    await activePane().locator('textarea.ed-input').fill("table('products').sortt('price')");
    await checked();
    const title = await mark.getAttribute('title');
    if (title !== "Property 'sortt' does not exist on type 'Frame'. Did you mean 'sort'?") throw new Error('misspelt: ' + title);
  });
  await shot('06b-typecheck');

  await step('export environment round-trips', async () => {
    const m = await page.evaluate(async () => {
      const { exportManifest } = await import('/app/env.js');
      return exportManifest(window.smaltui.db, { dbName: 'demo', includeData: true });
    });
    if (!m.steps.some((s) => s.table === 'orders' && s.data.length === 800)) throw new Error('missing data');
  });

  await step('OPFS database persists across reloads', async () => {
    await page.goto(base + '?db=e2e_opfs');
    await page.waitForFunction(() => window.smaltui?.db, null, { timeout: 15000 });
    await page.evaluate(async () => {
      await window.smaltui.db.exec('CREATE TABLE IF NOT EXISTS keep(x INT)');
      await window.smaltui.db.exec('INSERT INTO keep VALUES (42)');
    });
    await page.reload();
    await page.waitForFunction(() => window.smaltui?.schema.tables.has('keep'), null, { timeout: 15000 });
    const r = await page.evaluate(async () => (await window.smaltui.db.query('SELECT count(*) AS n FROM keep'))[0].n);
    if (r < 1) throw new Error('lost data');
  });

  await step('built site served like GitHub Pages (/smaltui/ subpath, gzip, no isolation): home page, console, guide and workbench demo load', async () => {
    // Pages compresses responses: a HEAD reports the gzipped size, so code that takes a file's size from it
    // reads the wrong bytes (smaltui#7). Serve the build the same way, under the same subpath.
    const out = join(root, '.cache', 'site-e2e');
    await new Promise((res, rej) => spawn(process.execPath, [join(root, 'scripts/build.mjs'), join(out, 'smaltui')], { stdio: 'ignore' }).on('exit', (c) => (c ? rej(new Error('build failed')) : res())));
    const sitePort = port + 1;
    const site = spawn(process.execPath, [join(root, 'scripts/serve.mjs'), out, '--port', String(sitePort), '--no-isolation', '--gzip'], { stdio: 'pipe' });
    await new Promise((r) => site.stdout.once('data', r));
    try {
      const siteBase = `http://localhost:${sitePort}/smaltui/`;
      // The home page: VitePress on the smaltworks docs theme, as smaltworks.dev and smaltbi.
      await page.goto(siteBase);
      await page.waitForSelector('.VPHero .name', { timeout: 20000 });
      const home = await page.evaluate(async () => ({
        name: document.querySelector('.VPHero .name')?.textContent,
        // The tagline breaks after "Small. Alternative." on every smalt site (smalt-brand BRAND.md rule 2).
        text: document.querySelector('.VPHero .text')?.innerHTML,
        imgs: [...document.querySelectorAll('img')].filter((i) => i.offsetParent !== null).map((i) => [i.src.split('/').pop(), i.complete && i.naturalWidth > 0]),
        icon: (await fetch(document.querySelector('link[rel="icon"]').href)).ok,
      }));
      const shown = Object.fromEntries(home.imgs);
      if (home.name !== 'smaltui' || home.text !== 'Small. Alternative.<br>Query.' || !home.icon) throw new Error('home: ' + JSON.stringify(home));
      // The family's shared footer and stage badge (smalt-brand BRAND.md, "Sites and READMEs").
      for (const img of ['lockup.svg', 'work-in-progress.svg', 'a-smaltworks-project.svg']) {
        if (!shown[img]) throw new Error(`home: ${img} not shown: ${JSON.stringify(home.imgs)}`);
      }
      // Light and dark versions are switched by CSS: one of each badge shows.
      if (home.imgs.filter(([n]) => /-on-dark\.svg$/.test(n)).length) throw new Error('home (light) shows dark badges: ' + JSON.stringify(home.imgs));
      // The home page embeds no demo; the Demo nav item opens the workbench (smalt-brand BRAND.md, rule 12).
      if (await page.locator('iframe').count()) throw new Error('home: embeds a demo');
      const demo = await page.locator('.VPNavBarMenu a').first().evaluate((a) => [a.textContent.trim(), a.getAttribute('href')]);
      if (demo[0] !== 'Demo' || !/workbench\/\?env=envs\/demo\/env\.json$/.test(demo[1] ?? '')) throw new Error('home: first nav item is not Demo -> workbench: ' + JSON.stringify(demo));
      const heroActions = await page.locator('.VPHero .actions a').evaluateAll((as) => as.map((a) => [a.textContent.trim(), a.getAttribute('href')]));
      if (JSON.stringify(heroActions) !== JSON.stringify([['Getting started', '/smaltui/guide/']])) throw new Error('home: the hero should have one button, Getting started: ' + JSON.stringify(heroActions));
      // The live console (embedded in the home page) runs its first example.
      await page.goto(siteBase + 'console.html');
      await page.waitForFunction(() => /rows? in|Could not|could not/.test(document.querySelector('#consoleStatus')?.textContent ?? ''), null, { timeout: 20000 });
      const landing = await page.locator('#consoleStatus').textContent();
      if (!/rows? in/.test(landing)) throw new Error('console: ' + landing);
      // A guide page (clean URLs, as Pages serves them).
      await page.goto(siteBase + 'guide/import');
      const h1 = await page.locator('.vp-doc h1').textContent({ timeout: 10000 }).catch(() => null);
      if (!/^\s*Import and link data\b/.test(h1 ?? '')) throw new Error(`guide/import did not render: ${JSON.stringify(h1)}`);
      // A guide page shows the stage badge at the top and "A smaltworks project" at its foot (VitePress hides its footer
      // on pages with a sidebar), one of each light / dark pair.
      const guideBadges = await page.evaluate(() =>
        ['.sw-stage img', '.sw-project img'].map((sel) => [...document.querySelectorAll(sel)].filter((i) => i.checkVisibility() && i.complete && i.naturalWidth > 0).length));
      if (guideBadges.join() !== '1,1') throw new Error(`guide/import: stage and smaltworks badges shown ${guideBadges.join(', ')} times, not once each`);
      await page.goto(siteBase + 'console.html');
      await page.waitForFunction(() => /rows? in/.test(document.querySelector('#consoleStatus')?.textContent ?? ''), null, { timeout: 20000 });
      // Every local CSS/JS reference is versioned, so a deploy never mixes new pages with cached old assets.
      const { readFileSync } = await import('node:fs');
      for (const f of ['smaltui/console.html', 'smaltui/workbench/index.html']) {
        const refs = [...readFileSync(join(out, f), 'utf8').matchAll(/<(?:link|script)\b[^>]*?\s(?:href|src)="([^"]+\.(?:css|js)[^"]*)"/g)].map((m) => m[1]).filter((u) => !/^https?:/.test(u));
        const bare = refs.filter((u) => !/\?v=[0-9a-f]{12}$/.test(u));
        if (!refs.length || bare.length) throw new Error(`${f}: unversioned ${JSON.stringify(bare)}`);
      }
      const mainJs = readFileSync(join(out, 'smaltui/workbench/app/main.js'), 'utf8');
      if (/from\s*["']\.\/[a-z]+\.js["']/.test(mainJs)) throw new Error('main.js has unversioned imports');
      await page.locator('.example', { hasText: 'Parquet file' }).click();
      await page.waitForFunction(() => document.querySelectorAll('#gridHost tbody tr[data-row]').length === 3, null, { timeout: 10000 });
      const href = await page.locator('#openInWb').getAttribute('href');
      await page.goto(siteBase + href);
      await page.waitForFunction(() => document.querySelector('.tab.active')?.textContent.includes('Shared query') && document.querySelectorAll('.pane.active .pane.active tbody tr[data-row], .pane.active tbody tr[data-row]').length === 3, null, { timeout: 20000 });
      const errs = await page.evaluate(() => [...document.querySelectorAll('.toast.err')].map((t) => t.textContent));
      if (errs.length) throw new Error('workbench demo: ' + errs.join(' | '));
      await page.goto(siteBase + '?env=envs/demo/env.json');
      await page.waitForURL(/\/workbench\/\?env=/, { timeout: 5000 });
      await page.waitForFunction(() => window.smaltui?.db, null, { timeout: 20000 });
      await shot('07-site');
      // The post-deploy smoke test (run by the Pages workflow against the live site) must pass here too.
      const smoke = spawn(process.execPath, [join(root, 'test/smoke.mjs'), siteBase], { env: { ...process.env, SMOKE_ATTEMPTS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let smokeOut = '';
      smoke.stdout.on('data', (d) => (smokeOut += d));
      smoke.stderr.on('data', (d) => (smokeOut += d));
      const smokeCode = await new Promise((r) => smoke.on('exit', r));
      if (smokeCode !== 0) throw new Error('test/smoke.mjs: ' + smokeOut.trim());
    } finally {
      await page.goto('about:blank');
      site.kill();
    }
  });

  await step('no uncaught page errors', async () => {
    const real = errors.filter((e) => !/favicon/.test(e));
    if (real.length) throw new Error(real.join(' | '));
  });
} finally {
  await browser.close();
  server.kill();
}
console.log(failures ? `\n${failures} failing` : '\nall passed');
process.exit(failures ? 1 : 0);
