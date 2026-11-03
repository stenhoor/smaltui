# CLAUDE.md

smaltui is a static, in-browser SQL workbench for [smaltdb](https://github.com/stenhoor/smaltdb), plus a landing page
with a live console. Several Claude Code sessions work on the smalt repos in parallel and cannot see each other: this
file is the shared starting point. smaltdb has the matching file (stenhoor/smaltdb#30); keep the working rules the same.

## Commands

```bash
npm install            # postinstall copies the smaltdb engine from node_modules into vendor/smaltdb/
npm run serve          # the workbench from source, http://localhost:8080 (COOP/COEP on; --no-isolation to drop it)
npm run preview        # build, then serve dist/ (landing page at /, workbench at /workbench/), as deployed
npm run build          # assemble the site in dist/
npm test               # test/e2e.mjs in headless Chromium (needs Playwright, see below)
npm run vendor -- --from ../smaltdb   # try an unreleased smaltdb from a local checkout
npm run vendor         # back to the npm package
```

Playwright is not a project dependency. CI installs it before `npm test`:

```bash
npm install --no-save playwright && npx playwright install --with-deps chromium
```

## Repo map

- `app/` is the workbench, `site/` the landing page, `envs/` the environments (demo data and manifests).
- `scripts/` holds the vendor, build and serve scripts; `test/e2e.mjs` is the whole test suite.
- `vendor/` and `dist/` are generated: do not edit or commit them.
- For details, read the [Layout](README.md#layout), [Environments](README.md#environments) and
  [Deploy](README.md#deploy) sections of the README instead of copying them here.

## Working rules for sessions

- One task per branch and PR. Do not add unrelated work to an open PR: it holds up everything else in it.
- Mark unfinished work clearly, and open a PR only when CI passes.
- Read review comments on your PR and answer them with commits that say what they address.
- When a PR depends on another repo's PR, add a line such as `Depends on: stenhoor/smalt-brand#2`.

## Cross-repo impact

- **smaltdb:** smaltui depends on the npm package at `^0.8.3`. smaltdb is moving optional code out of its core into
  plugins ([ADR 0012](https://github.com/stenhoor/smaltdb/blob/main/docs/adr/0012-plugins.md)): external tables,
  CSV/JSON import and the Parquet reader, all of which smaltui uses. Upgrade deliberately, in its own PR, and run
  `npm test`.
- **smalt-brand:** logos, badges, colours and voice come from
  [stenhoor/smalt-brand](https://github.com/stenhoor/smalt-brand/blob/main/BRAND.md). Use it as the source rather
  than editing copies by hand.
- **smaltkit:** shared code is planned to move to a `smaltkit` repository, later including the SQL editor and the
  virtualized grid ([smaltbi ADR 0005](https://github.com/stenhoor/smaltbi/blob/main/docs/adr/0005-smaltkit-and-smalt-brand.md)).
  Flag large changes to `app/editor.js` or `app/grid.js`.
- **Deploys:** merging to `main` redeploys https://stenhoor.github.io/smaltui/, so check the site afterwards. A green
  "Deploy to GitHub Pages" run does not prove the site works. If Pages is also set to publish from a branch, GitHub's
  own `pages-build-deployment` run can finish last and replace the built site with the raw repo; this took the smaltbi
  site down (stenhoor/smaltbi#6). The Pages source must be "GitHub Actions".
