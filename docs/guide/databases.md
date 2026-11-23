---
description: 'Databases in smaltui: kept in the browser (OPFS) or in memory, opened and deleted from the database menu, shared between tabs.'
---

# Databases and storage

A database lives in this browser, in one of two places:

- **OPFS (persistent):** the browser's private storage for the site. It stays when the page closes, until you delete
  it or clear the site's data.
- **Memory:** gone when the page reloads. Environments with `"storage": "memory"` build one on every visit.

## The database menu

The database's name, top left, opens **Databases**: the databases saved in OPFS for this site, with their size and when
they changed. **Open** opens one and **Delete** deletes it, after asking (the open database can't be deleted: open
another first). Type a name and choose a storage to open a database of that name, or create it. The workbench opens
the database used last when the page opens again, and [`?db=` and `?storage=`](../reference/urls) choose one in the
address.

## Several tabs

A database can be open in several browser tabs at once. One tab owns the engine and the others send their work to it;
the status bar says which this is (**owner tab** or **shared**). When the owner closes, another tab takes over.

When the page is cross-origin isolated (served with COOP/COEP headers), smaltdb reads with parallel workers and can
interrupt a running statement; the status bar says **isolated · parallel readers**. Without it the engine still works,
on one worker. GitHub Pages can't send those headers: [Engine and deploy](./engine) says where they can be set.

## History and settings

Every statement run is kept in **History**, searchable, for this database or all of them. Tabs, the theme (**⋯ → Toggle light / dark**) and the
engine choice are kept in the browser too.

From the browser's console, `smaltui.db` is the open smaltdb `Database`, for anything the workbench doesn't do.
