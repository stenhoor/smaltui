---
description: 'URL parameters of the workbench: env, db, storage, sql and engine.'
---

# URL parameters

The workbench is `workbench/` on the site. Its parameters open it on a database, an environment or a query:

| Parameter | Example | What it does |
| --- | --- | --- |
| `env` | `?env=envs/demo/env.json` | Loads an [environment manifest](./environment) and builds its database. |
| `db` | `?db=sales` | Opens (or creates) the database of that name. Without `env` or `db`, the workbench opens the database used last, or `scratch`. |
| `storage` | `?db=sales&storage=memory` | `opfs` (the default with `db`) or `memory`. |
| `sql` | `?sql=SELECT%201` | Opens the SQL in a query tab and runs it, then removes it from the address, so a reload doesn't run it again. The site's playgrounds use it for **Open in smaltui**. |
| `engine` | `?engine=https://…/vendor/smaltdb/` | Loads the engine from another folder built like `vendor/smaltdb/` (with `smaltdb.js` and `smaltdb-worker.js`). `vendor`, the default, is the bundled engine. **⋯ → Engine source…** chooses one and remembers it. |

Values are URL-encoded: `encodeURIComponent(sql)` in JavaScript.
