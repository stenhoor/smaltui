// The plan graph: a plan drawn as a tree of operators, data flowing up from the leaves to the root. Two sources:
//   - plan data, the plan statement a language submitted to the engine (smaltdb's plan format, as JSON);
//   - the engine's query plan, the rows of EXPLAIN QUERY PLAN or EXPLAIN ANALYZE (id, parent, detail, and with
//     Analyze est_rows, loops, rows, time_ms).
// With Analyze, the graph carries the numbers: an edge's width follows the rows that flow up it, a box's fill its share
// of the query's self time, and a flag marks rows that miss the planner's estimate by 10x or more. A list of the
// costliest operators sits above the graph. Clicking a box shows everything about it. Drawn with our own code and the
// brand tokens: no layout library.

export interface PlanNode {
  /** The operator's name: `filter`, `SCAN orders (fused scan + filter)`. */
  label: string;
  /** A short second line: the table, the condition, the keys. */
  sub: string;
  /** Everything about the operator, for the details panel. */
  details: string;
  children: PlanNode[];
  /** EXPLAIN ANALYZE only. */
  stats?: { rows: number; estRows: number | null; loops: number; totalMs: number; selfMs: number };
}

// ------------------------------------------------------------------ plan data

/** The plan tree of a plan statement (the JSON text Plan data shows), or null when it holds no plan. */
export function planDataTree(json: string): PlanNode | null {
  let stmt: unknown;
  try {
    stmt = JSON.parse(json);
  } catch {
    return null;
  }
  const s = stmt as { kind?: string; plan?: unknown; query?: { plan?: unknown }; op?: unknown };
  const plan = s.kind === 'explain' ? s.query?.plan : s.plan ?? (typeof s.op === 'string' ? s : undefined);
  return isOp(plan) ? opNode(plan) : null;
}

type Op = Record<string, unknown> & { op: string };
const isOp = (x: unknown): x is Op => typeof x === 'object' && x !== null && typeof (x as { op?: unknown }).op === 'string';

function opNode(op: Op): PlanNode {
  const children: PlanNode[] = [];
  const own: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(op)) {
    if (isOp(v)) children.push(opNode(v));
    else if (Array.isArray(v) && v.length > 0 && v.every(isOp)) for (const x of v) children.push(opNode(x));
    else own[k] = v;
  }
  return { label: op.op, sub: summary(op), details: JSON.stringify(own, (_k, x) => (typeof x === 'bigint' ? String(x) : x), 2), children };
}

/** One line about an operation, from its fields. */
function summary(op: Op): string {
  const e = (x: unknown) => expr(x);
  const list = (xs: unknown) => (Array.isArray(xs) ? xs.map(e).join(', ') : '');
  switch (op.op) {
    case 'scan':
      return String(op.table ?? '');
    case 'filter':
      return e(op.pred);
    case 'project':
      return list(op.exprs);
    case 'aggregate': {
      const keys = Array.isArray(op.keys) ? op.keys.map((k) => e((k as { expr?: unknown }).expr)) : [];
      const aggs = Array.isArray(op.aggs) ? op.aggs.map((a) => `${(a as { fn?: string }).fn ?? '?'}(${(a as { star?: boolean }).star ? '*' : list((a as { args?: unknown }).args)})`) : [];
      return [aggs.join(', '), keys.length ? `by ${keys.join(', ')}` : ''].filter(Boolean).join(' ');
    }
    case 'sort':
      return Array.isArray(op.keys) ? op.keys.map((k) => `${e((k as { expr?: unknown }).expr)}${(k as { desc?: boolean }).desc ? ' desc' : ''}`).join(', ') : '';
    case 'limit':
      return `${e(op.count)}${op.offset !== undefined ? ` offset ${e(op.offset)}` : ''}`;
    case 'join':
      return `${String(op.kind ?? '')}${op.on ? ` on ${e(op.on)}` : ''}`;
    case 'append':
    case 'update':
    case 'delete':
      return String(op.table ?? '');
    case 'values':
      return `${Array.isArray(op.rows) ? op.rows.length : 0} rows`;
    case 'source':
      return String(op.name ?? '');
    default:
      return '';
  }
}

