---
description: 'Files smaltui reads and writes: .sql, .ts and .cypher tabs, result and table exports, SQL dumps, environments, graphs and imports.'
---

# Files

Everything is read from and written to your computer by the browser: **Open…** chooses a file, and a save is a
download.

## Written

| File | From | Holds |
| --- | --- | --- |
| `*.sql` | **Save** in a query tab | The tab's SQL. |
| `*.ts` | **Save** in a TypeScript tab | The tab's TypeScript. |
| `*.cypher` | **Save** in a Cypher tab | The tab's Cypher. |
| `result.csv`, `result.json`, `result.sql` | **CSV**, **JSON** and **SQL** under a result | The fetched rows: CSV with a header row, a JSON array of objects, or `INSERT` statements. |
| `<table>.csv`, `<table>.json` | Right-click a table → export | The whole table. |
| `<database>.sql` | **⋯ → Export database as SQL dump** | The schema and rows as SQL statements. |
| `<database>.env.json` | **⋯ → Export database as environment** | An [environment manifest](./environment): the schema, the rows of local tables, external tables and connections by reference (never credentials), and the open tabs. |
| `graph.json` | **⋯ → Export graph as JSON**, or **Export** in the explorer's Graph | The graph, in smaltcy's JSON. |

## Read

| File | Into | |
| --- | --- | --- |
| `*.sql`, `*.ts`, `*.cypher` | **Open…** in a tab of that kind | |
| CSV, TSV, JSON, NDJSON, Parquet | The [Import tab](../guide/import) | Imported into a table, or linked as an external table. |
| An environment's `.json` | **⋯ → Load environment…**, or `?env=` | |
| A graph's `.json` | **⋯ → Open graph (JSON)…** | smaltcy's JSON, in place of the graph or added to it. |
