// Live console on the landing page: an in-memory smaltdb loaded with the demo environment,
// using the workbench's own engine loader, editor, grid and environment code.
import { loadEngine, type Database, type Engine } from '../app/engine.js';
import { Editor, type EditorSchema, type SchemaTable } from '../app/editor.js';
import { Grid, type Row } from '../app/grid.js';
import { fetchManifest, applyManifest } from '../app/env.js';
import { statementAt, returnsRows, quoteIdent } from '../app/sql.js';
import { corsHint } from '../vendor/smaltkit/urls.js';

const ENV = 'workbench/envs/demo/env.json';
const MAX_ROWS = 500;

const EXAMPLES = [
  {
    title: 'Revenue by category',
    note: 'a view over three tables',
    sql: `SELECT category,
       count(*) AS lines,
       sum(quantity) AS units,
       round(sum(amount), 2) AS revenue
FROM order_lines
WHERE status <> 'cancelled'
GROUP BY category
ORDER BY revenue DESC;`,
  },
  {
    title: 'Top customers in USD',
    note: 'joins a linked CSV',
    sql: `-- exchange_rates is an external table: a CSV read when queried
SELECT c.name, c.country, c.currency,
       round(sum(o.quantity * p.price) * r.usd_per_unit, 2) AS revenue_usd
FROM orders o
JOIN customers c ON c.id = o.customer_id
JOIN products p ON p.id = o.product_id
JOIN exchange_rates r ON r.currency = c.currency
GROUP BY c.id, c.name, c.country, c.currency, r.usd_per_unit
ORDER BY revenue_usd DESC
LIMIT 10;`,
  },
  {
    title: 'Parquet file',
    note: 'data imported from Parquet',
    sql: `-- regional_sales was imported from a Parquet file
SELECT region,
       count(*) AS sales,
       sum(amount) AS total,
       min(day) AS first_day,
       max(day) AS last_day
FROM regional_sales
GROUP BY region
ORDER BY total DESC;`,
  },
  {
    title: 'Running totals',
    note: 'window functions over a materialized view',
    sql: `SELECT month, orders, revenue,
       sum(revenue) OVER (ORDER BY month) AS running_total,
       rank() OVER (ORDER BY revenue DESC) AS rank_by_revenue
FROM monthly_revenue
ORDER BY month;`,
  },
  {
    title: 'Query plan',
    note: 'EXPLAIN QUERY PLAN',
    sql: `EXPLAIN QUERY PLAN
SELECT * FROM orders
WHERE customer_id = 7
ORDER BY ordered_at;`,
  },
  {
    title: 'The catalog',
    note: 'information_schema',
    sql: `SELECT table_name, table_type
FROM information_schema.tables
ORDER BY table_type, table_name;`,
  },
  {
    title: 'Write something',
    note: 'it is your copy: change it',
    sql: `UPDATE products SET price = round(price * 1.1, 2) WHERE category = 'Tea';
-- then select this line and run it:
-- SELECT name, price FROM products WHERE category = 'Tea';`,
  },
];

/** Elements on this page are known to exist; typed loosely enough for .value, .href and .disabled. */
const $ = <T extends HTMLElement = HTMLInputElement & HTMLAnchorElement>(s: string): T => document.querySelector<T>(s)!;
const statusEl = $('#consoleStatus');
const runBtn = $('#runBtn');
const fmtMs = (ms: number): string => (ms < 1000 ? `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`);
const errText = (e: unknown): string => {
  const err = e as { code?: string; message?: string } | null;
  const base = err?.code ? `${err.code}: ${err.message}` : String(err?.message ?? e);
  const hint = corsHint(base);
  return hint ? `${base} ${hint}` : base;
};

function status(text: string, err = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle('err', err);
}

// ------------------------------------------------------------------ theme toggle
$('#themeBtn').onclick = () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try {
    localStorage.setItem('smaltui.theme', JSON.stringify(root.dataset.theme));
  } catch {}
};

// ------------------------------------------------------------------ UI
const schema: EditorSchema = { names: new Set(), tables: new Map() };
const editor = new Editor($('#editorHost'), {
  value: EXAMPLES[0].sql + '\n',
  schema: () => schema,
  onChange: () => updateWorkbenchLink(),
  keys: { 'Mod+Enter': () => run(), 'Shift+Mod+Enter': () => run() },
});
const grid = new Grid($('#gridHost'), { emptyText: 'Loading the demo database…' });

const exBox = $('#examples');
EXAMPLES.forEach((ex, i) => {
  const b = document.createElement('button');
  b.className = 'example' + (i === 0 ? ' active' : '');
  b.innerHTML = `${ex.title}<small>${ex.note}</small>`;
  b.onclick = () => {
    exBox.querySelectorAll('.example').forEach((x: Element) => x.classList.toggle('active', x === b));
    editor.value = ex.sql + '\n';
    updateWorkbenchLink();
    run(ex.sql);
  };
  exBox.appendChild(b);
});

function updateWorkbenchLink(): void {
  const sql = editor.value.trim();
  $('#openInWb').href = `workbench/?env=envs/demo/env.json${sql ? '&sql=' + encodeURIComponent(sql) : ''}`;
}
runBtn.onclick = () => run();

