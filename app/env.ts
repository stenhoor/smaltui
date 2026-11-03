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
//     { "import": "data/sales.parquet", "table": "sales" },
//     { "link": "data/rates.csv", "table": "rates", "format": "csv", "options": { "header": true } },
//     { "connection": "api", "url": "https://example.com/v1/" }
//   ],
//   "queries": [ { "title": "Top cities", "sql": "SELECT …" } ],
//   "open": ["cities"]
// }
//
// Relative paths resolve against the manifest's URL. "link" steps create external tables that read
// the source at query time (it must be reachable from the browser: same origin or CORS-enabled).
import type { Database } from './engine.js';
import { quoteIdent, quoteLiteral, type SqlValue } from './sql.js';
import { normalizeDataUrl } from './urls.js';

export type DataFormat = 'csv' | 'tsv' | 'json' | 'ndjson' | 'parquet';

/** Reader options for external tables and imports (header, delimiter, quote, null, skip, encoding). */
export type ReaderOptions = Record<string, string | number | boolean | null | undefined>;

export interface ColumnDef {
  name: string;
  type?: string;
}

/**
 * One manifest step. Exactly one of `sql` / `sqlFile`, `connection`, `import`, `data` or `link` says what it does;
 * `table`, `format`, `options` and the rest qualify it.
 */
export interface ManifestStep {
  sql?: string;
  sqlFile?: string;
  connection?: string;
  url?: string;
  import?: string;
  data?: Record<string, unknown>[];
  link?: string;
  table?: string;
  format?: DataFormat;
  options?: ReaderOptions;
  connectionName?: string;
  columns?: ColumnDef[];
}

export interface SavedQuery {
  title: string;
  sql: string;
}

/** An environment manifest (see the format above). */
export interface Manifest {
  smaltui?: number;
  name?: string;
  description?: string;
  exportedAt?: string;
  database?: { name?: string; storage?: 'memory' | 'opfs' };
  init?: 'always' | 'once';
  steps?: ManifestStep[];
  queries?: SavedQuery[];
  open?: string[];
  /** The URL the manifest was loaded from (set by fetchManifest; relative paths resolve against it). */
  __base?: string;
}

export type LogLevel = 'ok' | 'warn';
type Row = Record<string, SqlValue>;

export async function fetchManifest(url: string): Promise<Manifest> {
  const abs = new URL(url, location.href).href;
  const r = await fetch(abs, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`cannot load environment ${abs}: HTTP ${r.status}`);
  const m = (await r.json()) as Manifest;
  if (!m || typeof m !== 'object' || !Array.isArray(m.steps ?? [])) throw new Error('not a smaltui environment manifest');
  m.__base = abs;
  return m;
}

