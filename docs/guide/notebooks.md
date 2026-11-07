# Notebooks

A notebook (**✎ Notebook** in the workbench) is a page of cells that run top to bottom against the open database.
[Open the demo notebook](/workbench/?env=envs/demo/env.json&nb=Shop%20analysis){target="_self"}.

## Cells

- **SQL cells** run in [smaltql](https://stenhoor.github.io/smaltql/), with the query editor's highlighting and
  completion. The last statement that returns rows is shown (its first 1,000 rows).
- **Dataframe cells** use [smaltdf](https://github.com/stenhoor/smaltdf), the Polars expression API compiled to SQL and
  run by smaltdb. `pl`, `col`, `lit`, `when`, `len`, `sum`, `mean`, … are in scope. A cell is JavaScript: its value is
  its last expression, or what it `return`s.

Each cell's result is `_1`, `_2`, … for the cells below it (`_` is the one just above). A SQL cell's result is a
LazyFrame over its query, so a dataframe cell builds on it, in the engine:

```sql
-- [1]
SELECT category, product, quantity, amount, status FROM order_lines WHERE status <> 'cancelled';
```

```js
// [2]
_1.groupBy('category')
  .agg(col('amount').sum().round(2).alias('revenue'), len().alias('lines'))
  .sort('revenue', { descending: true })
```

```js
// [3] frames from JavaScript data join frames from the database
const targets = pl.DataFrame({ category: ['Coffee', 'Tea', 'Gear', 'Snacks'], target: [4000, 4000, 12000, 1500] });
return _2.join(targets, { on: 'category' });
```

`await _2.explain()` shows the one SQL statement a frame runs. LazyFrames and DataFrames show as grids, other values
as text.

## Running

<kbd>Ctrl</kbd>+<kbd>Enter</kbd> runs a cell, <kbd>Shift</kbd>+<kbd>Enter</kbd> runs it and moves on, **Run all** runs
every cell. An error stops the run and shows on its cell.

## Saving and sharing

- Notebooks are kept with the open tabs in this browser.
- **Save file** writes a `.smaltnb.json` file; **⋯ → Open notebook file** opens one.
- [Environment manifests](./environments) carry notebooks in `"notebooks"`, and **Export** includes the open ones.
- `?nb=<title>` opens one of the environment's notebooks and runs it.

Dataframe cells run JavaScript in the page, like the browser console, and only when you press Run: open notebook files
from people you trust. Notebooks in TypeScript, with charts, are what [smaltnb](https://stenhoor.github.io/smaltnb/),
the family's notebook product, is for.