/** A plan expression, short: columns as `#n`, calls as `fn(args)`. */
function expr(x: unknown): string {
  if (x === null || typeof x !== 'object') return String(x);
  const o = x as Record<string, unknown>;
  switch (o.k) {
    case 'col':
      return `#${String(o.index)}`;
    case 'lit':
      return typeof o.value === 'string' ? `'${o.value}'` : String(o.value);
    case 'param':
      return `?${Number(o.index) + 1}`;
    case 'call':
      return `${String(o.fn)}(${Array.isArray(o.args) ? o.args.map(expr).join(', ') : ''})`;
    case 'cast':
      return `${String(o.fn)}(${expr(o.arg)})`;
    case 'and':
    case 'or':
      return Array.isArray(o.args) ? o.args.map(expr).join(` ${String(o.k)} `) : String(o.k);
    case 'not':
      return `not ${expr(o.arg)}`;
    case 'isNull':
      return `${expr(o.arg)} is ${o.not ? 'not ' : ''}null`;
    case 'case':
      return 'case …';
    case 'subquery':
    case 'inSubquery':
      return '(subquery)';
    default:
      return '…';
  }
}

// ------------------------------------------------------------------ query plan

/** The tree of EXPLAIN QUERY PLAN or EXPLAIN ANALYZE rows (columns id, parent, detail …), or null. */
export function queryPlanTree(rows: readonly (readonly unknown[])[], columns: readonly string[]): PlanNode | null {
  const at = (name: string) => columns.indexOf(name);
  const [iId, iParent, iDetail] = [at('id'), at('parent'), at('detail')];
  if (iId < 0 || iParent < 0 || iDetail < 0) return null;
  const [iEst, iLoops, iRows, iTime] = [at('est_rows'), at('loops'), at('rows'), at('time_ms')];
  const analyze = iRows >= 0 && iTime >= 0;
  const byId = new Map<number, PlanNode & { parent: number }>();
  for (const r of rows) {
    const detail = String(r[iDetail] ?? '');
    const paren = detail.indexOf(' (');
    const node: PlanNode & { parent: number } = {
      label: paren > 0 ? detail.slice(0, paren) : detail,
      sub: paren > 0 ? detail.slice(paren + 2, detail.endsWith(')') ? -1 : undefined) : '',
      details: columns.map((c, i) => `${c}: ${String(r[i] ?? 'NULL')}`).join('\n'),
      children: [],
      parent: Number(r[iParent]),
    };
    if (analyze) {
      const est = iEst >= 0 && r[iEst] !== null && r[iEst] !== undefined ? Number(r[iEst]) : null;
      node.stats = { rows: Number(r[iRows] ?? 0), estRows: est, loops: Number(iLoops >= 0 ? r[iLoops] ?? 1 : 1), totalMs: Number(r[iTime] ?? 0), selfMs: 0 };
    }
    byId.set(Number(r[iId]), node);
  }
  const roots: PlanNode[] = [];
  for (const n of byId.values()) {
    const p = byId.get(n.parent);
    (p ? p.children : roots).push(n);
  }
  // Self time: an operator's time minus its inputs' (time_ms counts the inputs).
  for (const n of byId.values()) if (n.stats) n.stats.selfMs = Math.max(0, n.stats.totalMs - n.children.reduce((s, c) => s + (c.stats?.totalMs ?? 0), 0));
  if (roots.length === 0) return null;
  return roots.length === 1 ? roots[0]! : { label: 'QUERY PLAN', sub: '', details: '', children: roots };
}

// ------------------------------------------------------------------ drawing

const BOX_W = 232;
const BOX_H = 48;
const GAP_X = 24;
const GAP_Y = 44;
const PAD = 20;

interface Placed {
  node: PlanNode;
  x: number;
  y: number;
  parent: Placed | null;
}

