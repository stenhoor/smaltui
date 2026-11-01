// Environments: a JSON manifest that describes a database to build when the page opens, so a
// statically served smaltui can ship a ready-to-query workspace (?env=envs/demo/env.json).
//
// {
//   "smaltui": 1,
//   "name": "Demo", "description": "…",
//   "database": { "name": "demo", "storage": "memory" | "opfs" },
//   "init": "always" | "once",          // opfs: rebuild on every load, or only the first time (default once)
//   "steps": [
//     { "sql": "CREATE TABLE …; INSERT …" },
//     { "sqlFile": "schema.sql" },
//     { "import": "data/cities.csv", "table": "cities", "format": "csv", "options": { "header": true } },
//     { "table": "notes", "data": [ { "id": 1, "body": "…" } ] },
//     { "link": "data/rates.csv", "table": "rates", "format": "csv", "options": { "header": true } },
//     { "connection": "api", "url": "https://example.com/v1/" }
//   ],
//   "queries": [ { "title": "Top cities", "sql": "SELECT …" } ],
//   "open": ["cities"]
// }
//
// Relative paths resolve against the manifest's URL. "link" steps create external tables that read
// the source at query time (it must be reachable from the browser: same origin or CORS-enabled).
import { quoteIdent, quoteLiteral } from './sql.js';

export async function fetchManifest(url) {
  const abs = new URL(url, location.href).href;
  const r = await fetch(abs, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`cannot load environment ${abs}: HTTP ${r.status}`);
  const m = await r.json();
  if (!m || typeof m !== 'object' || !Array.isArray(m.steps ?? [])) throw new Error('not a smaltui environment manifest');
  m.__base = abs;
  return m;
}

