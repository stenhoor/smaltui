---
layout: home

hero:
  name: 'sm<span class="alt">alt</span><span class="suffix tool">ui</span>'
  text: Small. Alternative. Query.
  tagline: A SQL console for smaltdb that runs entirely in the browser.
  image:
    light: /logos/smaltui/chevron-mark.svg
    dark: /logos/smaltui/chevron-mark-on-dark.svg
    alt: smaltui
  actions:
    - theme: brand
      text: Open the workbench
      link: /workbench/?env=envs/demo/env.json
      target: _self
    - theme: alt
      text: Try the live console
      link: '#demo'
    - theme: alt
      text: Getting started
      link: /guide/

features:
  - title: Object explorer
    details: Tables, views, materialized views, external tables and connections, with columns and keys. Right-click an object to script SELECT, INSERT or DDL, count rows, refresh or drop it.
  - title: Query editor
    details: Tabs with highlighting and completion of names and aliases. Run the statement at the cursor or a whole script, with bind variables, query plans, and syntax errors marked where they occur.
  - title: Databases and history
    details: Open, create and delete databases kept in your browser, or work in memory. Every statement you run is in a searchable history, per database.
  - title: Data grids
    details: Virtualized results fetched on demand. Browse tables with paging, sorting and a WHERE filter; edit cells and add or delete rows in tables with a primary key.
  - title: Import and link
    details: Load CSV, TSV, JSON, NDJSON or Parquet into a table, or link a file or URL as an external table that is read in place.
    link: /guide/import
    linkText: Import and link
  - title: Environments
    details: A JSON manifest builds a database when the page opens, with its schema, data, linked sources, and saved queries. Share a link and others get the same workspace.
    link: /guide/environments
    linkText: Environments
---

## Try it here {#demo}

A demo tea-and-coffee shop: tables, a view, a materialized view, a linked CSV and sales data imported from a Parquet
file, loaded into an in-memory smaltdb in your browser. Pick an example or write your own SQL, then press
<kbd>Ctrl</kbd>+<kbd>Enter</kbd>.

<div class="su-demo"><iframe id="consoleFrame" title="Live SQL console on the demo shop" src="./console.html" loading="lazy"></iframe></div>

<p class="su-demo-links"><a href="./console.html" target="_self">Open the console full screen ↗</a> · <a href="./workbench/?env=envs/demo/env.json" target="_self">The demo in the workbench ↗</a> · <a href="./workbench/" target="_self">Start with an empty database ↗</a></p>

## Your data stays in your browser

smaltui runs on [smaltdb](https://smaltdb.dev), the smaltworks engine, with [smaltql](https://stenhoor.github.io/smaltql/)
for SQL, in a Web Worker: databases live in the browser's private storage (OPFS) or in memory, and the page fetches only
the files and URLs you import or link. It is a folder of static files: there is no server to set up.
smaltui is one of the [smaltworks](https://smaltworks.dev) tools, beside [smaltbi](https://stenhoor.github.io/smaltbi/)
reports and [smaltnb](https://stenhoor.github.io/smaltnb/) notebooks.

**Work in progress. Come build with us.** smaltui is for people who like trying new things, don't mind breaking
changes, and want a say in how it turns out; not yet for production, or for data you can't recreate. Try it, break it,
tell us: [open an issue](https://github.com/stenhoor/smaltui/issues) or a pull request.