/** Top-down tidy layout: leaves side by side, a parent centred over its children. */
function layout(root: PlanNode): { placed: Placed[]; width: number; height: number } {
  const placed: Placed[] = [];
  let nextLeft = PAD;
  let maxDepth = 0;
  const walk = (n: PlanNode, depth: number, parent: Placed | null): Placed => {
    maxDepth = Math.max(maxDepth, depth);
    const p: Placed = { node: n, x: 0, y: PAD + depth * (BOX_H + GAP_Y), parent };
    placed.push(p);
    if (n.children.length === 0) {
      p.x = nextLeft;
      nextLeft += BOX_W + GAP_X;
    } else {
      const kids = n.children.map((c) => walk(c, depth + 1, p));
      p.x = (kids[0]!.x + kids[kids.length - 1]!.x) / 2;
    }
    return p;
  };
  walk(root, 0, null);
  return { placed, width: nextLeft - GAP_X + PAD, height: PAD * 2 + (maxDepth + 1) * BOX_H + maxDepth * GAP_Y };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const fmtRows = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : String(n));
const fmtMs = (ms: number) => (ms >= 100 ? `${Math.round(ms)} ms` : `${ms.toFixed(ms >= 10 ? 1 : 2)} ms`);

/** Whether a node's rows miss its estimate by 10x or more. */
const offEstimate = (s: NonNullable<PlanNode['stats']>) => s.estRows !== null && Math.max(s.rows, 1) / Math.max(s.estRows, 1) >= 10 || (s.estRows !== null && Math.max(s.estRows, 1) / Math.max(s.rows, 1) >= 10);

/**
 * Draw `root` into `host`: the costliest operators (with Analyze), the graph, and a details panel for the selected
 * box. `title` heads the graph.
 */
