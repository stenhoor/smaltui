# Import and link data

The **⇣ Import** tab brings data in two ways.

## Import into a table

Load a file (drop it or choose it), a URL, or pasted CSV, TSV, JSON or NDJSON, or a Parquet file. The preview shows
the inferred column types. Create a new table or append to an existing one. Parquet is copied through a temporary
external table and `INSERT … SELECT`.

## Link an external table

`CREATE EXTERNAL TABLE` over a URL or a local file (CSV, TSV, JSON, NDJSON or Parquet) reads the source in place,
when it is queried. Parquet over HTTP is read with Range requests: only the columns and row groups a query needs. Add a
connection, auth headers (kept in memory only) or a local materialized-view cache. The SQL is shown, and you can edit
it before it runs.

On Chromium, linked local files stay linked across reloads (File System Access handles kept in IndexedDB). Elsewhere,
the sidebar asks you to attach them again.

Linking a Parquet file from a host that compresses responses (GitHub Pages, for one) fails with `footer != PAR1`:
smaltdb takes the file size from the compressed `Content-Length`
([smaltdb#32](https://github.com/stenhoor/smaltdb/issues/32)). Import such files instead.

## Files from other sites

A page can read a file from another site only when that server allows it (CORS). Links copied from GitHub
(`github.com/…/blob/…` or `…/raw/…`, such as TidyTuesday datasets) and Hugging Face (`…/blob/…`) are rewritten to their
raw-file URLs (`raw.githubusercontent.com`, `…/resolve/…`), which do. The note under the field shows the URL used; when
a source doesn't allow it, the error says why and suggests the raw URL where there is one.
