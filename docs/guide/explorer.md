---
description: 'The object explorer and the table viewer: browse, script, export and edit tables, views, external tables and the graph.'
---

# Explorer and tables

## The explorer

The explorer, on the left, lists what the open database holds, in groups: **Tables**, **Views**, **Materialized
views**, **External tables**, **Temporary tables** and **Connections**, then the workbench's **Graph**. The filter box
at the top finds objects and columns by name.

- **▸** beside a table lists its columns, with their types and the primary key (⚿). Click a column to insert its name
  into the query tab.
- **Click** an object to open its data in the table viewer. **Double-click** inserts its name into the query tab.
- **Right-click** an object for more: open its data, query it in a new tab, script `SELECT` with its columns, `INSERT`
  and `UPDATE` (tables), or its `CREATE` statement, count its rows, refresh a materialized view, export it as CSV or
  JSON, or drop it.
- **Graph** lists the [graph](./cypher)'s labels and relationship types with their counts. Click one to open a Cypher
  tab on its nodes or relationships. **Sample…**, **Open…** and **Export** load and save the graph.

↻ reads the database's catalog again, after another tab or a script changed it.

## The table viewer

A table's tab shows its data, paged, with views beside it:

- **Data:** a page of rows at a time (50 to 5,000, ◀ ▶ to move). Click a header to sort by it (in the engine, over
  the whole table). The `WHERE …` box filters with any SQL condition, such as `price > 5 AND category = 'Tea'`.
  **SQL** opens the query behind the view in a query tab.
- **Columns**, **Indexes**, **Constraints** and **DDL**, the statement that creates it, highlighted.
- **Source**, for an external table: where it reads from, and how.
- **Refresh**, for a materialized view: when it was refreshed, and **Refresh** to do it now.

In a table with a primary key you can edit its rows:

- Double-click a cell, or press <kbd>Enter</kbd>, to edit it; <kbd>Enter</kbd> saves and <kbd>Esc</kbd> cancels.
  <kbd>Ctrl</kbd>+<kbd>Delete</kbd> while editing sets it to NULL.
- **＋ Row** inserts a row, and **− Row** deletes the selected one, after asking.

Each change is one `UPDATE`, `INSERT` or `DELETE` statement on that row, found by its primary key.
