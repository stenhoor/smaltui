// How the docs run an example, the way the workbench's tabs run it: shared by the site's playgrounds (runners.ts, in the
// browser) and the docs examples test (test/docs-examples.mjs, in Node), so a Run shows what the tested result says.
//
// - SQL runs statement by statement, showing the last one's rows (the site kit's splitSql, as its sqlRunner does).
// - TypeScript runs as a TypeScript tab runs it (app/main.ts): types stripped by smaltkit/typescript, smaltdf's names in
//   scope with `db`, `import { … } from '@smaltdb/df'` allowed, and the last expression is the result. A frame is
//   collected, a write reports its rows.
// - Cypher runs on smaltcy, and its values are written as a Cypher tab's grid writes them (app/cypher-values.ts).
//
// Pure: no DOM and no worker. The callers give it the database, smaltdf and the type stripper.

import { splitLastExpression } from '../../../app/ts.ts';
import { cypherCell } from '../../../app/cypher-values.ts';
import { splitSql } from '../../../brand/themes/vitepress/playground.ts';

/** A result as the playground shows it: a table, or a note or printed text when there are no columns. */
export interface ExampleResult {
  columns: string[];
  rows: unknown[][];
  note?: string;
  text?: string;
}

/** What SQL needs of a database: a client `Database` in the browser, smaltdb's in-process one in the test. */
export interface SqlRunner {
  exec(sql: string): Promise<unknown>;
  query(sql: string): Promise<{ columns: string[]; rows: unknown[][] }>;
}

/** Whether a setup step is SQL (a `docs:setup` marker's data), not a TypeScript example above. */
export const isSql = (code: string): boolean => /^\s*(--[^\n]*\n\s*)*(CREATE|INSERT|UPDATE|DELETE|DROP|ALTER|WITH|SELECT|BEGIN|COMMIT)\b/i.test(code);

/** Runs SQL: every statement, then the last one's rows. */
/**
 * Whether a playground setup step is SQL that a Cypher run should leave out: the site kit gives a page's
 * `docs:setup` SQL to every language. Cypher has no `CREATE TABLE`, `CREATE VIEW`, `INSERT INTO`, `DROP TABLE` or
 * `CREATE INDEX name ON table (…)`, so a step that starts with one is SQL (the examples test gives Cypher none of it).
 */
export const isSqlSetup = (code: string): boolean =>
  /^\s*(?:--[^\n]*\n\s*)*(?:CREATE\s+(?:TEMP(?:ORARY)?\s+)?(?:TABLE|VIEW|MATERIALIZED\s+VIEW|EXTERNAL\s+TABLE)|CREATE\s+(?:UNIQUE\s+)?INDEX\s+\w+\s+ON\s+\w|INSERT\s+INTO|DROP\s+(?:TABLE|VIEW))\b/i.test(code);

export async function runSql(code: string, db: SqlRunner): Promise<ExampleResult> {
  const statements = splitSql(code);
  if (statements.length === 0) return { columns: [], rows: [], note: 'Nothing to run' };
  for (const s of statements.slice(0, -1)) await db.exec(s);
  const r = await db.query(statements[statements.length - 1]);
  if (r.columns.length) return { columns: [...r.columns], rows: r.rows.map((row) => [...row]) };
  return { columns: [], rows: [], note: 'Done: the last statement returns no rows' };
}

/** smaltdf, as far as a TypeScript example uses it. */
export interface Smaltdf {
  Frame: abstract new (...args: never[]) => { collect(db: unknown): Promise<{ columns: string[]; rows: unknown[][] }> };
  Write: abstract new (...args: never[]) => { run(db: unknown): Promise<unknown> };
  [name: string]: unknown;
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...a: unknown[]) => Promise<unknown>;

/**
 * Runs a TypeScript tab's code against `db`, as the tab does: smaltdf's names and `db` are in scope, and the value of the
 * last expression is the result.
 */
export async function runTypeScript(code: string, env: { df: Smaltdf; db: unknown; strip: (code: string) => string }): Promise<ExampleResult> {
  const { df, db, strip } = env;
  // As the tab: a plain import from smaltdf is dropped (its names are in scope), `x as y` becomes `const y = …`.
  const src = code.replace(/^[ \t]*import\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]@smaltdb\/df['"];?/gm, (_m, type: string | undefined, names: string) =>
    type
      ? ''
      : names
          .split(',')
          .map((n) => /^\s*(\w+)\s+as\s+(\w+)\s*$/.exec(n))
          .filter((m): m is RegExpExecArray => !!m)
          .map((m) => `const ${m[2]} = __df.${m[1]};`)
          .join(' '),
  );
  if (/^[ \t]*import\s/m.test(src)) throw new Error("Only smaltdf can be imported in a TypeScript tab: import { … } from '@smaltdb/df'");
  const { body, expr } = splitLastExpression(strip(src));
  const names = Object.keys(df).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n) && !['db', 'show'].includes(n));
  const fn = new AsyncFunction('__df', 'db', 'show', ...names, `${body}\n${expr ? `return (${expr});` : ''}`);
  const value = await fn(df, db, () => undefined, ...names.map((n) => df[n]));
  if (value instanceof df.Frame) {
    const r = await value.collect(db);
    return { columns: [...r.columns], rows: r.rows.map((row) => [...row]) };
  }
  if (value instanceof df.Write) {
    const r = (await value.run(db)) as { rows?: number } | undefined;
    return { columns: [], rows: [], note: `${r?.rows ?? 0} row(s) written` };
  }
  if (Array.isArray(value) && value.length && value.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
    const columns = [...new Set(value.flatMap((x) => Object.keys(x as object)))];
    return { columns, rows: value.map((x) => columns.map((c) => (x as Record<string, unknown>)[c] ?? null)) };
  }
  if (value === undefined) return { columns: [], rows: [], note: 'Done: the code has no last expression' };
  return { columns: [], rows: [], text: typeof value === 'string' ? value : JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? String(v) : v), 2) };
}

/** A smaltcy result as an example's table: its values written as a Cypher tab writes them, or EXPLAIN's steps. */
export function cypherTable(r: { columns: readonly string[]; rows: readonly (readonly unknown[])[]; explain?: unknown }): ExampleResult {
  if (r.explain) return { columns: [], rows: [], text: String(r.rows[0]?.[0] ?? '') };
  if (!r.columns.length) return { columns: [], rows: [], note: 'Done: the statement returns no rows' };
  return { columns: [...r.columns], rows: r.rows.map((row) => row.map(cypherCell)) };
}

/** A cell as the examples' result tables write it: NULL for null, numbers and text as they are, blobs as x'…'. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (v instanceof Uint8Array) return `x'${[...v].map((b) => b.toString(16).padStart(2, '0')).join('')}'`;
  if (typeof v === 'object') return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? String(x) : x));
  return String(v);
}
