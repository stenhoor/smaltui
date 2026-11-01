# smaltui

A query workbench for [smaltdb](https://github.com/stenhoor/smaltdb), the SQL database engine that runs in the browser.
smaltui is in the spirit of Toad: an object explorer, tabbed SQL editors, data grids you can browse and edit, and
import tools. It is a **static site**. There is no server: the engine runs in a Web Worker in each visitor's browser,
and databases are stored in that browser's private storage (OPFS) or in memory.

Serve the folder from any static host and you have a live environment. Add `?env=…` and the page builds a ready-made
database (schema, data, linked sources, saved queries) when it opens.

## Features

- **Object explorer:** tables, views, materialized views, external tables and connections, with their columns and
  primary keys. A filter box. Right-click an object to script SELECT/INSERT/UPDATE/DDL, count rows, refresh, export or drop it.
- **Query editor:** several tabs, all saved in the browser. Syntax highlighting, line numbers, and completion for
  keywords, functions, tables, columns and aliases (`Ctrl+Space`). Comment toggling, a formatter, and open/save `.sql` files.
  - `Ctrl+Enter` runs the statement under the cursor (it is shaded) or the selection. `Ctrl+Shift+Enter` / `F5` runs the
    whole script, statement by statement, with a message log and one result tab per result set.
  - Bind variables: `?`, `?1`, `:name`, `@name` and `$name` open a dialog that asks for their values.
  - Explain (`Ctrl+E`) shows the `EXPLAIN QUERY PLAN` tree. Analyze shows `EXPLAIN ANALYZE`.
  - Results are fetched on demand: the first 1,000 rows, then **Fetch more** or **Fetch all**. Grids are virtualized.
  - Syntax errors mark the failing token in the editor. `Esc` or **Stop** cancels a running statement.
  - Export results as CSV, JSON or INSERT statements, copy them as TSV, or save them as a new table.
- **Table viewer:** paged data with server-side sorting (click a header) and a free-form `WHERE` filter. Columns,
  indexes, constraints and highlighted DDL. For external tables it shows the source; for materialized views, refresh
  controls. In tables with a primary key you can edit a cell (double-click or `Enter`; `Ctrl+Delete` sets NULL),
  insert rows and delete rows.
- **Import tab:**
  - *Import into a table:* load a file (drop or choose), a URL, or pasted CSV / TSV / JSON / NDJSON. The preview shows
    the inferred column types. You can create a new table or append to an existing one.
  - *Link an external table:* `CREATE EXTERNAL TABLE` over a URL or a local file, with optional connections, auth
    headers (kept in memory only) and a local materialized-view cache. The SQL is shown and can be edited before it
    runs. On Chromium, local files stay linked across reloads (File System Access handles in IndexedDB). Elsewhere,
    the sidebar asks you to attach them again.
  - *Environments:* load a manifest, or export the current database as one.
- **Databases:** open, create or delete OPFS databases, or use in-memory ones (`Ctrl+Shift+O`). The database is
  stored in the URL (`?db=name`, `&storage=memory`), so a link reopens it.
- **History** of every statement run, searchable, per database. **Light and dark** themes. Usable on a phone.

## Run it locally

```bash
npm install
```

```bash
npm run serve        # http://localhost:8080
```

`scripts/serve.mjs` sends COOP/COEP headers, so the page is cross-origin isolated. smaltdb then uses parallel
reader workers and can interrupt running statements. OPFS needs a secure context; `localhost` counts.

## The smaltdb engine

smaltdb is not on npm yet, so smaltui ships a **vendored build** in `vendor/smaltdb/` (`smaltdb.js`, the client, and
`smaltdb-worker.js`, the engine). `vendor/smaltdb/VERSION.json` records the commit. To update it:

```bash
npm run vendor                         # bundle github.com/stenhoor/smaltdb@main from source
```

```bash
npm run vendor -- --ref <sha|branch>   # a specific revision
```

```bash
npm run vendor -- --from ../smaltdb    # a local checkout
```

When smaltdb is published, either vendor it from npm (`npm install smaltdb && npm run vendor -- --npm`) or skip
vendoring and load it from a CDN at runtime:

| URL parameter | Engine |
|---|---|
| *(none)* / `?engine=vendor` | `./vendor/smaltdb/` |
| `?engine=npm` | latest `smaltdb` from jsDelivr |
| `?engine=npm@0.2.0` | a specific npm version |
| `?engine=https://host/path/dist/` | any folder that serves `smaltdb.js` + `smaltdb-worker.js` |

The choice can also be made in **⋯ → Engine source** (it is remembered per browser). A cross-origin engine worker is
started through a same-origin blob module, so a CDN works without extra setup.

## Deploy

`npm run build` copies the site to `dist/`. Any static host works.

- **GitHub Pages:** `.github/workflows/pages.yml` deploys on every push to `main`. (Enable Pages with "GitHub
  Actions" as the source.) Run it manually with `smaltdb_ref` set to rebuild the engine from that ref first.
  GitHub Pages cannot send COOP/COEP headers. smaltui works there, but without parallel readers.
- **Netlify / Cloudflare Pages:** `_headers` adds the isolation headers.

## Environments

An environment is a JSON manifest that builds a database when the page opens:

```
https://your.host/smaltui/?env=envs/demo/env.json
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
    { "table": "notes", "data": [{ "id": 1, "body": "inline rows" }] },
    { "connection": "api", "url": "https://data.example.com/v1/" },
    { "link": "data/exchange_rates.csv", "table": "exchange_rates", "format": "csv", "options": { "header": true } }
  ],
  "queries": [{ "title": "Revenue", "sql": "SELECT …" }],
  "open": ["orders"]
}
```

- Paths are relative to the manifest. `import` copies rows into a table (a missing table is created with inferred
  types). `link` creates an external table that reads the source at query time. The source must be reachable from
  the browser: the same origin, or a server that allows CORS.
- `storage: "memory"` rebuilds the database on every visit. With `"opfs"`, `init: "once"` (the default) builds it on
  the first visit and keeps the visitor's changes after that. `"always"` rebuilds it on every visit.
- `envs/index.json` lists the environments shown in the Import tab.
- **⋯ → Export database as environment** writes a manifest of the open database: its schema, the rows of local
  tables, external tables and connections by reference (never credentials), and your query tabs. **⋯ → Export as SQL
  dump** writes plain SQL.

`envs/demo/` is a small tea-and-coffee shop with sample data. It has tables, indexes, a view, a materialized view,
a linked CSV and saved queries. The welcome tab opens it.

## Layout

```
index.html            page shell
app/main.js           application: tabs, explorer, query runner, table viewer, import, history
app/editor.js         SQL editor (highlight overlay, completion, shortcuts)
app/grid.js           virtualized data grid
app/sql.js            tokenizer, statement splitter, parameter scanner, formatter
app/engine.js         engine loading (vendor / npm / URL) and the OPFS database catalog
app/env.js            environment manifests: load, export, SQL dump
app/store.js          localStorage prefs/history, IndexedDB file handles
vendor/smaltdb/       vendored engine build
envs/                 environments served with the page
scripts/              vendor, build and serve scripts
test/e2e.mjs          end-to-end test in headless Chromium (npm test)
```

From the browser console, `smaltui.db` is the open smaltdb `Database`.

## License

MIT
