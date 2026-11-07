# Engine and deploy

## The engine

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

and `vendor/smaltdf/smaltdf.js`, smaltdf (`@smaltdb/df`) for notebook cells, loaded on first use.

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
changes it). Any static host works. `npm run preview` builds it and serves it at http://localhost:8080/smaltui/.

```
dist/                                     the product site: docs/, built with VitePress on the smaltworks docs theme
dist/console.html, console.css, demo.js   the live SQL console (from site/), embedded in the home page
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
workbench parameters (`?env=`, `?db=`, `?sql=`, `?nb=`) are forwarded to `/workbench/`.

- **GitHub Pages:** `.github/workflows/pages.yml` deploys on every push to `main`, then runs `test/smoke.mjs`
  against the live site. (Enable Pages with "GitHub Actions" as the source.) GitHub Pages cannot send COOP/COEP
  headers. smaltui works there, but without parallel readers.
- **Netlify / Cloudflare Pages:** `_headers` adds the isolation headers.
