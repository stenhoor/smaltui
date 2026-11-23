---
description: 'Open the workbench, choose a database, and find your way around: the explorer, the tabs and the menus.'
---

# Getting started

smaltui is a static site. Open it, and the engine starts in your browser: smaltdb, with
[smaltql](https://stenhoor.github.io/smaltql/) for SQL, in a Web Worker. Your databases live in this browser, and the
page fetches only the files and URLs you import or link.

**Demo**, in the top nav, opens the workbench on a small tea-and-coffee shop, built from an
[environment](./environments): tables, a view, a materialized view, a linked CSV, sales from a Parquet file, saved
queries in SQL, TypeScript and Cypher, and a sample graph. Opened at `workbench/` with no
[parameters](../reference/urls), the workbench opens the database you used last, or one called `scratch`.

## Around the workbench

- **The database menu** (top left) opens, creates and deletes databases. A database is kept in the browser's private
  storage (OPFS) or in memory: [Databases and storage](./databases).
- **The explorer** (left) lists tables, views, materialized views, external tables and connections, and the graph's
  labels and relationship types: [Explorer and tables](./explorer).
- **The header** opens tabs: **Query** (SQL, [Query tabs](./queries)), **TypeScript** ([TypeScript tabs](./typescript)),
  **Cypher** ([Cypher tabs](./cypher)), **Import** ([Import and link](./import)) and **History**.
- **⋯** exports the database as an [environment](./environments) or a SQL dump, loads an environment, loads or exports
  the graph, chooses the engine, switches between light and dark, and lists the
  [keyboard shortcuts](../reference/shortcuts).

Tabs are kept in the browser, so they come back when the page opens again. From the browser's console, `smaltui.db` is
the open smaltdb database.

## A first table

In a query tab, create a table, add rows and query them. Each statement runs with <kbd>Ctrl</kbd>+<kbd>Enter</kbd>
when the cursor is in it, or all of them with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd>:

```sql
CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL, created TEXT DEFAULT (date('now')));
INSERT INTO notes (body) VALUES ('Buy tea'), ('Call Ada');
SELECT id, body FROM notes ORDER BY id;
```

| id | body |
| --- | --- |
| 1 | Buy tea |
| 2 | Call Ada |

The new table appears in the explorer. Double-click it to browse and edit its rows.

## Run it yourself

smaltui is a folder of static files. To build it from source and serve it:

```bash
git clone https://github.com/stenhoor/smaltui && cd smaltui
npm ci && npm run deps   # build smaltdb, smaltql and the plugins (pinned commits) into vendor/
npm run dev              # http://localhost:8080, recompiling on change
```

[Engine and deploy](./engine) covers the engine build and hosting.
