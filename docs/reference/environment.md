---
description: 'The environment manifest: its fields, the step kinds (sql, sqlFile, import, data, link, connection), saved queries and the graph.'
---

# Environment manifest

An environment is a JSON file that builds a database when the workbench opens it with `?env=<url>`. The
[Environments](../guide/environments) guide shows a whole one. Paths in it are relative to the manifest's own URL.

## Fields

| Field | Type | What it does |
| --- | --- | --- |
| `smaltui` | `1` | The format's version. |
| `name` | string | The environment's name, shown while it loads. |
| `description` | string | A line about it. |
| `exportedAt` | string | When **⋯ → Export database as environment** wrote it (an ISO date). |
| `database` | `{ name?, storage? }` | The database to build: its name, and `"memory"` or `"opfs"` (the browser's private storage). |
| `init` | `"once"` or `"always"` | With `"opfs"`: build it only when it doesn't exist yet (`"once"`, the default), or again on every visit. |
| `steps` | array | What to run, in order (below). |
| `queries` | array | Tabs to open: `{ "title", "sql", "lang"? }`. `lang` is `"sql"` (the default), `"ts"` (a TypeScript tab) or `"cypher"` (a Cypher tab); `sql` holds the tab's text in any of them. |
| `open` | string[] | Tables to open in the table viewer. |
| `graph` | `{ dataset?, size?, url? }` | The graph for Cypher tabs: one of smaltcy's sample datasets by name (`size` for the generated ones), or smaltcy's JSON at `url`. It replaces the graph. |

## Steps

Each step does one thing, named by its first key:

| Step | Keys | What it does |
| --- | --- | --- |
| SQL | `sql` | Runs the statements. |
| SQL file | `sqlFile` | Fetches a `.sql` file and runs it. |
| Import | `import`, `table`, `format`?, `options`? | Copies rows from a CSV, TSV, JSON, NDJSON or Parquet file into `table`, creating it with inferred types if it doesn't exist. `format` defaults to the file's extension. |
| Inline rows | `data`, `table`, `options`? | Copies an array of objects into `table`, as JSON is imported. |
| Link | `link`, `table`, `format`?, `options`?, `connectionName`?, `columns`? | Creates an external table that reads the file or URL when it is queried. `columns` is `[{ "name", "type"? }]`; without it the columns are inferred. |
| Connection | `connection`, `url` | Creates a connection (`CREATE CONNECTION … WITH (url = …)`) that links can name with `connectionName`. |

`options` are the reader's options, as `read_csv()` and `read_json()` take them, such as `{ "header": true }` or
`{ "delimiter": ";" }` ([`@smaltdb/io`](https://smaltdb.dev)). A source must be reachable from the browser: the same
origin, or a server that allows it (CORS).
