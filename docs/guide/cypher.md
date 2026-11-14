# Cypher tabs (smaltcy)

Beside its SQL and TypeScript tabs, the workbench has Cypher tabs (**Cypher** in the header): an editor for Cypher on
the workbench's graph, kept by [smaltcy](https://stenhoor.github.io/smaltcy/), the smalt family's graph database for the
browser. A result shows as tables and text, and when it holds nodes, relationships or paths, as a graph drawn on the
GPU. The **Demo** has one: its **Graph (Cypher)** tab, on smaltcy's social sample.

```cypher
MATCH (p:Person)-[:LIVES_IN]->(c:City)
RETURN c.name AS city, count(p) AS people
ORDER BY people DESC, city;

MATCH path = (a:Person)-[:KNOWS]->(b:Person)
RETURN path
LIMIT 50;
```

## The graph

The graph lives beside the SQL database, in a worker of its own, and in memory: it starts empty and lasts until the
page closes. The explorer's **Graph** group lists its labels and relationship types with their counts; click one to
open a Cypher tab with its nodes or relationships. To fill it:

- **Sample…** (in the Graph group, or **⋯ → Load a sample graph…**) loads one of smaltcy's sample datasets: a social
  network, a family tree, a metro map, an organisation, packages, an ontology, or generated ones (a network, airline
  routes, a power grid, a repository's history, a supply chain, microservices) of the size you ask for.
- **Open…** (or **⋯ → Open graph (JSON)…**) loads a graph saved as smaltcy's JSON, in place of the graph or added to it.
- **Export** (or **⋯ → Export graph as JSON**) saves the graph as smaltcy's JSON.
- `CREATE`, `MERGE`, `SET`, `REMOVE` and `DELETE` in a Cypher tab write to it.
- An [environment](./environments) names a graph with `"graph"`: a sample by name (`{ "dataset": "social" }`), or
  smaltcy's JSON at a URL (`{ "url": "graph.json" }`).

## Running

- **Run** (<kbd>Ctrl</kbd>+<kbd>Enter</kbd>) runs the statement at the cursor, or the selection; statements end with
  `;`. **Script** (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd> or <kbd>F5</kbd>) runs them all, in order, and
  stops at an error.
- **Explain** (<kbd>Ctrl</kbd>+<kbd>E</kbd>) shows the plan of the statement at the cursor without running it.
- **Open…** and **Save** read and write `.cypher` files (<kbd>Ctrl</kbd>+<kbd>S</kbd>).

Each statement's result is a tab of its own:

- **Result** is a grid. Numbers, strings and booleans are as they are; nodes, relationships, paths, lists and maps
  are written in Cypher's own notation: `(:Person {name: 'Ada', born: 1815})`, `[:KNOWS {since: 1833}]`, a path as its
  nodes and relationships.
- **Graph** draws every node, relationship and path in the results, with smaltkit's graph view: **2D** or **3D**,
  **Force** (physics) or **Fixed** (spread out by label), **Spread** and **Fit**. Drag to pan or move a node, scroll to
  zoom. Drawing needs WebGPU; where a browser doesn't offer it, the tab says so and the grids show everything.
- **Plan** is **Explain**'s: the steps smaltcy's engine takes.
- **Plan data** is the graph plan the statement compiled to, the JSON smaltcy's engine ran.
- **Messages:** how many rows, what a write did ("1 node created, 1 property set"), how long it took, or the error. A
  syntax error is also marked where it is in the editor.

The editor highlights Cypher and completes keywords, functions, and the graph's labels (after `:` in a node), relationship
types (after `:` in a relationship) and property keys (after `.`), with <kbd>Ctrl</kbd>+<kbd>Space</kbd>. Cypher tabs
are kept with the other tabs, and carried in manifests as queries with `"lang": "cypher"`.

The Cypher smaltcy speaks, its functions and what it doesn't support yet are in
[smaltcy's documentation](https://stenhoor.github.io/smaltcy/).
