---
layout: home

hero:
  name: 'sm<span class="alt">alt</span><span class="suffix tool">ui</span>'
  text: 'Small. Alternative.<br>Query.'
  tagline: A query workbench for smaltdb that runs entirely in the browser.
  image:
    light: /logos/smaltui/chevron-mark.svg
    dark: /logos/smaltui/chevron-mark-on-dark.svg
    alt: smaltui
  actions:
    - theme: brand
      text: Getting started
      link: /guide/
features:
  - title: Object explorer
    details: Tables, views, materialized views, external tables and connections, with columns and keys. Right-click an object to script SELECT, INSERT or DDL, count rows, refresh or drop it.
  - title: Query editor
    details: Tabs with highlighting and completion of names and aliases. Run the statement at the cursor or a whole script, with bind variables, query plans, and syntax errors marked where they occur.
  - title: TypeScript tabs
    details: Beside the SQL tabs, query in TypeScript with smaltdf, the dataframe language for smaltdb. Frames and expressions run as plans in the same engine, on the same database.
    link: /guide/typescript
    linkText: TypeScript tabs
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

## Your data stays in your browser

smaltui runs on [smaltdb](https://smaltdb.dev), the smaltworks engine, with [smaltql](https://stenhoor.github.io/smaltql/)
for SQL and [smaltdf](https://stenhoor.github.io/smaltdf/) for dataframes, in a Web Worker: databases live in the browser's private storage (OPFS) or in memory, and the page fetches only
the files and URLs you import or link. It is a folder of static files: there is no server to set up.
smaltui is one of the [smaltworks](https://smaltworks.dev) tools, beside [smaltbi](https://stenhoor.github.io/smaltbi/)
reports and [smaltnb](https://stenhoor.github.io/smaltnb/) notebooks.

**Work in progress. Come build with us.** smaltui is for people who like trying new things, don't mind breaking
changes, and want a say in how it turns out; not yet for production, or for data you can't recreate. Try it, break it,
tell us: [open an issue](https://github.com/stenhoor/smaltui/issues) or a pull request.
