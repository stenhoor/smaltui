# CLAUDE.md

smaltui is a static, in-browser query workbench for [smaltdb](https://github.com/stenhoor/smaltdb), plus a product site
whose Demo opens it on sample data. Several Claude Code sessions work on the smalt repos in parallel and cannot see each other: this
file is the shared starting point. smaltdb has the matching file (stenhoor/smaltdb#30); keep the working rules the same.

## Brand: read smalt-brand first

Before changing this repository's site, README, or how it describes the product, read smalt-brand's
[BRAND.md](https://github.com/stenhoor/smalt-brand/blob/main/BRAND.md) (the family table, and "Sites and READMEs", the
standard every product site and README follows) and
[DECISIONS.md](https://github.com/stenhoor/smalt-brand/blob/main/DECISIONS.md). A newer decision there wins over any
copy here: lines and roles change, and a copy taken before the change is out of date.

- Copy brand files and the site kit (`themes/vitepress/`) unchanged. To change them, change smalt-brand first, then
  copy them again.
- A change to this product's status or to what it does comes with a smalt-brand PR that updates smaltworks.dev (its
  status page and this product's page), linked with `Depends on:`.

## Commands

```bash
npm install            # postinstall copies smaltkit into vendor/ and compiles the TypeScript
npm run deps           # build smaltdb 0.9, smaltql and the plugins pinned in packed.json; bundle vendor/smaltdb/
                       # (not on npm yet: run it after every npm ci / npm install)
npm run dev            # serve and recompile on change
npm run typecheck      # tsc --noEmit, strict (CI runs it)
npm run serve          # compile once, then the workbench, http://localhost:8080 (COOP/COEP on; --no-isolation to drop it,
                       # --gzip to compress like GitHub Pages)
npm run preview        # build, then serve it at /smaltui/ (site, console.html, workbench/), as deployed
npm run docs:dev       # the site (docs/) with live reload
npm run build          # assemble the site in dist/
npm test               # test/e2e.mjs in headless Chromium (needs Playwright, see below)
node test/smoke.mjs <url>   # check a deployed site; the Pages workflow runs it after each deploy
node scripts/fetch-packed.mjs --local smaltdb=../smaltdb && npm run vendor   # try a local smaltdb checkout
npm run brand:sync -- --ref <commit>   # update brand/ from stenhoor/smalt-brand (CI: node scripts/sync-brand.mjs --check)
```

Playwright is not a project dependency. CI installs it before `npm test`:

```bash
npm install --no-save playwright && npx playwright install --with-deps chromium
```

## Repo map

- `app/` is the workbench, `docs/` the product site (VitePress on smalt-brand's docs theme, like smaltworks.dev and
  smaltbi), `site/` the standalone live console page, `envs/` the environments (demo data and manifests).
- Sources are TypeScript (strict): edit `app/*.ts` and `site/*.ts`. `scripts/compile.mjs` writes a `.js` beside each one
  (gitignored), which the pages load. Keep imports as `./name.js` (they resolve to the `.ts` when type checking).
- `scripts/` holds the vendor, build and serve scripts. `test/e2e.mjs` is the test suite (`npm test`); it also runs
  `test/smoke.mjs`, the post-deploy check, against a local server that compresses like Pages.
- `vendor/`, `dist/` and the compiled `app/*.js` / `site/*.js` are generated: do not edit or commit them.
- `brand/` is a pinned, verbatim copy of smalt-brand assets (committed; CI checks it): never edit it by hand.
- For details, read the [Layout](README.md#layout), [Environments](README.md#environments) and
  [Deploy](README.md#deploy) sections of the README instead of copying them here.

## Working rules for sessions

- One task per branch and PR. Do not add unrelated work to an open PR: it holds up everything else in it.
- Mark unfinished work clearly, and open a PR only when CI passes.
- Read review comments on your PR and answer them with commits that say what they address.
- When a PR depends on another repo's PR, add a line such as `Depends on: stenhoor/smalt-brand#2`.

## Cross-repo impact

- **smaltdb and smaltql:** smaltui runs smaltdb 0.9, which has no language built in: SQL is
  [smaltql](https://github.com/stenhoor/smaltql) ([smaltdb ADR 0015](https://github.com/stenhoor/smaltdb/blob/main/docs/adr/0015-smaltql.md)),
  and external tables, CSV/JSON import and Parquet are plugins
  ([ADR 0012](https://github.com/stenhoor/smaltdb/blob/main/docs/adr/0012-plugins.md)). None is on npm yet:
  `packed.json` pins smaltdb, smaltql, `@smaltdb/io`, `@smaltdb/external` and `@smaltdb/parquet` to commits (keep
  them a set that smaltdb's own `packed.json` has tested), and `scripts/vendor-smaltdb.mjs` builds the worker that
  registers them. It also pins smaltdf (`@smaltdb/df`), the dataframe language for TypeScript tabs: smaltdf builds
  plans for the engine's plan layer (never SQL), the worker registers its language (`dfLanguage`, for its views), and
  `vendor/smaltdf/` holds smaltdf for the tab. The tab strips types with a plugin,
  [`@smaltworks/smaltdb-sucrase`](https://github.com/stenhoor/smaltdb-sucrase) (sucrase), pinned in `packed.json` and
  bundled with its notices into `vendor/smaltdb-sucrase/`: outside code a feature needs goes in a plugin, never in core,
  and nothing is loaded from a CDN (smalt-brand DECISIONS.md, "Outside code: ask first, and plugins carry it").
  smaltdb's pin follows smaltdf's. Move the pins deliberately, in their own PR, and run `npm test`.
- **smalt-brand:** logos, badges, colours, type and voice come from
  [stenhoor/smalt-brand](https://github.com/stenhoor/smalt-brand/blob/main/BRAND.md). Change assets there and sync
  `brand/`. Build colours from its tokens (`--primary`, `--text-2`, `--syn-*`, …), never hand-picked hex values, and
  follow its voice: say what smaltui is, never what it isn't.
- **smaltnb:** notebooks are [smaltnb](https://github.com/stenhoor/smaltnb)'s. smaltui is not a notebook: it has
  editor tabs for SQL (smaltql) and TypeScript (smaltdf), and its editor and grid are planned to move to smaltkit for
  smaltnb to use (smaltnb DESIGN.md, decisions 20-22).
- **smaltkit:** code shared with smaltbi lives in [stenhoor/smaltkit](https://github.com/stenhoor/smaltkit), pinned
  to a commit in package.json (`github:stenhoor/smaltkit#<commit>`) until it is on npm, and imported from
  `vendor/smaltkit/` (see [smaltkit](README.md#smaltkit)). Change shared code there, then bump the pin here in its own
  PR. The SQL editor and the virtualized grid are planned to move next
  ([smaltbi ADR 0005](https://github.com/stenhoor/smaltbi/blob/main/docs/adr/0005-smaltkit-and-smalt-brand.md)): flag
  large changes to `app/editor.ts` or `app/grid.ts`.
- **Deploys:** merging to `main` redeploys https://stenhoor.github.io/smaltui/, so check the site afterwards. A green
  "Deploy to GitHub Pages" run does not prove the site works. If Pages is also set to publish from a branch, GitHub's
  own `pages-build-deployment` run can finish last and replace the built site with the raw repo; this took the smaltbi
  site down (stenhoor/smaltbi#6). The Pages source must be "GitHub Actions".