export function drawPlanGraph(host: HTMLElement, root: PlanNode, title: string): void {
  const { placed, width, height } = layout(root);
  const all = placed.map((p) => p.node);
  const analyzed = all.some((n) => n.stats);
  const totalSelf = all.reduce((s, n) => s + (n.stats?.selfMs ?? 0), 0) || 1;
  const maxRows = Math.max(1, ...all.map((n) => n.stats?.rows ?? 0));
  const edgeWidth = (n: PlanNode) => (n.stats ? 1.5 + 8 * Math.log10(1 + n.stats.rows) / Math.log10(1 + maxRows) : 1.5);

  const section = document.createElement('div');
  section.className = 'pg';
  section.innerHTML = `<div class="pg-title">${esc(title)}</div>`;

  // The costliest operators by self time, Snowflake's "most expensive nodes".
  if (analyzed) {
    const top = placed.filter((p) => p.node.stats).sort((a, b) => b.node.stats!.selfMs - a.node.stats!.selfMs).slice(0, 5);
    const list = document.createElement('ol');
    list.className = 'pg-top';
    list.innerHTML = top.map((p, i) => `<li data-pg="${placed.indexOf(p)}"><span class="pg-share">${Math.round((100 * p.node.stats!.selfMs) / totalSelf)}%</span> ${esc(clip(p.node.label, 48))} <span class="pg-faint">${fmtMs(p.node.stats!.selfMs)} self · ${fmtRows(p.node.stats!.rows)} rows</span></li>`).join('');
    if (top.length) section.appendChild(Object.assign(document.createElement('div'), { className: 'pg-head', textContent: 'Costliest operators (self time)' })).after(list);
  }

  const body = document.createElement('div');
  body.className = 'pg-body';
  const scroller = document.createElement('div');
  scroller.className = 'pg-scroll';
  const panel = document.createElement('pre');
  panel.className = 'pg-details';
  panel.textContent = 'Click an operator to see everything about it.';

  const parts: string[] = [];
  // Edges: from each child's top up to its parent's bottom, as wide as the rows that flow up them.
  for (const p of placed) {
    if (!p.parent) continue;
    const x1 = p.x + BOX_W / 2;
    const y1 = p.y;
    const x2 = p.parent.x + BOX_W / 2;
    const y2 = p.parent.y + BOX_H;
    const my = (y1 + y2) / 2;
    const rows = p.node.stats ? `<title>${fmtRows(p.node.stats.rows)} rows</title>` : '';
    parts.push(`<path class="pg-edge" d="M${x1} ${y1}C${x1} ${my} ${x2} ${my} ${x2} ${y2 + 4}" stroke-width="${edgeWidth(p.node).toFixed(1)}" marker-end="url(#pg-arrow)">${rows}</path>`);
    if (p.node.stats) parts.push(`<text class="pg-edge-label" x="${x1 + 6}" y="${y1 - 8}">${fmtRows(p.node.stats.rows)}</text>`);
  }
  // Boxes: filled by share of self time; a flag where rows miss the estimate 10x or more.
  placed.forEach((p, i) => {
    const s = p.node.stats;
    const share = s ? s.selfMs / totalSelf : 0;
    const fill = s ? `color-mix(in srgb, var(--danger) ${Math.round(6 + 60 * share)}%, var(--surface))` : 'var(--surface)';
    const sub = s ? `${fmtMs(s.selfMs)} self · ${Math.round(100 * share)}%` : p.node.sub;
    const flag = s && offEstimate(s) ? `<g class="pg-flag"><title>${fmtRows(s.rows)} rows, estimated ${fmtRows(s.estRows ?? 0)}</title><path d="M${p.x + BOX_W - 22} ${p.y + 6}l8 14h-16z"/></g>` : '';
    parts.push(
      `<g class="pg-node" data-pg="${i}" tabindex="0"><title>${esc(p.node.label)}${p.node.sub ? `\n${esc(p.node.sub)}` : ''}</title>` +
        `<rect x="${p.x}" y="${p.y}" width="${BOX_W}" height="${BOX_H}" rx="8" style="fill:${fill}"/>` +
        `<text class="pg-label" x="${p.x + 12}" y="${p.y + 20}">${esc(clip(p.node.label, 30))}</text>` +
        `<text class="pg-sub" x="${p.x + 12}" y="${p.y + 37}">${esc(clip(sub, 36))}</text>${flag}</g>`,
    );
  });
  scroller.innerHTML =
    `<svg class="pg-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">` +
    `<defs><marker id="pg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="pg-arrowhead"/></marker></defs>` +
    parts.join('') +
    `</svg>`;

  const select = (i: number) => {
    scroller.querySelectorAll('.pg-node.sel').forEach((n) => n.classList.remove('sel'));
    scroller.querySelector(`.pg-node[data-pg="${i}"]`)?.classList.add('sel');
    const n = placed[i]!.node;
    const s = n.stats;
    const head = [n.label, n.sub].filter(Boolean).join('\n');
    const stats = s ? `\n\nrows ${s.rows}${s.estRows !== null ? ` (estimated ${s.estRows})` : ''} · loops ${s.loops}\ntime ${fmtMs(s.totalMs)} with its inputs · ${fmtMs(s.selfMs)} self` : '';
    panel.textContent = head + stats + (n.details ? `\n\n${n.details}` : '');
  };
  scroller.addEventListener('click', (ev) => {
    const g = (ev.target as Element).closest('.pg-node');
    if (g) select(Number(g.getAttribute('data-pg')));
  });
  scroller.addEventListener('keydown', (ev) => {
    const g = (ev.target as Element).closest('.pg-node');
    if (g && (ev.key === 'Enter' || ev.key === ' ')) {
      ev.preventDefault();
      select(Number(g.getAttribute('data-pg')));
    }
  });
  section.querySelectorAll('.pg-top li').forEach((li) => li.addEventListener('click', () => select(Number(li.getAttribute('data-pg')))));

  body.append(scroller, panel);
  section.appendChild(body);
  if (analyzed) {
    const key = document.createElement('div');
    key.className = 'pg-key';
    key.textContent = 'Edge width: rows · fill: share of self time · ▲ rows 10x off the estimate';
    section.appendChild(key);
  }
  host.appendChild(section);
}
