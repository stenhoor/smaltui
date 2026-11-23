// The site's playground runners (BRAND.md, Documentation, rule 7): every SQL, TypeScript and Cypher example runs where it
// stands, on the site's own copies of the engine and languages (never a CDN), each in a worker, started on the first
// Run. They run an example as the workbench's tabs run it (examples.ts), so a Run shows what the tested result says.
//
// - sql: smaltql's open(), a fresh in-memory database for every Run (the site kit's sqlRunner).
// - ts: smaltdf on a fresh in-memory database; the page's `docs:setup` SQL is its data.
// - cypher: smaltcy in a worker, on the sample dataset the example names (`dataset=…`, else `social`); the Cypher
//   examples above it on the page are its setup. Its nodes, relationships and paths are drawn under the table.
import { sqlRunner, type Runner, type SetupStep, type PlayResult } from '../../../brand/themes/vitepress/playground';
import { cypherTable, isSql, isSqlSetup, runSql, runTypeScript, type Smaltdf } from './examples';
import { hasGraphValues } from '../../../app/cypher-values';

type SmaltqlDb = Awaited<ReturnType<typeof import('@smaltworks/smaltql')['open']>>;

const openSql = async (): Promise<SmaltqlDb> => (await import('@smaltworks/smaltql')).open('playground', { storage: 'memory' });

/** A SQL database as runSql wants it: statements, and the last one's rows as arrays. */
const sqlOf = (db: SmaltqlDb) => ({
  exec: (s: string) => db.exec(s),
  query: async (s: string) => {
    const r = (await db.query(s, undefined, { rowMode: 'array' })) as unknown as unknown[][] & { columns: string[] };
    return { columns: r.columns, rows: [...r] };
  },
});

const stepCode = (step: SetupStep) => (typeof step === 'string' ? step : step.sql);

export const sql = sqlRunner(openSql as () => ReturnType<Parameters<typeof sqlRunner>[0]>);

/** TypeScript with smaltdf, as a TypeScript tab runs it, on a fresh in-memory database for every Run. */
export function ts(): () => Promise<Runner> {
  return async () => {
    const [df, { stripTypes }] = await Promise.all([import('@smaltdb/df') as unknown as Promise<Smaltdf>, import('smaltkit/typescript')]);
    return {
      async run(code, setup) {
        const db = await openSql();
        try {
          for (const step of setup) {
            const text = stepCode(step);
            if (isSql(text)) await runSql(text, sqlOf(db));
            else await runTypeScript(text, { df, db, strip: stripTypes });
          }
          return await runTypeScript(code, { df, db, strip: stripTypes });
        } finally {
          await db.close();
        }
      },
    };
  };
}

/** Cypher on smaltcy, in a worker: the example's sample dataset, then the Cypher examples above it, then the code. */
export function cypher(): () => Promise<Runner> {
  return async () => {
    const { connect } = await import('@smaltworks/smaltcy/client');
    const g = connect(new Worker(new URL('./cypher-worker.ts', import.meta.url), { type: 'module', name: 'smaltcy' }));
    let queue: Promise<unknown> = Promise.resolve();
    const run = async (code: string, setup: SetupStep[], attrs: Record<string, string>): Promise<PlayResult> => {
      // The dataset as generated: the worker reloads it when a Run before this one wrote to it.
      const dataset = attrs.dataset ?? 'social';
      await g.dataset({ name: dataset as Parameters<typeof g.dataset>[0]['name'] });
      // The examples above on the same dataset (as the examples test builds each dataset's graph), without the page's
      // docs:setup SQL, which the kit gives every language.
      const steps = setup.filter((s) => !isSqlSetup(stepCode(s)));
      for (const step of steps.filter((s) => ((typeof s === 'string' ? undefined : s.attrs?.dataset) ?? 'social') === dataset)) {
        if (typeof step !== 'string' && step.fails) await g.run(step.sql).catch(() => undefined);
        else await g.run(stepCode(step));
      }
      const r = await g.run(code);
      const out: PlayResult = cypherTable(r);
      if (out.columns.length && hasGraphValues(r.rows)) out.render = (host, signal) => drawGraph(host, r.rows, signal);
      return out;
    };
    return {
      run: (code, setup, attrs) => {
        const result = queue.then(() => run(code, setup, attrs));
        queue = result.catch(() => undefined);
        return result;
      },
    };
  };
}

/** Every node, relationship and path in the rows, drawn with smaltkit's graph view (WebGPU), as a Cypher tab draws them. */
async function drawGraph(host: HTMLElement, rows: readonly (readonly unknown[])[], signal: AbortSignal): Promise<void> {
  const kit = await import('smaltkit/graph');
  const drawn = kit.resultsToGraph(rows);
  const panel = Object.assign(document.createElement('div'), { className: 'ui-play-graph' });
  const canvas = document.createElement('canvas');
  panel.append(canvas);
  host.append(panel);
  try {
    const dark = document.documentElement.classList.contains('dark');
    const view = await kit.createGraphView(canvas, { theme: dark ? 'dark' : 'light', labels: true });
    if (signal.aborted) return view.destroy();
    signal.addEventListener('abort', () => view.destroy());
    view.setGraph(drawn.graph);
  } catch (e) {
    canvas.replaceWith(
      Object.assign(document.createElement('p'), {
        className: 'sw-play-note',
        textContent: (e as Error).name === 'GpuUnavailableError' ? 'Drawing the graph needs WebGPU, which this browser doesn’t offer.' : `The graph couldn’t be drawn: ${(e as Error).message}`,
      }),
    );
  }
}
