# TypeScript tabs (smaltdf)

Beside its SQL tabs, the workbench has TypeScript tabs (**ƒ TypeScript**): an editor for
[smaltdf](https://stenhoor.github.io/smaltdf/), smaltdb's dataframe language. Frames and expressions build plans that
run in the same engine as SQL, on the same database. The **Demo** has one: its **Frames (smaltdf)** tab.

```ts
const lines = table('orders')
  .filter(col('status').ne('cancelled'))
  .join(table('products'), { leftOn: 'product_id', rightOn: 'id' })
  .withColumns(col('quantity').mul(col('price')).alias('amount'));

show(lines.groupBy('category').agg(col('amount').sum().alias('revenue'), len()), 'By category');

lines.sort('amount', { descending: true }).head(10)
```

## Running

<kbd>Ctrl</kbd>+<kbd>Enter</kbd> runs the whole tab. Its results:

- **The last expression**, and every value passed to `show(value, title?)`. Frames are collected and shown as grids,
  writes (`update`, `deleteFrom`, `insertInto`, `createTable`) report their row count, arrays of objects show as
  grids and other values as text.
- **Plan:** the plan the last frame ran as. smaltdf builds plans for the engine's plan layer; it doesn't write SQL.
- **Messages:** how long it took, or the error.

smaltdf's functions (`table`, `col`, `lit`, `len`, `concat`, `update`, …) are in scope, with `db`, the open database.
`import { … } from '@smaltdb/df'` works too, so code can be copied to and from a project. The code is TypeScript:
its types are removed before it runs, not checked, by the `@smaltworks/smaltdb-sucrase` plugin (sucrase). It comes
with the workbench and loads the first time a tab runs, so tabs work offline. A syntax error names its line and column.

The editor highlights TypeScript and completes smaltdf's functions, the methods after a `.`, table names in
`table('…')` and column names in `col('…')` (<kbd>Ctrl</kbd>+<kbd>Space</kbd>).

## Keeping and sharing

TypeScript tabs are kept with the other tabs in this browser. **Save** writes a `.ts` file; **Open…** reads one.
[Environment manifests](./environments) carry them as saved queries with `"lang": "ts"`, and **Export** includes them.

The code runs in the page, like the browser console, and only when you press Run.
