# Getting started

smaltui is a static site: open it, and the engine starts in your browser.

- **[The workbench](/workbench/){target="_self"}** opens a database stored in this browser (OPFS), or in memory.
  The database menu at the top left opens, creates and deletes databases.
- **[The demo](/workbench/?env=envs/demo/env.json){target="_self"}** builds a small tea-and-coffee shop from an
  [environment](./environments): tables, a view, a materialized view, a linked CSV, sales from a Parquet file, saved
  queries.

## The workbench

- **Object explorer:** tables, views, materialized views, external tables and connections, with their columns and
  primary keys. Right-click an object to script SELECT, INSERT or DDL, count rows, export, refresh or drop it.
- **Query tabs:** highlighting, completion of keywords, functions, tables, columns and aliases (<kbd>Ctrl</kbd>+<kbd>Space</kbd>),
  comment toggling and a formatter. Tabs are kept in the browser.
  - <kbd>Ctrl</kbd>+<kbd>Enter</kbd> runs the statement under the cursor (it is shaded) or the selection;
    <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd> runs the whole script, with one result tab per result set.
  - Bind variables (`?`, `?1`, `:name`, `@name`, `$name`) open a dialog that asks for their values.
  - <kbd>Ctrl</kbd>+<kbd>E</kbd> shows the query plan. Syntax errors mark the failing token. <kbd>Esc</kbd> cancels.
  - Results are fetched 1,000 rows at a time. Export them as CSV, JSON or INSERT statements, or save them as a table.
- **Table viewer:** paged data with sorting and a `WHERE` filter, columns, indexes, constraints and DDL. In tables
  with a primary key, edit cells (double-click), insert and delete rows.
- **[Import and link](./import):** load files into tables, or query them in place as external tables.
- **History**, light and dark themes, and keyboard shortcuts (**⋯ → Keyboard shortcuts**).

From the browser console, `smaltui.db` is the open smaltdb database.

## Run it yourself

```bash
git clone https://github.com/stenhoor/smaltui && cd smaltui
npm ci && npm run deps   # build smaltdb, smaltql and the plugins (pinned commits) into vendor/
npm run dev              # http://localhost:8080, recompiling on change
```

See [Engine and deploy](./engine) for the engine build and hosting.