// ------------------------------------------------------------------ engine + data
let db: Database | null = null;
let busy = false;

async function start(): Promise<void> {
  const t0 = performance.now();
  let engine: Engine;
  try {
    engine = await loadEngine('vendor');
  } catch (e) {
    status('The smaltdb engine could not be loaded: ' + errText(e), true);
    grid.empty.textContent = 'smaltdb could not be loaded in this browser.';
    return;
  }
  const v = engine.version?.version;
  if (v) {
    $('#factEngine').textContent = `smaltdb ${v} with smaltql`;
    $('#footEngine').textContent = `smaltdb ${v}`;
  }
  try {
    db = await engine.open('smaltui-landing', { storage: 'memory' });
    const m = await fetchManifest(ENV);
    const total = m.steps?.length ?? 0;
    let n = 0;
    await applyManifest(db, m, () => status(`Loading demo data… ${++n}/${total}`));
    await loadSchema();
  } catch (e) {
    status('Could not load the demo: ' + errText(e), true);
    grid.empty.textContent = errText(e);
    return;
  }
  status(`Ready. smaltdb${v ? ' ' + v : ''} loaded the demo in ${fmtMs(performance.now() - t0)}, in your browser.`);
  runBtn.disabled = false;
  grid.opts.emptyText = 'No rows';
  run(EXAMPLES[0].sql);
}

async function loadSchema(): Promise<void> {
  if (!db) return;
  const cols = await db.query<{ table_name: string; column_name: string; data_type: string | null; table_type: string }>("SELECT c.table_name, c.column_name, c.data_type, t.table_type FROM information_schema.columns c JOIN information_schema.tables t ON t.table_name = c.table_name WHERE c.table_schema <> 'information_schema' ORDER BY t.table_type, c.table_name, c.ordinal_position");
  schema.tables.clear();
  for (const c of cols) {
    if (!schema.tables.has(c.table_name)) {
      const arr: SchemaTable = [];
      arr.kind = c.table_type === 'VIEW' ? 'view' : c.table_type === 'EXTERNAL' ? 'external' : c.table_type === 'MATERIALIZED VIEW' ? 'matview' : 'table';
      arr.type = c.table_type;
      schema.tables.set(c.table_name, arr);
    }
    schema.tables.get(c.table_name)!.push({ name: c.column_name, type: c.data_type });
  }
  schema.names = new Set([...schema.tables.keys()].map((n) => n.toLowerCase()));
  editor.render();
  const label: Record<string, string> = { table: '', view: 'view', matview: 'mat. view', external: 'external' };
  const list = $('#schemaList');
  list.innerHTML = '';
  for (const [name, c] of schema.tables) {
    const row = document.createElement('div');
    const b = document.createElement('button');
    b.textContent = name;
    b.title = c.map((x) => `${x.name} ${x.type ?? ''}`).join('\n');
    b.onclick = () => {
      editor.value = `SELECT *\nFROM ${quoteIdent(name)}\nLIMIT 100;\n`;
      updateWorkbenchLink();
      run();
    };
    row.appendChild(b);
    if (c.kind && label[c.kind]) row.insertAdjacentHTML('beforeend', ` <span class="k">${label[c.kind]}</span>`);
    list.appendChild(row);
  }
}

async function run(sqlText?: string): Promise<void> {
  if (!db || busy) return;
  let sql = sqlText;
  if (!sql) {
    const sel = editor.selection();
    sql = sel.trim() ? sel : editor.currentStatement()?.sql;
  }
  if (!sql?.trim()) return;
  // An example may hold a statement plus comments: run its first statement.
  const st = statementAt(sql, 0);
  if (!st) return;
  sql = st.sql;
  busy = true;
  runBtn.disabled = true;
  status('Running…');
  const t0 = performance.now();
  try {
    if (returnsRows(sql)) {
      const rows: Row[] = [];
      let columns: string[] | null = null;
      let more = false;
      const it = db.stream(sql, [], { rowMode: 'array', batchSize: 250 });
      for (;;) {
        const n = await it.next();
        if (n.done) break;
        columns ??= n.value.columns;
        for (const r of n.value) rows.push(r);
        if (rows.length >= MAX_ROWS) {
          more = true;
          await it.return?.();
          break;
        }
      }
      if (!columns) {
        const p = await db.prepare(sql);
        columns = p.columns ?? [];
        await p.finalize();
      }
      grid.setData(columns, rows);
      status(`${rows.length.toLocaleString()}${more ? '+' : ''} row${rows.length === 1 ? '' : 's'} in ${fmtMs(performance.now() - t0)}${more ? ` (showing the first ${MAX_ROWS}; the workbench fetches the rest on demand)` : ''}`);
    } else {
      const r = await db.exec(sql);
      status(`${r.changes.toLocaleString()} row${r.changes === 1 ? '' : 's'} changed in ${fmtMs(performance.now() - t0)}. Your copy is in memory; reloading the page resets it.`);
      if (/^\s*(CREATE|DROP|ALTER)/i.test(sql)) await loadSchema();
    }
  } catch (e) {
    status(errText(e), true);
  } finally {
    busy = false;
    runBtn.disabled = false;
  }
}

start();
