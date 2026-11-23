// The workbench's graph: smaltcy (@smaltworks/smaltcy), a graph database for the browser that speaks Cypher, in a worker
// of its own (vendor/smaltcy/). Cypher tabs query it. The graph lives in memory, beside the SQL database (not in it):
// it starts empty, loads a sample dataset, a JSON file or an environment's graph, and exports as JSON.
//
// Results are drawn with smaltkit/graph (vendor/smaltkit/), the family's WebGPU graph view: every node, relationship and
// path in a result's rows. Where a browser has no WebGPU, the view says so and the tables still show.
import type { GraphClient, GraphStats, DatasetRequest } from '@smaltworks/smaltcy/client';
import type { CypherVocabulary } from '../vendor/smaltkit/cypher.js';

export type CypherResult = Awaited<ReturnType<GraphClient['run']>>;
export type GraphJson = Awaited<ReturnType<GraphClient['dump']>>;
export type DatasetName = DatasetRequest['name'];

/** smaltcy's sample datasets, with a line for each (the generated ones take a size). */
export const DATASETS: readonly { name: DatasetName; title: string; sized?: boolean }[] = [
  { name: 'social', title: 'A small social network: people, cities, companies' },
  { name: 'family', title: 'A family tree over four generations' },
  { name: 'metro', title: 'A metro map: stations and lines' },
  { name: 'org-chart', title: 'An organisation: people, teams and who reports to whom' },
  { name: 'packages', title: 'Software packages and their dependencies' },
  { name: 'ontology', title: 'An ontology of concepts' },
  { name: 'network', title: 'A larger social network grown by preferential attachment', sized: true },
  { name: 'airline', title: 'Airports and routes', sized: true },
  { name: 'power-grid', title: 'A power grid: plants, substations and lines', sized: true },
  { name: 'git-history', title: 'A repository: commits, files and authors', sized: true },
  { name: 'supply-chain', title: 'Suppliers, factories, warehouses and stores', sized: true },
  { name: 'microservices', title: 'Services and the calls between them', sized: true },
];

let client: GraphClient | null = null;
let starting: Promise<GraphClient> | null = null;

/** The graph's worker, started on first use. */
export function graph(): Promise<GraphClient> {
  if (client) return Promise.resolve(client);
  starting ??= import(/* @vite-ignore */ new URL('../vendor/smaltcy/smaltcy.js', import.meta.url).href).then((m: { connect(w: Worker): GraphClient }) => {
    client = m.connect(new Worker(new URL('../vendor/smaltcy/smaltcy-worker.js', import.meta.url), { type: 'module', name: 'smaltcy' }));
    return client;
  });
  return starting;
}

/** Whether the graph's worker has started (so its stats are worth asking for). */
export const graphStarted = (): boolean => client !== null;

/** What the explorer and completion know about the graph: counts by label and type, and the property keys. */
export interface GraphInfo {
  stats: GraphStats;
  vocab: CypherVocabulary;
}

let info: GraphInfo | null = null;

/** The last graph info read (refreshGraphInfo), or null before the graph is used. */
export const graphInfo = (): GraphInfo | null => info;

/** Reads the graph's counts and property keys again: after a write, a load or a dataset. */
export async function refreshGraphInfo(): Promise<GraphInfo> {
  const g = await graph();
  const stats = await g.stats();
  const keys = new Set<string>();
  // Property keys come from the data: smaltcy keeps no schema. Up to a few thousand nodes and relationships is plenty.
  for (const q of ['MATCH (n) WITH n LIMIT 5000 UNWIND keys(n) AS k RETURN DISTINCT k', 'MATCH ()-[r]->() WITH r LIMIT 5000 UNWIND keys(r) AS k RETURN DISTINCT k']) {
    try {
      for (const row of (await g.run(q)).rows) if (typeof row[0] === 'string') keys.add(row[0]);
    } catch {
      // An older smaltcy without keys() on relationships: labels and types still complete.
    }
  }
  info = {
    stats,
    vocab: { labels: Object.keys(stats.labels).sort(), types: Object.keys(stats.types).sort(), properties: [...keys].sort() },
  };
  return info;
}

/** Replaces the graph with a sample dataset. */
export async function loadDataset(name: DatasetName, size?: number): Promise<{ nodes: number; relationships: number; ms: number }> {
  const g = await graph();
  const r = await g.dataset(size ? { name, size } : { name });
  await refreshGraphInfo();
  return r;
}

/** Loads a graph from smaltcy's JSON (`dump()`'s shape); with `replace`, in place of the graph there is. */
export async function loadGraphJson(json: GraphJson, replace: boolean): Promise<void> {
  const g = await graph();
  await g.load(json, { replace });
  await refreshGraphInfo();
}