export function manifestKey(m: Manifest): string {
  return `env:${m.database?.name ?? 'env'}:${hash(JSON.stringify({ ...m, __base: undefined }))}`;
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** Run a manifest's steps against an open database. `log(level, text)` reports progress. */
export async function applyManifest(db: Database, m: Manifest, log: (level: LogLevel, text: string) => void): Promise<void> {
  const base = m.__base ?? location.href;
  // Relative paths resolve against the manifest; GitHub/Hugging Face page links become raw-file URLs.
  const resolve = (p: string) => normalizeDataUrl(new URL(p, base).href).url;
  let n = 0;
  for (const step of m.steps ?? []) {
    n++;
    const label = `step ${n}`;
    if (step.sql !== undefined || step.sqlFile !== undefined) {
      const sql = step.sql ?? (await fetchText(resolve(step.sqlFile!)));
      await db.exec(sql);
      log('ok', `${label}: ran ${step.sqlFile ?? 'SQL'}`);
    } else if (step.connection) {
      await db.exec(`CREATE CONNECTION IF NOT EXISTS ${quoteIdent(step.connection)} WITH (url = ${quoteLiteral(resolve(step.url ?? ''))})`);
      log('ok', `${label}: connection ${step.connection}`);
    } else if (step.import) {
      const url = resolve(step.import);
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${label}: cannot fetch ${url}: HTTP ${r.status}`);
      const blob = await r.blob();
      const format = step.format ?? formatFromName(url);
      const table = requireTable(step, label);
      const opts = { create: true, ...(step.options ?? {}) };
      const res =
        format === 'parquet'
          ? await importParquet(db, table, blob)
          : format === 'json' || format === 'ndjson'
          ? await db.importJSON(table, blob, opts)
          : await db.importCSV(table, blob, format === 'tsv' ? { delimiter: '\t', ...opts } : opts);
      log('ok', `${label}: imported ${res.rows} rows into ${step.table}`);
    } else if (step.data) {
      const res = await db.importJSON(requireTable(step, label), JSON.stringify(step.data), { create: true, ...(step.options ?? {}) });
      log('ok', `${label}: loaded ${res.rows} rows into ${step.table}`);
    } else if (step.link) {
      const location = /^[a-z]+:/i.test(step.link) && !/^https?:/i.test(step.link) ? step.link : resolve(step.link);
      await db.exec(externalTableSql({ table: requireTable(step, label), location, format: step.format, options: step.options, connection: step.connectionName, columns: step.columns }));
      log('ok', `${label}: linked ${step.table} → ${location}`);
    } else {
      log('warn', `${label}: unknown step ${JSON.stringify(step).slice(0, 80)}`);
    }
  }
}

function requireTable(step: ManifestStep, label: string): string {
  if (!step.table) throw new Error(`${label}: "table" is required`);
  return step.table;
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`cannot fetch ${url}: HTTP ${r.status}`);
  return r.text();
}

export function formatFromName(name: string): DataFormat {
  const m = /\.(csv|tsv|json|ndjson|jsonl|txt|parquet)(\?|#|$)/i.exec(name);
  if (!m) return 'csv';
  const ext = m[1].toLowerCase();
  return (ext === 'jsonl' ? 'ndjson' : ext === 'txt' ? 'csv' : ext) as DataFormat;
}

/**
 * Copy a Parquet file into a table. smaltdb imports CSV/JSON directly; Parquet goes through a
 * temporary external table (columns come from the file's footer) and INSERT … SELECT.
 * A missing table is created with the file's column types. Returns { rows }.
 */
export async function importParquet(db: Database, table: string, blob: Blob): Promise<{ rows: number }> {
  const tmp = `__import_${Date.now().toString(36)}`;
  await db.registerFile(tmp, blob);
  try {
    await db.exec(`CREATE EXTERNAL TABLE ${quoteIdent(tmp)} WITH (location = ${quoteLiteral('file:' + tmp)}, format = 'parquet')`);
    try {
      const cols = await db.query<{ column_name: string; data_type: string | null }>('SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ? ORDER BY ordinal_position', [tmp]);
      await db.exec(`CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (${cols.map((c) => `${quoteIdent(c.column_name)} ${c.data_type || 'ANY'}`).join(', ')})`);
      const names = cols.map((c) => quoteIdent(c.column_name)).join(', ');
      const r = await db.exec(`INSERT INTO ${quoteIdent(table)} (${names}) SELECT ${names} FROM ${quoteIdent(tmp)}`);
      return { rows: r.changes };
    } finally {
      await db.exec(`DROP EXTERNAL TABLE IF EXISTS ${quoteIdent(tmp)}`);
    }
  } finally {
    await db.registerFile(tmp, null).catch(() => {});
  }
}

/** CREATE EXTERNAL TABLE text. options: header, delimiter, quote, null, skip, encoding. */
export interface ExternalTableSpec {
  table: string;
  location: string;
  format?: DataFormat | string;
  options?: ReaderOptions;
  connection?: string;
  columns?: ColumnDef[];
  ifNotExists?: boolean;
}

export function externalTableSql({ table, location, format, options = {}, connection, columns, ifNotExists = false }: ExternalTableSpec): string {
  const withs = [`location = ${quoteLiteral(location)}`];
  if (connection) withs.push(`connection = ${quoteLiteral(connection)}`);
  if (format) withs.push(`format = ${quoteLiteral(format)}`);
  for (const [k, v] of Object.entries(options ?? {})) {
    if (v === undefined || v === '' || v === null) continue;
    withs.push(`${k} = ${typeof v === 'boolean' ? String(v) : typeof v === 'number' ? v : quoteLiteral(String(v))}`);
  }
  const cols = columns?.length ? ` (${columns.map((c) => `${quoteIdent(c.name)} ${c.type || 'ANY'}`).join(', ')})` : '';
  return `CREATE EXTERNAL TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${quoteIdent(table)}${cols}\n  WITH (${withs.join(', ')})`;
}

/** Build a manifest that recreates the open database (schema + local data; external sources by reference). */
export interface ExportOptions {
  name?: string;
  dbName: string;
  includeData?: boolean;
  queries?: SavedQuery[];
}

interface SchemaObject {
  type: string;
  name: string;
  tbl_name?: string;
  sql: string | null;
}

export async function exportManifest(db: Database, { name, dbName, includeData = true, queries = [] }: ExportOptions): Promise<Manifest> {
  const objects = await db.query<SchemaObject>('SELECT type, name, tbl_name, sql FROM sqlite_schema', []);
  const steps: ManifestStep[] = [];
  const conns = objects.filter((o) => o.type === 'connection');
  const tables = objects.filter((o) => o.type === 'table' && !String(o.name).startsWith('sqlite_'));
  const later = objects.filter((o) => !['connection', 'table'].includes(o.type) && o.sql);
  for (const c of conns) if (c.sql) steps.push({ sql: c.sql + ';' });
  for (const t of tables) {
    steps.push({ sql: t.sql + ';' });
    if (includeData) {
      const rows = await db.query<Row>(`SELECT * FROM ${quoteIdent(t.name)}`, []);
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

function jsonRow(r: Row): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === 'bigint') o[k] = Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
    else if (v instanceof Uint8Array) o[k] = null; // BLOBs are not representable in JSON import
    else o[k] = v;
  }
  return o;
}

/** A plain SQL dump (schema + INSERTs). */
export async function exportSqlDump(db: Database): Promise<string> {
  const objects = await db.query<SchemaObject>('SELECT type, name, sql FROM sqlite_schema', []);
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
      const chunk = rows.slice(i, i + 200).map((r) => `(${r.map((v) => quoteLiteral(v as SqlValue)).join(', ')})`);
      out += `INSERT INTO ${quoteIdent(o.name)} (${cols}) VALUES\n  ${chunk.join(',\n  ')};\n`;
    }
  }
  for (const o of rest) out += `\n${o.sql};\n`;
  return out;
}
