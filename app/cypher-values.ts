// Cypher result values as text: nodes, relationships, paths, lists and maps in Cypher's own notation, as a Cypher tab's
// grid shows them. Pure (no DOM, no worker), so the workbench, the docs' playgrounds and the docs examples test
// (test/docs-examples.mjs) all print a result the same way.

interface NodeValue {
  kind: 'node';
  id: number | string;
  labels: readonly string[];
  properties: Record<string, unknown>;
}

interface RelValue {
  kind: 'relationship';
  id: number | string;
  type: string;
  properties: Record<string, unknown>;
}

const isKind = (v: unknown, kind: string): boolean => !!v && typeof v === 'object' && (v as { kind?: unknown }).kind === kind;

/** A map's entries as Cypher writes them: `{name: 'Ada', since: 1833}`. */
function mapText(m: Record<string, unknown>): string {
  const entries = Object.entries(m);
  return entries.length ? `{${entries.map(([k, v]) => `${/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : '`' + k + '`'}: ${valueText(v)}`).join(', ')}}` : '';
}

/**
 * A result value as a grid cell's text, in Cypher's notation: a node `(:Person {name: 'Ada'})`, a relationship
 * `[:KNOWS {since: 1833}]`, a path as its nodes and relationships, lists and maps as literals. Other values stay as
 * they are (numbers, strings, booleans, null), so the grid sorts and aligns them.
 */
export function cypherCell(v: unknown): string | number | bigint | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint') return v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return valueText(v);
}

function valueText(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (typeof v !== 'object') return String(v);
  if (isKind(v, 'node')) {
    const n = v as NodeValue;
    const props = mapText(n.properties);
    return `(${n.labels.map((l) => ':' + l).join('')}${props && n.labels.length ? ' ' : ''}${props})`;
  }
  if (isKind(v, 'relationship')) {
    const r = v as RelValue;
    const props = mapText(r.properties);
    return `[:${r.type}${props ? ' ' + props : ''}]`;
  }
  if (isKind(v, 'path')) {
    const p = v as { nodes: NodeValue[]; relationships: (RelValue & { start: unknown; end: unknown })[] };
    let s = valueText(p.nodes[0]);
    p.relationships.forEach((r, i) => {
      const forward = r.start === p.nodes[i]?.id;
      s += `${forward ? '-' : '<-'}${valueText(r)}${forward ? '->' : '-'}${valueText(p.nodes[i + 1])}`;
    });
    return s;
  }
  if (Array.isArray(v)) return `[${v.map(valueText).join(', ')}]`;
  if (v instanceof Date) return v.toISOString();
  return mapText(v as Record<string, unknown>) || '{}';
}

/** Whether any value in the rows is a node, relationship or path: a result worth drawing. */
export function hasGraphValues(rows: readonly (readonly unknown[])[]): boolean {
  const seen = (v: unknown): boolean => {
    if (!v || typeof v !== 'object') return false;
    if (isKind(v, 'node') || isKind(v, 'relationship') || isKind(v, 'path')) return true;
    return (Array.isArray(v) ? v : Object.values(v)).some(seen);
  };
  return rows.some((r) => r.some(seen));
}
