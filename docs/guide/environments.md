---
description: 'Environments: a JSON manifest that builds a database, its saved queries and its graph when the page opens.'
---

# Environments

An environment is a JSON manifest that builds a database when the page opens:

```
https://your.host/smaltui/workbench/?env=envs/demo/env.json
```

```json
{
  "smaltui": 1,
  "name": "Demo shop",
  "database": { "name": "demo", "storage": "memory" },
  "init": "always",
  "steps": [
    { "sqlFile": "schema.sql" },
    { "sql": "CREATE INDEX …;" },
    { "import": "data/products.csv", "table": "products" },
    { "import": "data/customers.json", "table": "customers" },
    { "import": "data/sales.parquet", "table": "sales" },
    { "table": "notes", "data": [{ "id": 1, "body": "inline rows" }] },
    { "connection": "api", "url": "https://data.example.com/v1/" },
    { "link": "data/exchange_rates.csv", "table": "exchange_rates", "format": "csv", "options": { "header": true } }
  ],
  "queries": [
    { "title": "Revenue", "sql": "SELECT …" },
    { "title": "Frames", "lang": "ts", "sql": "table('orders').head(10)" },
    { "title": "Friends", "lang": "cypher", "sql": "MATCH (a:Person)-[:KNOWS]->(b) RETURN a, b" }
  ],
  "open": ["orders"],
  "graph": { "dataset": "social" }
}
```

- Paths are relative to the manifest. `import` copies rows into a table (a missing table is created with inferred
  types). `link` creates an external table that reads the source at query time. The source must be reachable from
  the browser: the same origin, or a server that allows CORS.
- `storage: "memory"` rebuilds the database on every visit. With `"opfs"`, `init: "once"` (the default) builds it on
  the first visit and keeps the visitor's changes after that. `"always"` rebuilds it on every visit.
- `graph` fills the workbench's graph for [Cypher tabs](./cypher): a sample dataset of smaltcy's by name
  (`"dataset"`, with `"size"` for the generated ones), or a graph in smaltcy's JSON (`"url"`, relative to the
  manifest). A query with `"lang": "cypher"` opens as a Cypher tab, `"ts"` as a TypeScript tab.
- Every field and step kind is in the [environment reference](../reference/environment).
- `envs/index.json` lists the environments shown in the Import tab.
- **⋯ → Export database as environment** writes a manifest of the open database: its schema, the rows of local
  tables, external tables and connections by reference (never credentials), and your query, TypeScript and Cypher
  tabs. The graph isn't in it: **⋯ → Export graph as JSON** saves it, and `"graph": { "url": … }` loads it again. **⋯ → Export database as SQL dump**
  writes plain SQL.

`envs/demo/` is a small tea-and-coffee shop with sample data. It has tables, indexes, a view, a materialized view,
a linked CSV, sales data imported from a Parquet file, saved queries, and smaltcy's social sample as its graph. The welcome tab opens it:
**Demo**, in the top nav, opens it.
