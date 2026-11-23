---
description: 'Five minutes with smaltui: open the demo, run a query, and run SQL right on this page.'
---

# Quick start

smaltui is a query workbench for smaltdb that runs entirely in the browser. There is nothing to install.

## 1. Open the demo

Open **Demo**, in the top nav. It builds a small tea-and-coffee shop in your
browser: tables of products, customers and orders, a view, a linked CSV and saved queries. The tables are in the
explorer on the left.

## 2. Run a query

Click the **Revenue by category** tab, put the cursor in the first statement and press <kbd>Ctrl</kbd>+<kbd>Enter</kbd>
(<kbd>⌘</kbd>+<kbd>Enter</kbd> on a Mac). The result opens under the editor. <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd>
runs every statement in the tab.

## 3. Try it here

This example runs on this page: press **Run**, change the query, and run it again. **Open in smaltui** opens it in a
query tab of the workbench.

```sql
CREATE TABLE fruit (name TEXT PRIMARY KEY, price REAL);
INSERT INTO fruit VALUES ('apple', 1.2), ('pear', 0.8), ('plum', 2.5);
SELECT name, price FROM fruit WHERE price > 1 ORDER BY price DESC;
```

| name | price |
| --- | --- |
| plum | 2.5 |
| apple | 1.2 |

Next: [Getting started](./) and [Query tabs](./queries). Beside SQL, the workbench queries in
[TypeScript with smaltdf](./typescript) and in [Cypher with smaltcy](./cypher).
