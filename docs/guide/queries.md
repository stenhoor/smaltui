---
description: 'Query tabs: SQL (smaltql) with completion, statements run one at a time or as a script, bind variables, query plans, results and export.'
---

# Query tabs (SQL)

A query tab is an editor for SQL, the [smaltql](https://stenhoor.github.io/smaltql/) dialect of SQLite's SQL, with its
results under it. **Query** in the header (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd>) opens one. Tabs are kept in the
browser; double-click a tab to rename it.

## Running SQL

- **Run** (<kbd>Ctrl</kbd>+<kbd>Enter</kbd>) runs the statement under the cursor, which is shaded, or the selection.
- **Script** (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd> or <kbd>F5</kbd>) runs every statement in the tab, in order.
  Each statement that returns rows gets a result tab. A failing statement stops the script unless **continue script
  on error** is ticked.
- **Stop** (<kbd>Esc</kbd>) cancels the running statement.
- A syntax error marks the token where it is, and the message says what was expected.

```sql
CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT, price REAL);
INSERT INTO products (name, category, price) VALUES
  ('Assam', 'Tea', 6.5), ('Darjeeling', 'Tea', 9.0), ('Sencha', 'Tea', 7.25),
  ('Espresso', 'Coffee', 8.0), ('Mocha', 'Coffee', 11.0);
SELECT category, count(*) AS products, round(avg(price), 2) AS average_price
FROM products
GROUP BY category
ORDER BY category;
```

| category | products | average_price |
| --- | --- | --- |
| Coffee | 2 | 9.5 |
| Tea | 3 | 7.58 |

Window functions, common table expressions, views and the rest of smaltql's SQL run as written:

```sql
SELECT name, category, price,
       rank() OVER (PARTITION BY category ORDER BY price DESC) AS rank_in_category
FROM products
ORDER BY category, rank_in_category;
```

| name | category | price | rank_in_category |
| --- | --- | --- | --- |
| Mocha | Coffee | 11 | 1 |
| Espresso | Coffee | 8 | 2 |
| Darjeeling | Tea | 9 | 1 |
| Sencha | Tea | 7.25 | 2 |
| Assam | Tea | 6.5 | 3 |

<!-- docs:error SMALT_SYNTAX -->
```sql
SELECT name FROM products WHERE;
```

The [SQL reference](https://stenhoor.github.io/smaltql/reference/sql/) and the
[functions](https://stenhoor.github.io/smaltql/reference/functions/) are on smaltql's site.

## Editing

- **Completion** (<kbd>Ctrl</kbd>+<kbd>Space</kbd>, or as you type) offers keywords, functions, tables, columns, and the
  columns of a table through its alias (`o.` after `FROM orders o`).
- **Format** (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd>) puts clauses on lines of their own; with a selection, only
  the selection. <kbd>Ctrl</kbd>+<kbd>/</kbd> toggles line comments; <kbd>Tab</kbd> and <kbd>Shift</kbd>+<kbd>Tab</kbd>
  indent and outdent.
- **Open…** and **Save** (<kbd>Ctrl</kbd>+<kbd>S</kbd>) read and write `.sql` files.

## Bind variables

A statement with parameters (`?`, `?1`, `:name`, `@name` or `$name`) opens a dialog that asks for their values, and
remembers them for the tab. Each value has a type: `auto` (a number when it reads as one, else text; empty is NULL),
`text`, `integer`, `real` or `null`.

## Plans

- **Explain** (<kbd>Ctrl</kbd>+<kbd>E</kbd>) shows the statement's query plan as a tree (**Plan**), without running it.
- **Analyze** runs it and shows the plan with the rows each step estimated and produced (`EXPLAIN ANALYZE`).
- **Plan data** is the plan smaltql binds the statement to: the JSON smaltdb runs.
- **Graph** draws the plan data and the engine's plan as trees, with Analyze's numbers on the engine's.

## Results

Each result set is a grid. The first 1,000 rows come first; **Fetch more** and **Fetch all** get the rest. Grids are
virtualized, so large results scroll smoothly.

- Click a header to sort what was fetched. Double-click a cell, or press <kbd>Enter</kbd>, to see the whole value
  (JSON is laid out).
- <kbd>Ctrl</kbd>+<kbd>C</kbd> copies a cell, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> its row.
- **CSV**, **JSON** and **SQL** (`INSERT` statements) save the fetched rows as a file; **Copy** copies them as
  tab-separated text, ready to paste into a spreadsheet. **Save as table…** creates a table from them.
- **Messages** lists what each statement did, how long it took, and any error.

Every statement you run is in **History**, searchable, for this database or all of them.
