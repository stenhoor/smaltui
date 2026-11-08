<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/logos/smaltui/lockup-on-dark.svg">
    <img alt="smaltui" src="brand/logos/smaltui/lockup.svg" width="280">
  </picture>
</h1>

<a href="https://smaltworks.dev/stability"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/badges/work-in-progress-on-dark.svg">
  <img alt="Work in progress. Come build with us." src="brand/badges/work-in-progress.svg" height="56">
</picture></a>

**Small. Alternative. Query.**

A query workbench for [smaltdb](https://smaltdb.dev) that runs entirely in the browser. smaltui is in the spirit of Toad:
an object explorer, tabbed SQL editors, data grids you can browse and edit, and import tools. It is a **static site**:
the engine runs in a Web Worker in each visitor's browser, and databases are stored in that browser's private storage
(OPFS) or in memory.

<a href="https://smaltdb.dev"><picture><source media="(prefers-color-scheme: dark)" srcset="brand/badges/powered-by-smaltdb-on-dark.svg"><img alt="Powered by smaltdb" src="brand/badges/powered-by-smaltdb.svg" width="172" height="28"></picture></a>

Serve the folder from any static host and you have a live environment. Add `?env=…` and the page builds a ready-made
database (schema, data, linked sources, saved queries) when it opens.

**Live demo:** the site's **Demo** opens the workbench on the demo database:
<https://stenhoor.github.io/smaltui/workbench/?env=envs/demo/env.json>. The site, with the guide, is at
<https://stenhoor.github.io/smaltui/>.

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
- **TypeScript tabs** (**ƒ TypeScript**): an editor for [smaltdf](https://stenhoor.github.io/smaltdf/), smaltdb's
  dataframe language, beside the SQL tabs. `Ctrl+Enter` runs the tab: its last expression and every `show(value)` are
  results (frames as grids, with the plan they ran as). smaltdf's functions and `db` are in scope; types are stripped
  with sucrase. Kept with the tabs, saved as `.ts` files, and carried in manifests as queries with `"lang": "ts"`.
- **Table viewer:** paged data with server-side sorting (click a header) and a free-form `WHERE` filter. Columns,
  indexes, constraints and highlighted DDL. For external tables it shows the source; for materialized views, refresh
  controls. In tables with a primary key you can edit a cell (double-click or `Enter`; `Ctrl+Delete` sets NULL),
  insert rows and delete rows.
- **Import tab:**
  - *Import into a table:* load a file (drop or choose), a URL, or pasted CSV / TSV / JSON / NDJSON, or a Parquet
    file. The preview shows the inferred column types. You can create a new table or append to an existing one.
    (Parquet is copied through a temporary external table and `INSERT … SELECT`.)
  - *Link an external table:* `CREATE EXTERNAL TABLE` over a URL or a local file (CSV, TSV, JSON, NDJSON or
    Parquet; Parquet over HTTP is read with Range requests, only the columns and row groups a query needs), with optional connections, auth
    headers (kept in memory only) and a local materialized-view cache. The SQL is shown and can be edited before it
    runs. Known issue: linking a Parquet file from a host that compresses responses (GitHub Pages, for one) fails
    with `footer != PAR1`, because smaltdb takes the file size from the compressed `Content-Length`
    (stenhoor/smaltdb#32). Import such files instead. On Chromium, local files stay linked across reloads (File System Access handles in IndexedDB). Elsewhere,
    the sidebar asks you to attach them again.
  - *URLs from other sites* must allow cross-origin reads (CORS). Links copied from GitHub (`github.com/…/blob/…`
    or `…/raw/…`, e.g. TidyTuesday datasets) and Hugging Face (`…/blob/…`) are rewritten to their raw-file URLs
    (`raw.githubusercontent.com`, `…/resolve/…`), which do. The note under the field shows the URL used. When a
    source does not allow it, the error explains why and suggests the raw URL where there is one.
  - *Environments:* load a manifest, or export the current database as one.
- **Databases:** open, create or delete OPFS databases, or use in-memory ones (`Ctrl+Shift+O`). The database is
  stored in the URL (`?db=name`, `&storage=memory`), so a link reopens it.
- **History** of every statement run, searchable, per database. **Light and dark** themes. Usable on a phone.

## Run it locally

```bash
npm install          # copies smaltkit into vendor/ and compiles the TypeScript
```

```bash
npm run deps         # builds smaltdb 0.9, smaltql and the plugins pinned in packed.json, bundles vendor/smaltdb/
```

```bash
npm run dev          # http://localhost:8080, recompiling on change
```

smaltui is written in TypeScript (strict). `scripts/compile.mjs` compiles each `app/*.ts` and `site/*.ts` to a `.js`
beside it (esbuild, one file per module, no bundling), and the pages load those files; they are generated and not
committed. `npm run typecheck` runs `tsc`; CI runs it on every push. `npm run serve` compiles once and serves without
watching.

`scripts/serve.mjs` sends COOP/COEP headers, so the page is cross-origin isolated: smaltdb then uses parallel
reader workers and can interrupt running statements. It also answers Range and HEAD requests, which smaltdb uses for
Parquet and for freshness checks. OPFS needs a secure context; `localhost` counts.

## smaltkit

Code shared with [smaltbi](https://github.com/stenhoor/smaltbi) lives in [smaltkit](https://github.com/stenhoor/smaltkit).
Until smaltkit is on npm, `package.json` pins it to a commit (`"smaltkit": "github:stenhoor/smaltkit#<commit>"`); npm
clones that commit and builds it. A postinstall step (`scripts/vendor-smaltkit.mjs`) copies its modules into
`vendor/smaltkit/`, and the pages import them from there (`../vendor/smaltkit/urls.js`), with no bundler; the `.d.ts`
files come along so `tsc` types those imports. To move to a newer smaltkit:

```bash
npm install github:stenhoor/smaltkit#<commit>
```

Once smaltkit is published, the dependency becomes a version range (`"smaltkit": "^0.1.0"`) and nothing else changes.

## The smaltdb engine

smaltdb 0.9 is an engine with no language built in ([smaltdb ADR 0015](https://github.com/stenhoor/smaltdb/blob/main/docs/adr/0015-smaltql.md)):
SQL comes from [smaltql](https://github.com/stenhoor/smaltql), and optional features are plugins
([ADR 0012](https://github.com/stenhoor/smaltdb/blob/main/docs/adr/0012-plugins.md)). smaltui's engine worker is
smaltdb with smaltql and the three plugins it uses: `@smaltdb/io` (CSV, TSV, JSON import, export and `read_csv`),
`@smaltdb/external` (files, URLs, S3 and Azure behind external tables) and `@smaltdb/parquet`.

None of these is on npm yet. `packed.json` pins each to a commit, the way the smaltdb repositories pin each other, and
`npm run deps` builds them:

```bash
npm ci
```

```bash
npm run deps   # build and install the pinned packages, bundle the engine into vendor/smaltdb/, compile
```

`scripts/fetch-packed.mjs` (the same file as in smaltdb and its plugins) checks out each commit, builds it, packs it and
installs the tarballs with `npm install --no-save`, so nothing reaches `package.json` or the lockfile; run it again
after every `npm ci` or `npm install`. `scripts/vendor-smaltdb.mjs` then bundles `vendor/smaltdb/`:

- `smaltdb.js`: the smaltdb client and the plugins' client helpers (`importCSV`, `registerFile`, …);
- `smaltdb-worker.js`: the engine worker (`defineWorker({ languages: [sqlLanguage], plugins: [io, external, parquet] })`);
- `chunks/`: hyparquet-compressors, loaded on first use for compressed Parquet files;
- `VERSION.json` (the pinned commits) and `THIRD_PARTY_NOTICES.txt` (licences of the bundled third-party code).

`vendor/` is generated, not committed. The page loads the engine from there, from the same origin, so it works offline
and under cross-origin isolation.

To move to newer commits, edit `packed.json` and run `npm run deps`. To try a local checkout:

```bash
node scripts/fetch-packed.mjs --local smaltdb=../smaltdb && npm run vendor
```

`?engine=https://host/path/` loads a folder built the same way instead (also in **⋯ → Engine source**, remembered
per browser). npm engines are not offered: npm has only smaltdb 0.8.3, which has SQL built in and the older client
API. When smaltdb 0.9 and its packages are published (as `@smaltworks/…`), the pins become ordinary dependencies.

## Deploy

`npm ci && npm run deps && npm run build` assembles the site in `dist/`, for the `/smaltui/` path (`DOCS_BASE`
changes it). Any static host works. `npm run preview` builds it and serves it at `http://localhost:8080/smaltui/`.

```
dist/                                     the product site: docs/, built with VitePress on the smaltworks docs theme
dist/console.html, console.css, demo.js   the live SQL console (from site/), a page of its own
dist/workbench/                           the workbench: index.html, app/, vendor/, envs/
```

The site is built the way smaltworks.dev and smaltbi's site are: VitePress with smalt-brand's docs theme
(`brand/themes/vitepress/`, synced verbatim), the work-in-progress badge under the hero, and the smaltworks badges in
the footer. `npm run docs:dev` serves it with live reload (without the workbench beside it).

The build stamps every CSS and JS reference of the console and the workbench with a version (`styles.css?v=<hash>`), so
after a deploy browsers fetch the new files instead of reusing cached ones; VitePress hashes its own assets.

The console runs in-browser on the demo environment, using the workbench's own engine loader, editor, grid and
environment modules, and follows the site's light / dark switch. "Open in workbench" links to
`workbench/?env=…&sql=…`. The `sql` parameter opens a query tab and runs it. Links to the site root that carry
workbench parameters (`?env=`, `?db=`, `?sql=`) are forwarded to `/workbench/`.

- **GitHub Pages:** `.github/workflows/pages.yml` deploys on every push to `main`, then runs `test/smoke.mjs`
  against the live site. (Enable Pages with "GitHub Actions" as the source.) GitHub Pages cannot send COOP/COEP
  headers. smaltui works there, but without parallel readers.
- **Netlify / Cloudflare Pages:** `_headers` adds the isolation headers.

## Environments

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
    { "title": "Frames", "lang": "ts", "sql": "table('orders').head(10)" }
  ],
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
a linked CSV, sales data imported from a Parquet file and saved queries. The welcome tab opens it.

## Brand

smaltui uses the smalt brand from [stenhoor/smalt-brand](https://github.com/stenhoor/smalt-brand/blob/main/BRAND.md):
the Chevron mark, the Kiln palette, Geist / Geist Mono / Martian Mono, and the tagline "Small. Alternative. Query."

- `brand/` is a verbatim copy of the files smaltui uses (tokens, smaltui logos, "Powered by" badges), pinned to the
  smalt-brand commit in `brand/VERSION.json`. Don't edit it: change assets in smalt-brand, then
  `npm run brand:sync -- --ref <commit>`. CI runs `node scripts/sync-brand.mjs --check` to keep the copy exact.
- `brand/tokens/tokens.css` loads before `app/styles.css`; the workbench's colours are defined from its tokens (light
  and dark), and SQL highlighting uses the brand's `syn-*` colours. Fonts load from Google Fonts; without them the pages
  fall back to system fonts.
- Projects built on smaltui can show the "Powered by smaltui" badge (`brand/badges/`), linked to this repository.

## Layout

```
index.html            workbench page shell (served at /workbench/ in the built site)
docs/                 the product site (VitePress on the smaltworks docs theme): home page and guide
site/                 the live console page (console.html, demo.ts), a page of its own
app/main.ts           application: tabs, explorer, query runner, table viewer, import, history
app/editor.ts         code editor (highlight overlay, completion, shortcuts): SQL, and TypeScript for smaltdf tabs
app/grid.ts           virtualized data grid
app/sql.ts            tokenizer, statement splitter, parameter scanner, formatter
app/ts.ts             TypeScript tokenizer, highlighting and last-expression split (TypeScript tabs)
app/engine.ts         smaltui's engine settings for smaltkit's loader, and the plugins' client helpers
app/env.ts            environment manifests: types, load, export, SQL dump
app/store.ts          localStorage prefs/history, IndexedDB file handles
app/globals.d.ts      File System Access API declarations missing from TypeScript's DOM library
site/demo.ts          the live console
(app|site)/*.js       compiled output (npm run compile; not committed)
vendor/smaltdb/       engine: smaltdb, smaltql, smaltdf's language and plugins, bundled by npm run deps (not committed)
vendor/smaltdf/       smaltdf and sucrase for TypeScript tabs, bundled by npm run deps (not committed)
vendor/smaltkit/      shared modules (engine loader and OPFS catalog, data-URL rewriting, CORS hints), copied from node_modules/smaltkit on install (not committed)
envs/                 environments served with the page
brand/                smalt-brand assets, pinned copy (npm run brand:sync; don't edit)
scripts/              compile (TypeScript → .js), fetch-packed (pinned packages), vendor (→ vendor/), brand sync, build, serve
test/e2e.mjs          end-to-end test in headless Chromium (npm test)
test/smoke.mjs        post-deploy check of a live site
```

From the browser console, `smaltui.db` is the open smaltdb `Database`.

## License

MIT

---

<a href="https://smaltworks.dev"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/badges/a-smaltworks-project-on-dark.svg">
  <img alt="A smaltworks project" src="brand/badges/a-smaltworks-project.svg" height="28">
</picture></a>
