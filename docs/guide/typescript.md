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

The toolbar is a SQL tab's: **Run**, **Explain**, **Analyze**, **Stop**, then **Format**, **Open…** and **Save**, with
the same keys.

- **Run** (<kbd>Ctrl</kbd>+<kbd>Enter</kbd>) runs the whole tab. Its last expression, and every value passed to
  `show(value, title?)`, is a result: frames are collected and shown as grids, writes (`update`, `deleteFrom`,
  `insertInto`, `createTable`) report their row count, arrays of objects show as grids and other values as text.
- **Explain** (<kbd>Ctrl</kbd>+<kbd>E</kbd>) and **Analyze** run the tab's frame (its last expression, or the last
  frame shown) as EXPLAIN or EXPLAIN ANALYZE: **Plan** shows the engine's query plan, and **Analyze** estimated
  against actual rows per operator, as they do for SQL.
- **Plan data** is the plan statement smaltdf built and sent to the engine, as JSON laid out to read. smaltdf builds plans for the engine's plan
  layer; it doesn't write SQL.
- **Stop** (<kbd>Esc</kbd>) cancels the query the engine is running.
- **Format** (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd>) re-indents the tab's code by its brackets, with a continued
  line (`.filter(…)` under `table(…)`) one level in. It changes only the spaces at the start and end of lines.
- **Messages:** how long it took, or the error.

smaltdf's functions (`table`, `col`, `lit`, `len`, `concat`, `update`, …) are in scope, with `db`, the open database.
`import { … } from '@smaltdb/df'` works too, so code can be copied to and from a project. The code is TypeScript:
its types are removed before it runs, not checked, by [smaltty](https://github.com/stenhoor/smaltty). It replaces them
with spaces, so a syntax error names the line and column you wrote. It comes with the
workbench and loads the first time a tab runs, so tabs work offline.

Types are removed, never turned into code, as with TypeScript's `erasableSyntaxOnly`. So a tab can't use what would
make code of its own, and says what to write instead:

| Instead of | Write |
| --- | --- |
| `enum Color { Red, Green }` | `const Color = { Red: 'red', Green: 'green' } as const` |
| `<number>x` | `x as number` |
| `constructor(private n: number) {}` | a field `n: number`, set in the constructor |
| `namespace N { export const x = 1 }` | an object: `const N = { x: 1 }` |

The editor highlights TypeScript and completes smaltdf's functions, the methods after a `.`, table names in
`table('…')` and column names in `col('…')` (<kbd>Ctrl</kbd>+<kbd>Space</kbd>).

## Keeping and sharing

TypeScript tabs are kept with the other tabs in this browser. **Save** writes a `.ts` file; **Open…** reads one.
[Environment manifests](./environments) carry them as saved queries with `"lang": "ts"`, and **Export** includes them.

The code runs in the page, like the browser console, and only when you press Run.