/** The whole graph as smaltcy's JSON. */
export async function dumpGraph(): Promise<GraphJson> {
  return (await graph()).dump();
}

// Values as text (cypherCell, hasGraphValues): app/cypher-values.ts, shared with the docs.
export { cypherCell, hasGraphValues } from './cypher-values.js';

// ---------------------------------------------------------------------------------------------------- drawing

interface GraphViewLike {
  setGraph(g: unknown): void;
  setMode(mode: '2d' | '3d'): void;
  setLayoutMode(mode: 'force' | 'fixed'): void;
  setTheme(theme: 'light' | 'dark'): void;
  setSpread(spread: number): void;
  fit(): void;
  destroy(): void;
}

/** Views that are drawing: the oldest is freed when there are more (each holds GPU memory). */
const views: GraphViewLike[] = [];
const MAX_VIEWS = 4;

const isDark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);

/**
 * Draws every node, relationship and path in `rows` into `pane`: smaltkit's GPU graph view, with 2D / 3D, Force /
 * Fixed, Spread and Fit. Without WebGPU it shows a note instead.
 */
export async function drawResultGraph(pane: HTMLElement, rows: readonly (readonly unknown[])[]): Promise<void> {
  pane.classList.add('cy-graph-pane');
  const kit = await import(/* @vite-ignore */ new URL('../vendor/smaltkit/graph.js', import.meta.url).href) as typeof import('../vendor/smaltkit/graph.js');
  const drawn = kit.resultsToGraph(rows);
  const note = (text: string) => pane.replaceChildren(Object.assign(document.createElement('div'), { className: 'placeholder', textContent: text }));
  if (!drawn.nodes.length) return note('No nodes, relationships or paths in this result.');
  const bar = document.createElement('div');
  bar.className = 'cy-graph-bar';
  bar.innerHTML =
    '<button data-mode="2d" class="on">2D</button><button data-mode="3d">3D</button><span class="sep"></span>' +
    '<button data-layout="force" class="on" title="Physics">Force</button><button data-layout="fixed" title="Locked, spread out by group">Fixed</button>' +
    '<input type="range" data-spread min="-100" max="100" value="0" aria-label="Spread: how far apart the nodes are" title="Spread">' +
    `<button data-fit>Fit</button><span class="grow"></span><span class="cy-graph-count">${drawn.nodes.length} node${drawn.nodes.length === 1 ? '' : 's'} · ${drawn.relationships.length} relationship${drawn.relationships.length === 1 ? '' : 's'}</span>`;
  const canvas = document.createElement('canvas');
  canvas.className = 'cy-graph-canvas';
  pane.replaceChildren(bar, canvas);
  let view: GraphViewLike;
  try {
    view = (await kit.createGraphView(canvas, { theme: isDark() ? 'dark' : 'light', labels: true })) as unknown as GraphViewLike;
  } catch (e) {
    return note((e as Error).name === 'GpuUnavailableError' ? 'Drawing the graph needs WebGPU, which this browser doesn’t offer. The result tables show everything.' : `The graph couldn’t be drawn: ${(e as Error).message}`);
  }
  while (views.length >= MAX_VIEWS) views.shift()!.destroy();
  views.push(view);
  // The pane goes when the tab runs again or closes: free the view's GPU memory with it.
  const gone = new MutationObserver(() => {
    if (pane.isConnected) return;
    gone.disconnect();
    const i = views.indexOf(view);
    if (i >= 0) views.splice(i, 1);
    view.destroy();
  });
  gone.observe(document.body, { childList: true, subtree: true });
  view.setGraph(drawn.graph);
  bar.querySelector<HTMLInputElement>('[data-spread]')!.addEventListener('input', (e) => view.setSpread(Math.exp((Number((e.target as HTMLInputElement).value) / 100) * Math.log(5))));
  bar.addEventListener('click', (e) => {
    const b = (e.target as Element).closest('button');
    if (!b) return;
    if (b.hasAttribute('data-fit')) return view.fit();
    const layout = b.getAttribute('data-layout') as 'force' | 'fixed' | null;
    if (layout) {
      view.setLayoutMode(layout);
      bar.querySelectorAll('[data-layout]').forEach((x) => x.classList.toggle('on', x === b));
      return;
    }
    const mode = b.getAttribute('data-mode') as '2d' | '3d' | null;
    if (mode) {
      view.setMode(mode);
      bar.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b));
    }
  });
}

/** Follows the page's theme in every view that is drawing. */
export function setGraphTheme(): void {
  for (const v of views) v.setTheme(isDark() ? 'dark' : 'light');
}
