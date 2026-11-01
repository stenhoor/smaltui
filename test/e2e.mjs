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

  await step('create a table and insert rows from a script', async () => {
    await page.locator('#btnNewQuery').click();
    await typeSql("CREATE TABLE people(id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INT);\nINSERT INTO people(name, age) VALUES ('Ada', 36), ('Grace', 85), ('Alan', 41);\nSELECT * FROM people ORDER BY age;");
    await page.keyboard.press('Control+Shift+Enter');
    await page.waitForFunction(() => document.querySelector('.pane.active .subtab.active')?.textContent.startsWith('Result'), null, { timeout: 10000 });
    const cells = await activePane().locator('.grid-table tbody td[data-col="1"]').allTextContents();
    if (cells.join(',') !== 'Ada,Alan,Grace') throw new Error('unexpected rows ' + cells);
    if (!(await page.locator('#tree [data-obj="people"]').count())) throw new Error('tree not refreshed');
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
