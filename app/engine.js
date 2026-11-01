// Loads the smaltdb client and decides where its engine worker comes from.
//
// ?engine=vendor (default)  ./vendor/smaltdb/ — a build bundled from source by scripts/vendor-smaltdb.mjs
// ?engine=npm               the latest smaltdb published to npm, from jsDelivr
// ?engine=npm@0.3.1         a specific npm version
// ?engine=https://…/dist/   any folder that serves smaltdb.js and smaltdb-worker.js
//
// A worker script must be same-origin, so a cross-origin engine is started through a tiny blob
// module that imports it.

const VENDOR = new URL('../vendor/smaltdb/', import.meta.url).href;

export function engineSpec() {
  const fromUrl = new URLSearchParams(location.search).get('engine');
  if (fromUrl) return fromUrl;
  try {
    return localStorage.getItem('smaltui.engine') || 'vendor';
  } catch {
    return 'vendor';
  }
}

export function setEngineSpec(spec) {
  try {
    if (!spec || spec === 'vendor') localStorage.removeItem('smaltui.engine');
    else localStorage.setItem('smaltui.engine', spec);
  } catch {}
}

function baseFor(spec) {
  if (!spec || spec === 'vendor') return { base: VENDOR, label: 'vendored build' };
  if (spec === 'npm' || spec.startsWith('npm@')) {
    const version = spec === 'npm' ? 'latest' : spec.slice(4);
    return { base: `https://cdn.jsdelivr.net/npm/smaltdb@${version}/dist/`, label: `npm smaltdb@${version}` };
  }
  const base = new URL(spec.endsWith('/') ? spec : spec + '/', location.href).href;
  return { base, label: base };
}

/** Import the client module. Returns { open, version, label, workerUrl, spec }. */
export async function loadEngine(spec = engineSpec()) {
  const { base, label } = baseFor(spec);
  const mod = await import(/* @vite-ignore */ base + 'smaltdb.js');
  let workerUrl = base + 'smaltdb-worker.js';
  if (new URL(workerUrl).origin !== location.origin) {
    const shim = `import ${JSON.stringify(workerUrl)};`;
    workerUrl = URL.createObjectURL(new Blob([shim], { type: 'text/javascript' }));
  }
  let version = null;
  try {
    const r = await fetch(base + 'VERSION.json', { cache: 'no-cache' });
    if (r.ok) version = await r.json();
  } catch {}
  if (!version && spec.startsWith('npm')) version = { source: 'npm', version: spec.slice(4) || 'latest' };
  return {
    spec,
    label,
    version,
    workerUrl,
    module: mod,
    open: (name, options = {}) => mod.open(name, { ...options, worker: workerUrl }),
  };
}

// ---------------------------------------------------------------- OPFS catalog (main thread)

const OPFS_DIR = 'smaltdb';

export function opfsAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory && isSecureContext;
}

async function opfsDir(create = false) {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DIR, { create });
}

/** Databases stored in OPFS by smaltdb: [{ name, size, modified }]. */
export async function listOpfsDatabases() {
  if (!opfsAvailable()) return [];
  let dir;
  try {
    dir = await opfsDir(false);
  } catch {
    return [];
  }
  const files = new Map();
  for await (const [name, handle] of dir.entries()) if (handle.kind === 'file') files.set(name, handle);
  const out = [];
  for (const [name, handle] of files) {
    if (!name.endsWith('.db')) continue;
    let size = null;
    let modified = null;
    try {
      const f = await handle.getFile();
      size = f.size;
      modified = f.lastModified;
      const wal = files.get(name + '-wal');
      if (wal) size += (await wal.getFile()).size;
    } catch {
      // Locked by an open sync access handle.
    }
    out.push({ name: name.slice(0, -3), size, modified });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Delete a database's files (it must not be open in any tab). */
export async function deleteOpfsDatabase(name) {
  const dir = await opfsDir(false);
  const prefix = name + '.db';
  const names = [];
  for await (const [n] of dir.entries()) if (n === prefix || n.startsWith(prefix + '-')) names.push(n);
  for (const n of names) await dir.removeEntry(n);
}

