# CLAUDE.md

smaltui is a static, in-browser SQL workbench for [smaltdb](https://github.com/stenhoor/smaltdb), plus a landing page
with a live console. Several Claude Code sessions work on the smalt repos in parallel and cannot see each other: this
file is the shared starting point. smaltdb has the matching file (stenhoor/smaltdb#30); keep the working rules the same.

## Commands

```bash
npm install            # postinstall copies smaltdb and smaltkit into vendor/ and compiles the TypeScript
npm run dev            # serve and recompile on change
npm run typecheck      # tsc --noEmit, strict (CI runs it)
npm run serve          # compile once, then the workbench, http://localhost:8080 (COOP/COEP on; --no-isolation to drop it,
                       # --gzip to compress like GitHub Pages)
npm run preview        # build, then serve dist/ (landing page at /, workbench at /workbench/), as deployed
npm run build          # assemble the site in dist/
npm test               # test/e2e.mjs in headless Chromium (needs Playwright, see below)
node test/smoke.mjs <url>   # check a deployed site; the Pages workflow runs it after each deploy
npm run vendor -- --from ../smaltdb   # try an unreleased smaltdb from a local checkout
npm run vendor         # back to the npm package
npm run brand:sync -- --ref <commit>   # update brand/ from stenhoor/smalt-brand (CI: node scripts/sync-brand.mjs --check)
```

Playwright is not a project dependency. CI installs it before `npm test`:

```bash
npm install --no-save playwright && npx playwright install --with-deps chromium
```

## Repo map

- `app/` is the workbench, `site/` the landing page, `envs/` the environments (demo data and manifests).
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

- **smaltdb:** smaltui depends on the npm package at `^0.8.3`. smaltdb is moving optional code out of its core into
  plugins ([ADR 0012](https://github.com/stenhoor/smaltdb/blob/main/docs/adr/0012-plugins.md)): external tables,
  CSV/JSON import and the Parquet reader, all of which smaltui uses. Upgrade deliberately, in its own PR, and run
  `npm test`.
- **smalt-brand:** logos, badges, colours, type and voice come from
  [stenhoor/smalt-brand](https://github.com/stenhoor/smalt-brand/blob/main/BRAND.md). Change assets there and sync
  `brand/`. Build colours from its tokens (`--primary`, `--text-2`, `--syn-*`, …), never hand-picked hex values, and
  follow its voice: say what smaltui is, never what it isn't.
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
