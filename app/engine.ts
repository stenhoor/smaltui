// Loads the smaltdb client and decides where its engine worker comes from.
//
// ?engine=vendor (default)  ./vendor/smaltdb/ — the npm package version pinned in package.json,
//                           copied there by `npm install` (scripts/vendor-smaltdb.mjs)
// ?engine=npm               the latest smaltdb on npm, from jsDelivr
// ?engine=npm@0.8.3         a specific npm version
// ?engine=https://…/dist/   any folder that serves smaltdb.js and smaltdb-worker.js
//
// If vendor/ is missing (the folder is served without `npm install`), the latest npm release is
// loaded from jsDelivr instead. A worker script must be same-origin, so a cross-origin engine is
// started through a tiny blob module that imports it.

import type * as Smaltdb from 'smaltdb';

/** The smaltdb client module, as loaded at runtime from vendor/, a CDN or a custom URL. */
export type SmaltdbModule = typeof Smaltdb;
export type Database = Smaltdb.Database;
export type OpenOptions = Smaltdb.OpenOptions;
export type ArrayResult = Smaltdb.ArrayResult;

/** What VERSION.json (vendor/) or the npm package says about the loaded engine. */
export interface EngineVersion {
  source: 'npm' | 'checkout' | string;
  version?: string;
  commit?: string | null;
  path?: string;
}

export interface Engine {
  spec: string;
  label: string;
  version: EngineVersion | null;
  workerUrl: string;
  module: SmaltdbModule;
  open(name: string, options?: OpenOptions): Promise<Database>;
}

export interface OpfsDatabase {
  name: string;
  size: number | null;
  modified: number | null;
}

const VENDOR = new URL('../vendor/smaltdb/', import.meta.url).href;

export function engineSpec(): string {
  const fromUrl = new URLSearchParams(location.search).get('engine');
  if (fromUrl) return fromUrl;
  try {
    return localStorage.getItem('smaltui.engine') || 'vendor';
  } catch {
    return 'vendor';
  }
}

export function setEngineSpec(spec: string): void {
  try {
    if (!spec || spec === 'vendor') localStorage.removeItem('smaltui.engine');
    else localStorage.setItem('smaltui.engine', spec);
  } catch {}
}

function baseFor(spec: string): { base: string; label: string } {
  if (!spec || spec === 'vendor') return { base: VENDOR, label: 'bundled npm package' };
  if (spec === 'npm' || spec.startsWith('npm@')) {
    const version = spec === 'npm' ? 'latest' : spec.slice(4);
    return { base: `https://cdn.jsdelivr.net/npm/smaltdb@${version}/dist/`, label: `npm smaltdb@${version}` };
  }
  const base = new URL(spec.endsWith('/') ? spec : spec + '/', location.href).href;
  return { base, label: base };
}

/** Import the client module. Returns { open, version, label, workerUrl, spec }. */
export async function loadEngine(spec: string = engineSpec()): Promise<Engine> {
  let { base, label } = baseFor(spec);
  let mod: SmaltdbModule;
  try {
    mod = await import(/* @vite-ignore */ base + 'smaltdb.js');
  } catch (e) {
    if (spec !== 'vendor') throw e;
    console.warn('smaltui: vendor/smaltdb is missing (run `npm install`); loading smaltdb@latest from jsDelivr.', e);
    spec = 'npm';
    ({ base, label } = baseFor(spec));
    label += ' (vendor/ missing)';
    mod = await import(/* @vite-ignore */ base + 'smaltdb.js');
  }
  let workerUrl = base + 'smaltdb-worker.js';
  if (new URL(workerUrl).origin !== location.origin) {
    const shim = `import ${JSON.stringify(workerUrl)};`;
    workerUrl = URL.createObjectURL(new Blob([shim], { type: 'text/javascript' }));
  }
  // Version info: vendor/ has VERSION.json; an npm package has package.json next to dist/.
  // (A custom URL may have neither; it is not probed, to avoid CORS noise.)
  let version: EngineVersion | null = null;
  try {
    if (spec === 'vendor') {
      const r = await fetch(base + 'VERSION.json', { cache: 'no-cache' });
      if (r.ok) version = await r.json();
    } else if (spec.startsWith('npm')) {
      const r = await fetch(base + '../package.json');
      if (r.ok) version = { source: 'npm', version: (await r.json()).version };
    }
  } catch {}
  if (!version && spec.startsWith('npm')) version = { source: 'npm', version: spec.slice(4) || 'latest' };
  return {
    spec,
    label,
    version,
    workerUrl,
    module: mod,
    open: (name: string, options: OpenOptions = {}) => mod.open(name, { ...options, worker: workerUrl }),
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
export async function listOpfsDatabases(): Promise<OpfsDatabase[]> {
  if (!opfsAvailable()) return [];
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await opfsDir(false);
  } catch {
    return [];
  }
  const files = new Map<string, FileSystemFileHandle>();
  for await (const [name, handle] of dir.entries()) if (handle.kind === 'file') files.set(name, handle as FileSystemFileHandle);
  const out: OpfsDatabase[] = [];
  for (const [name, handle] of files) {
    if (!name.endsWith('.db')) continue;
    let size: number | null = null;
    let modified: number | null = null;
    try {
      const f = await handle.getFile();
      size = f.size;
      modified = f.lastModified;
      const wal = files.get(name + '-wal');
      if (wal) size = (size ?? 0) + (await wal.getFile()).size;
    } catch {
      // Locked by an open sync access handle.
    }
    out.push({ name: name.slice(0, -3), size, modified });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Delete a database's files (it must not be open in any tab). */
export async function deleteOpfsDatabase(name: string): Promise<void> {
  const dir = await opfsDir(false);
  const prefix = name + '.db';
  const names: string[] = [];
  for await (const [n] of dir.entries()) if (n === prefix || n.startsWith(prefix + '-')) names.push(n);
  for (const n of names) await dir.removeEntry(n);
}

