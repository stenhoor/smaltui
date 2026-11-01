// Per-browser workspace state: query tabs, history, preferences (localStorage) and linked local
// file handles (IndexedDB, where the File System Access API lets handles be kept).

const PREFIX = 'smaltui.';

export const prefs = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {}
  },
  remove(key) {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {}
  },
};

// ---------------------------------------------------------------- query history

const HISTORY_MAX = 500;

export function loadHistory() {
  return prefs.get('history', []);
}

export function addHistory(entry) {
  const h = loadHistory();
  // Collapse immediate repeats.
  if (h.length && h[0].sql === entry.sql && h[0].db === entry.db) {
    h[0] = { ...h[0], ...entry, runs: (h[0].runs ?? 1) + 1 };
  } else h.unshift({ ...entry, runs: 1 });
  prefs.set('history', h.slice(0, HISTORY_MAX));
}

export function clearHistory() {
  prefs.set('history', []);
}

// ---------------------------------------------------------------- linked file handles

let dbp = null;
function idb() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open('smaltui', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbp;
}

async function tx(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction('files', mode);
    const req = fn(t.objectStore('files'));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

/** Remember a FileSystemFileHandle under its registered name (Chromium; elsewhere this is a no-op). */
export async function saveFileHandle(dbName, name, handle) {
  try {
    await tx('readwrite', (s) => s.put({ dbName, name, handle }, `${dbName}\u0000${name}`));
  } catch {}
}

export async function deleteFileHandle(dbName, name) {
  try {
    await tx('readwrite', (s) => s.delete(`${dbName}\u0000${name}`));
  } catch {}
}

/** [{ name, handle }] for a database. */
export async function loadFileHandles(dbName) {
  try {
    const all = await tx('readonly', (s) => s.getAll());
    return (all ?? []).filter((r) => r.dbName === dbName);
  } catch {
    return [];
  }
}

export function download(filename, text, type = 'text/plain') {
  const blob = text instanceof Blob ? text : new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