export function manifestKey(m) {
  return `env:${m.database?.name ?? 'env'}:${hash(JSON.stringify({ ...m, __base: undefined }))}`;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** Run a manifest's steps against an open database. `log(level, text)` reports progress. */
export async function applyManifest(db, m, log) {
  const base = m.__base ?? location.href;
  const resolve = (p) => new URL(p, base).href;
  let n = 0;
  for (const step of m.steps ?? []) {
    n++;
    const label = `step ${n}`;
    if (step.sql !== undefined || step.sqlFile !== undefined) {
      const sql = step.sql ?? (await fetchText(resolve(step.sqlFile)));
      await db.exec(sql);
      log('ok', `${label}: ran ${step.sqlFile ?? 'SQL'}`);
    } else if (step.connection) {
      await db.exec(`CREATE CONNECTION IF NOT EXISTS ${quoteIdent(step.connection)} WITH (url = ${quoteLiteral(resolve(step.url))})`);
      log('ok', `${label}: connection ${step.connection}`);
    } else if (step.import) {
      const url = resolve(step.import);
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${label}: cannot fetch ${url}: HTTP ${r.status}`);
      const blob = await r.blob();
      const format = step.format ?? formatFromName(url);
      const opts = { create: true, ...(step.options ?? {}) };
      const res =
        format === 'json' || format === 'ndjson'
          ? await db.importJSON(step.table, blob, opts)
          : await db.importCSV(step.table, blob, format === 'tsv' ? { delimiter: '\t', ...opts } : opts);
      log('ok', `${label}: imported ${res.rows} rows into ${step.table}`);
    } else if (step.data) {
      const res = await db.importJSON(step.table, JSON.stringify(step.data), { create: true, ...(step.options ?? {}) });
      log('ok', `${label}: loaded ${res.rows} rows into ${step.table}`);
    } else if (step.link) {
      const location = /^[a-z]+:/i.test(step.link) && !/^https?:/i.test(step.link) ? step.link : resolve(step.link);
      await db.exec(externalTableSql({ table: step.table, location, format: step.format, options: step.options, connection: step.connectionName, columns: step.columns }));
      log('ok', `${label}: linked ${step.table} → ${location}`);
    } else {
      log('warn', `${label}: unknown step ${JSON.stringify(step).slice(0, 80)}`);
    }
  }
}

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`cannot fetch ${url}: HTTP ${r.status}`);
  return r.text();
}

export function formatFromName(name) {
  const m = /\.(csv|tsv|json|ndjson|jsonl|txt)(\?|#|$)/i.exec(name);
  if (!m) return 'csv';
  const ext = m[1].toLowerCase();
  return ext === 'jsonl' ? 'ndjson' : ext === 'txt' ? 'csv' : ext;
}

/** CREATE EXTERNAL TABLE text. options: header, delimiter, quote, null, skip, encoding. */
export function externalTableSql({ table, location, format, options = {}, connection, columns, ifNotExists = false }) {
  const withs = [`location = ${quoteLiteral(location)}`];
  if (connection) withs.push(`connection = ${quoteLiteral(connection)}`);
  if (format) withs.push(`format = ${quoteLiteral(format)}`);
  for (const [k, v] of Object.entries(options ?? {})) {
    if (v === undefined || v === '' || v === null) continue;
    withs.push(`${k} = ${typeof v === 'boolean' ? String(v) : typeof v === 'number' ? v : quoteLiteral(v)}`);
  }
  const cols = columns?.length ? ` (${columns.map((c) => `${quoteIdent(c.name)} ${c.type || 'ANY'}`).join(', ')})` : '';
  return `CREATE EXTERNAL TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${quoteIdent(table)}${cols}\n  WITH (${withs.join(', ')})`;
}

/** Build a manifest that recreates the open database (schema + local data; external sources by reference). */
export async function exportManifest(db, { name, dbName, includeData = true, queries = [] }) {
  const objects = await db.query('SELECT type, name, tbl_name, sql FROM sqlite_schema', [], { rowMode: 'object' });
  const steps = [];
  const conns = objects.filter((o) => o.type === 'connection');
  const tables = objects.filter((o) => o.type === 'table' && !String(o.name).startsWith('sqlite_'));
  const later = objects.filter((o) => !['connection', 'table'].includes(o.type) && o.sql);
  for (const c of conns) if (c.sql) steps.push({ sql: c.sql + ';' });
  for (const t of tables) {
    steps.push({ sql: t.sql + ';' });
    if (includeData) {
      const rows = await db.query(`SELECT * FROM ${quoteIdent(t.name)}`, [], { rowMode: 'object' });
      if (rows.length) steps.push({ table: t.name, data: rows.map(jsonRow) });
    }
  }
  for (const o of later) steps.push({ sql: o.sql + ';' });
  return {
    smaltui: 1,
    name: name ?? dbName,
    exportedAt: new Date().toISOString(),
    database: { name: dbName, storage: 'memory' },
    init: 'always',
    steps,
    queries,
  };
}

function jsonRow(r) {
  const o = {};
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === 'bigint') o[k] = Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
    else if (v instanceof Uint8Array) o[k] = null; // BLOBs are not representable in JSON import
    else o[k] = v;
  }
  return o;
}

/** A plain SQL dump (schema + INSERTs). */
export async function exportSqlDump(db) {
  const objects = await db.query('SELECT type, name, sql FROM sqlite_schema', [], { rowMode: 'object' });
  let out = `-- smaltdb dump, ${new Date().toISOString()}\n`;
  const first = objects.filter((o) => o.type === 'connection' || (o.type === 'table' && !String(o.name).startsWith('sqlite_')));
  const rest = objects.filter((o) => !first.includes(o) && o.sql);
  for (const o of first) {
    out += `\n${o.sql};\n`;
    if (o.type !== 'table') continue;
    const rows = await db.query(`SELECT * FROM ${quoteIdent(o.name)}`, [], { rowMode: 'array' });
    if (!rows.length) continue;
    const cols = rows.columns.map(quoteIdent).join(', ');
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200).map((r) => `(${r.map(quoteLiteral).join(', ')})`);
      out += `INSERT INTO ${quoteIdent(o.name)} (${cols}) VALUES\n  ${chunk.join(',\n  ')};\n`;
    }
  }
  for (const o of rest) out += `\n${o.sql};\n`;
  return out;
}
