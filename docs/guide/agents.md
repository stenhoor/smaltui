---
description: 'For AI agents that work with smaltui: how to open it on data, what each kind of tab runs, its rules, and where the complete agent guide is.'
---

# For AI agents

This page is written for AI agents that set up or use smaltui, and it opens the agent guide. The site publishes
Markdown made for agents beside its pages:

- [`/agents.md`](https://stenhoor.github.io/smaltui/agents.md): this page, then the reference and the guide's pages on
  queries, TypeScript, Cypher, import, environments and databases, in one file. Every example in it is tested, with
  its result.
- [`/llms.txt`](https://stenhoor.github.io/smaltui/llms.txt): an index of every page, each as Markdown.
- Any page as Markdown: its address with `.md`, such as
  [`guide/queries.md`](https://stenhoor.github.io/smaltui/guide/queries.md).

## What smaltui is

smaltui is a query workbench for smaltdb, a static site that runs entirely in the browser. The engine is smaltdb 0.9
in a Web Worker, with SQL from smaltql and the `@smaltdb/io`, `@smaltdb/external` and `@smaltdb/parquet` plugins. Its
tabs query one database in three languages:

| Tab | Language | Its documentation for agents |
| --- | --- | --- |
| Query | SQL, smaltql's dialect of SQLite's | [smaltql](https://stenhoor.github.io/smaltql/) |
| TypeScript | smaltdf, dataframes that build plans for the engine | [smaltdf](https://stenhoor.github.io/smaltdf/) |
| Cypher | Cypher on smaltcy's graph, beside the database | [smaltcy agents.md](https://stenhoor.github.io/smaltcy/agents.md) |

Write each language's code by its own documentation; this guide covers what the workbench adds.

## How to give someone a workspace

There is no server and no account: a workspace is a URL.

1. Write an [environment manifest](../reference/environment) (JSON): the database's name and storage, steps that
   create tables and import or link data, saved queries for each kind of tab, tables to open and the graph.
2. Serve it, with its data files, from the same origin as smaltui or from a host that allows CORS.
3. Link to `workbench/?env=<manifest URL>`. Paths in the manifest are relative to it.

A single query needs no manifest: `workbench/?sql=<encodeURIComponent(sql)>` opens it in a query tab and runs it on the
database used last. The [URL parameters](../reference/urls) list the rest.

## What each tab runs

- **SQL:** **Run** runs the statement at the cursor; **Script** runs every statement, in order, and stops at the first
  error. Each statement that returns rows gets a result. Parameters (`?`, `:name`) ask the person for values.
- **TypeScript:** the whole tab runs. smaltdf's functions (`table`, `col`, `lit`, `len`, `update`, …), `db` (the open
  database) and `show(value, title?)` are in scope; `import { … } from '@smaltdb/df'` works too. The last
  expression is the result: a frame is collected into a grid, a write reports its row count, an array of objects is a
  grid, anything else is text. Types are removed, never compiled: `enum`, `namespace` with values, parameter
  properties and `<T>x` casts are refused.
- **Cypher:** statements end with `;`. **Run** runs the one at the cursor, **Script** all of them. The graph is in
  memory, separate from the SQL database: it starts empty unless a manifest's `graph` or the person loads one.

## Rules

- **Everything stays in the browser.** Databases are in the browser's private storage (OPFS) or in memory; the page
  fetches only the files and URLs it is given. `storage: "memory"` is rebuilt on every visit.
- **A source must allow the browser.** Files from another site need CORS. Links copied from GitHub and Hugging Face
  are rewritten to their raw-file URLs.
- **Exports carry no secrets.** An exported environment names external tables and connections by reference, never
  with their credentials; auth headers are kept in memory only.
- **Errors carry codes.** SQL errors carry smaltdb's and smaltql's codes (such as `SMALT_SYNTAX`), listed on
  [smaltdb.dev](https://smaltdb.dev); Cypher errors carry smaltcy's (`SMALTCY_SYNTAX`, …). Branch on the code, not
  the message.
- **From the browser's console**, `smaltui.db` is the open smaltdb `Database`: `await smaltui.db.query('SELECT 1')`.

## Not supported

- **No server-side database.** smaltui opens databases in the browser only; to query a remote file, link it as an
  external table.
- **No notebooks.** Tabs are editors with results; notebooks are [smaltnb](https://github.com/stenhoor/smaltnb)'s.
- **The graph isn't stored.** It lasts until the page closes. Save it with **⋯ → Export graph as JSON** and load it
  with a manifest's `"graph": { "url": … }`.
- **Linking Parquet from a host that compresses responses** (GitHub Pages) fails with `footer != PAR1`
  ([smaltdb#32](https://github.com/stenhoor/smaltdb/issues/32)). Import the file instead.
