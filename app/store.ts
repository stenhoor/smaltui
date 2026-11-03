// Per-browser workspace state: query tabs, history, preferences (localStorage) and linked local
// file handles (IndexedDB, where the File System Access API lets handles be kept).

const PREFIX = 'smaltui.';

export const prefs = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {}
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {}
  },
};

// ---------------------------------------------------------------- query history

const HISTORY_MAX = 500;

/** One statement in the query history. */
export interface HistoryEntry {
  sql: string;
  db: string | null;
  at: number;
  ms?: number;
  error?: string;
  runs?: number;
}

export function loadHistory(): HistoryEntry[] {
  return prefs.get<HistoryEntry[]>('history', []);
}

export function addHistory(entry: HistoryEntry): void {
  const h = loadHistory();
  // Collapse immediate repeats.
  if (h.length && h[0].sql === entry.sql && h[0].db === entry.db) {
    h[0] = { ...h[0], ...entry, runs: (h[0].runs ?? 1) + 1 };
  } else h.unshift({ ...entry, runs: 1 });
  prefs.set('history', h.slice(0, HISTORY_MAX));
}

export function clearHistory(): void {
  prefs.set('history', []);
}

// ---------------------------------------------------------------- linked file handles

/** A saved FileSystemFileHandle for a database's linked file. */
export interface StoredFileHandle {
  dbName: string;
  name: string;
  handle: FileSystemFileHandle;
}

let dbp: Promise<IDBDatabase> | null = null;
function idb(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('smaltui', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbp;
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | undefined): Promise<T | undefined> {
  const db = await idb();
  return new Promise<T | undefined>((resolve, reject) => {
    const t = db.transaction('files', mode);
    const req = fn(t.objectStore('files'));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

/** Remember a FileSystemFileHandle under its registered name (Chromium; elsewhere this is a no-op). */
export async function saveFileHandle(dbName: string, name: string, handle: FileSystemFileHandle): Promise<void> {
  try {
    await tx('readwrite', (s) => s.put({ dbName, name, handle }, `${dbName}\u0000${name}`));
  } catch {}
}

export async function deleteFileHandle(dbName: string, name: string): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(`${dbName}\u0000${name}`));
  } catch {}
}

/** [{ name, handle }] for a database. */
export async function loadFileHandles(dbName: string): Promise<StoredFileHandle[]> {
  try {
    const all = await tx<StoredFileHandle[]>('readonly', (s) => s.getAll());
    return (all ?? []).filter((r) => r.dbName === dbName);
  } catch {
    return [];
  }
}

export function download(filename: string, text: string | Blob, type = 'text/plain'): void {
  const blob = text instanceof Blob ? text : new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
