// smaltui — a SQL console for smaltdb that runs entirely in the browser.
import { loadEngine, engineSpec, setEngineSpec, opfsAvailable, listOpfsDatabases, deleteOpfsDatabase, importCSV, importJSON, exportCSV, exportJSON, registerFile, registerCredentials, type ArrayResult, type Database, type Engine } from './engine.js';
import { splitStatements, returnsRows, changesSchema, scanParams, quoteIdent, quoteLiteral, tableNameFrom, formatSql, leadingKeyword, type ParamSlot, type SqlValue, type Statement } from './sql.js';
import { Editor, type EditorSchema, type SchemaTable } from './editor.js';
import { Grid, formatValue, plainValue, exportRows, type Column, type ExportFormat, type Row, type SortDir, type Value } from './grid.js';
import { normalizeDataUrl, corsHint } from '../vendor/smaltkit/urls.js';
import { splitLastExpression } from './ts.js';
import type * as Df from '@smaltdb/df';
import type * as Smaltdb from 'smaltdb';
import { icon, type IconName } from './icons.js';
import { prefs, loadHistory, addHistory, clearHistory, saveFileHandle, loadFileHandles, deleteFileHandle, download } from './store.js';
import { fetchManifest, applyManifest, manifestKey, exportManifest, exportSqlDump, externalTableSql, formatFromName, importParquet, type DataFormat, type Manifest, type ReaderOptions } from './env.js';

// ================================================================ helpers

/**
 * Query one element. The page's structure is fixed, so lookups of known elements are non-null. The default type
 * covers form controls and links (.value, .checked, .disabled, .href); pass a type for anything more specific.
 */
const $ = <T extends Element = HTMLInputElement & HTMLAnchorElement>(sel: string, root: ParentNode = document): T => root.querySelector<T>(sel)!;
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] => [...root.querySelectorAll<T>(sel)];
const esc = (s: unknown): string => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Build an element from HTML. */
function h<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}
/** The nearest ancestor of an event's target matching `sel`. */
const closest = <T extends Element = HTMLElement>(e: Event, sel: string): T | null => (e.target as Element | null)?.closest<T>(sel) ?? null;
const fmtMs = (ms: number): string => (ms < 1 ? '<1 ms' : ms < 1000 ? `${ms.toFixed(ms < 10 ? 1 : 0)} ms` : `${(ms / 1000).toFixed(2)} s`);
const fmtBytes = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const fmtNum = (n: unknown): string => (typeof n === 'number' ? n.toLocaleString() : String(n));
const now = (): number => performance.now();
const timeOfDay = (): string => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const errText = (e: unknown): string => {
  const err = e as { code?: string; message?: string } | null | undefined;
  const base = err?.code ? `${err.code}: ${err.message}` : String(err?.message ?? e);
  const hint = corsHint(base);
  return hint ? `${base}\n${hint}` : base;
};

function toast(text: string, kind = ''): void {
  const el = h(`<div class="toast ${kind}"></div>`);
  el.textContent = text;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 8000 : 3500);
}

function status(text: string, kind = ''): void {
  const el = $('#stMsg');
  el.textContent = text;
  el.className = 'grow ' + kind;
}

/** A modal's named form controls, by name (inputs, selects and textareas all have .value / .checked). */
type FormFields = Record<string, HTMLInputElement>;

interface ModalButton<T> {
  label: string;
  /** What the modal resolves with: a value, or a function of the form's fields. */
  value: T | ((f: FormFields) => T);
  primary?: boolean;
  danger?: boolean;
}

interface ModalOptions<T> {
  title: string;
  body: string;
  buttons?: ModalButton<T>[];
  onOpen?: (form: HTMLFormElement, done: (v: T | null) => void) => void;
  wide?: boolean;
}

/** Open a modal. `body` is HTML. Resolves with the clicked button's value (or null when dismissed). */
function modal<T = unknown>({ title, body, buttons = [{ label: 'Close', value: null as T }], onOpen, wide = false }: ModalOptions<T>): Promise<T | null> {
  const dlg = $<HTMLDialogElement>('#modal');
  const inner = $<HTMLFormElement>('#modalInner');
  dlg.style.width = wide ? 'min(900px, calc(100vw - 32px))' : '';
  inner.innerHTML = `<div class="modal-head"><span>${esc(title)}</span><button type="button" class="icon" data-x aria-label="Close">${icon('close')}</button></div>
    <div class="modal-body">${body}</div>
    <div class="modal-foot">${buttons.map((b, i) => `<button type="${b.primary ? 'submit' : 'button'}" data-i="${i}" class="${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}">${esc(b.label)}</button>`).join('')}</div>`;
  const fields = (): FormFields => Object.fromEntries($$<HTMLInputElement>('[name]', inner).map((el) => [el.name, el]));
  const valueOf = (b: ModalButton<T>): T => (typeof b.value === 'function' ? (b.value as (f: FormFields) => T)(fields()) : b.value);
  return new Promise<T | null>((resolve) => {
    let result: T | null = null;
    const done = (v: T | null) => {
      result = v;
      dlg.close();
    };
    inner.onsubmit = (e) => {
      e.preventDefault();
      const b = buttons.find((x) => x.primary);
      done(b ? valueOf(b) : null);
    };
    $<HTMLButtonElement>('[data-x]', inner).onclick = () => done(null);
    $$<HTMLButtonElement>('.modal-foot button[type=button]', inner).forEach((btn) => {
      btn.onclick = () => done(valueOf(buttons[Number(btn.dataset.i!)]));
    });
    dlg.onclose = () => resolve(result);
    dlg.showModal();
    onOpen?.(inner, done);
    const first = inner.querySelector<HTMLElement>('input, select, textarea');
    (first ?? inner.querySelector<HTMLElement>('button.primary'))?.focus();
  });
}

async function confirmBox(title: string, text: string, okLabel = 'OK', danger = false): Promise<boolean> {
  return (await modal<boolean>({ title, body: `<p>${text}</p>`, buttons: [{ label: 'Cancel', value: false }, { label: okLabel, value: true, primary: true, danger }] })) === true;
}

function showValue(value: Value, title = 'Value'): void {
  let text = plainValue(value);
  let note: string = value === null || value === undefined ? 'NULL' : value instanceof Uint8Array ? `BLOB, ${value.length} bytes` : typeof value === 'bigint' ? 'INTEGER (64-bit)' : typeof value;
  if (typeof value === 'string' && /^\s*[[{]/.test(value)) {
    try {
      text = JSON.stringify(JSON.parse(value), null, 2);
      note += ' · JSON';
    } catch {}
  }
  void modal<unknown>({
    title,
    body: `<p>${esc(note)}${typeof value === 'string' ? ` · ${value.length.toLocaleString()} chars` : ''}</p><pre class="value">${esc(text)}</pre>`,
    buttons: [{ label: 'Copy', value: () => navigator.clipboard?.writeText(text) }, { label: 'Close', value: null, primary: true }],
    wide: true,
  });
}

type MenuItem = { label: string; run: () => void; danger?: boolean } | '-';

function contextMenu(x: number, y: number, items: MenuItem[]): void {
  const m = $<HTMLDivElement>('#ctxMenu');
  m.innerHTML = '';
  for (const it of items) {
    if (it === '-') m.appendChild(h('<hr>'));
    else {
      const b = h<HTMLButtonElement>(`<button type="button">${esc(it.label)}</button>`);
      if (it.danger) b.classList.add('danger');
      b.onclick = () => {
        m.hidden = true;
        it.run();
      };
      m.appendChild(b);
    }
  }
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
}
document.addEventListener('mousedown', (e) => {
  if (!closest(e, '#ctxMenu')) $<HTMLElement>('#ctxMenu').hidden = true;
  if (!closest(e, '.menu-wrap')) $<HTMLElement>('#moreMenu').hidden = true;
});

/** Vertical/horizontal drag splitters. */
function dragSplit(handle: HTMLElement, onMove: (ev: MouseEvent) => void, onEnd?: () => void): void {
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    handle.classList.add('drag');
    const move = (ev: MouseEvent) => onMove(ev);
    const up = () => {
      handle.classList.remove('drag');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      onEnd?.();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

// ================================================================ types

type Storage = 'opfs' | 'memory';
type Row0 = Record<string, SqlValue>;

/** The object explorer's view of the catalog. */
interface Schema extends EditorSchema {
  objects: { table_schema: string; table_name: string; table_type: string }[];
  external: { table_name: string; location: string; format: string | null; connection_name: string | null }[];
  connections?: { connection_name: string; url: string; credentials: string | null }[];
}

/** A registered file (`file:<name>` in SQL). */
interface LinkedFile {
  source?: Blob | FileSystemFileHandle;
  handle?: FileSystemFileHandle | null;
  state: 'ok' | 'needs-permission' | 'missing';
  db?: string | null;
}

/** An open result cursor: it blocks this tab's writes until closed. */
interface OpenCursor {
  it: AsyncIterableIterator<ArrayResult>;
  close(): Promise<void>;
}

type TabKind = 'query' | 'ts' | 'table' | 'import' | 'history' | 'welcome';

interface TabBase {
  id: number;
  kind: TabKind;
  title: string;
  icon: string;
  tooltip?: string;
  el: HTMLElement;
  objectName?: string;
  busy?: boolean;
  init?(): void;
  onShow?(): void;
  onSchema?(): void;
  onDatabase?(): void;
  dispose?(): void;
}

interface Message {
  kind: 'ok' | 'err' | 'warn';
  text: string;
  sql: string;
  at: string;
}

interface ResultSet {
  columns: string[];
  rows: Row[];
  more: OpenCursor | null;
  closed?: boolean;
  sql: string;
  ms?: number;
}

interface PlanResult {
  sql: string;
  rows: Row[];
  columns: string[];
  analyze?: boolean;
}

interface QueryTab extends TabBase {
  kind: 'query';
  sql: string;
  editor: Editor;
  results: ResultSet[];
  messages: Message[];
  binds: Record<string, { v: string; t: string }>;
  plan: PlanResult | null;
  errorAt: number | null;
  grids: Grid[];
  abort?: AbortController;
  format(): void;
  save(): void;
  openFile(): Promise<void>;
  stop(): void;
  setBusy(b: boolean): void;
  run(scope: 'statement' | 'script', mode?: 'run' | 'plan' | 'analyze'): Promise<void>;
  markError(st: Statement, e: unknown): void;
  askBinds(slots: ParamSlot[]): Promise<SqlValue[] | null>;
  fetchResult(sql: string, params: SqlValue[] | undefined, signal: AbortSignal, keepOpen: boolean): Promise<ResultSet>;
  fetchMore(res: ResultSet, all?: boolean): Promise<void>;
  renderResults(view?: string): void;
  refreshResultBar(): void;
  fillBar(bar: HTMLElement, res: ResultSet, grid: Grid): void;
}

interface TableTab extends TabBase {
  kind: 'table';
  objectName: string;
  kindName: string;
  where: string;
  sort: { col: string; dir: 'asc' | 'desc' } | null;
  limit: number;
  offset: number;
  total: number | null;
  rows: Row[];
  columns: Column[];
  view: string;
  grid: Grid;
  page(offset: number): void;
  pkCols(): string[];
  editable(): boolean;
  selectSql(withPaging?: boolean): string;
  load(recount?: boolean): Promise<void>;
  updatePager(): void;
  renderEditTools(): void;
  keyOf(row: Row): { where: string; params: SqlValue[] };
  editCell(r: number, c: number, value: string | null): Promise<void>;
  deleteRow(): Promise<void>;
  insertRow(): Promise<void>;
  buildViews(): void;
  showView(key: string): Promise<void>;
}

interface LinkSpec {
  table: string;
  location: string;
  sql: string;
  connection: string;
  format: DataFormat | string | undefined;
  options: ReaderOptions;
}

interface ImportTab extends TabBase {
  kind: 'import';
  source?: { blob: Blob; label: string };
  previewGrid: Grid;
  lsrc: 'url' | 'file';
  lfile?: { file: File; handle: FileSystemFileHandle | null };
  lfileName?: string;
  lnameTouched?: boolean;
  lsqlTouched?: boolean;
  wireImport(): void;
  setImportSource(blob: Blob, label: string): void;
  syncImportMode(): void;
  readerArgs(): { fmt: string; args: string[] };
  previewImport(): Promise<void>;
  importResult(text: string, err?: boolean): void;
  doImport(): Promise<void>;
  wireLink(): void;
  linkSpec(): LinkSpec;
  updateLinkSql(): void;
  prepareLink(): Promise<void>;
  previewLink(): Promise<void>;
  createLink(): Promise<void>;
  wireEnv(): void;
}

interface HistoryTab extends TabBase {
  kind: 'history';
  render(): void;
}

interface WelcomeTab extends TabBase {
  kind: 'welcome';
}

/** A TypeScript tab: smaltdf code that runs against the open database (see tsTab). */
interface TsTab extends TabBase {
  kind: 'ts';
  source: string;
  editor: Editor;
  results: { title: string; columns: string[]; rows: Row[]; ms: number }[];
  texts: { title: string; text: string }[];
  /** The plan statement smaltdf built for the last frame (Plan data). */
  planData: string | null;
  /** EXPLAIN / EXPLAIN ANALYZE of the tab's frame (Plan / Analyze), as a SQL tab shows it. */
  plan: PlanResult | null;
  messages: Message[];
  grids: Grid[];
  abort?: AbortController;
  run(mode?: 'run' | 'plan' | 'analyze'): Promise<void>;
  addResult(df: DfModule, v: unknown, title: string, sdb: Database): Promise<void>;
  stop(): void;
  setBusy(b: boolean): void;
  renderResults(view?: string): void;
  save(): void;
  openFile(): void;
}

type Tab = QueryTab | TsTab | TableTab | ImportTab | HistoryTab | WelcomeTab;

/** Placeholder for a tab field that its init() assigns before anything reads it. */
const assignedInInit = <T,>(): T => undefined as T;

/** A fresh tab pane; addTab() puts it on the page. */
const blankPane = (): HTMLElement => h('<div class="pane" role="tabpanel"></div>');

// ================================================================ state

interface AppState {
  engine: Engine | null;
  db: Database | null;
  dbName: string | null;
  storage: Storage | null;
  schema: Schema;
  tabs: Tab[];
  active: Tab | null;
  files: Map<string, LinkedFile>;
  streams: Set<OpenCursor>;
  env: Manifest | null;
}

const app: AppState = {
  engine: null,
  db: null,
  dbName: null,
  storage: null,
  schema: { objects: [], tables: new Map(), names: new Set(), external: [] },
  tabs: [],
  active: null,
  files: new Map(),
  streams: new Set(),
  env: null,
};
(window as unknown as { smaltui: AppState }).smaltui = app; // handy from the devtools console: smaltui.db.query(…)

/** The open database (callers run only once one is open). */
const db = (): Database => {
  if (!app.db) throw new Error('No database is open');
  return app.db;
};

const OBJECT_KINDS: Record<string, { group: string; ico: string; kind: string }> = {
  'BASE TABLE': { group: 'Tables', ico: icon('table'), kind: 'table' },
  VIEW: { group: 'Views', ico: icon('view'), kind: 'view' },
  'MATERIALIZED VIEW': { group: 'Materialized views', ico: icon('matview'), kind: 'matview' },
  EXTERNAL: { group: 'External tables', ico: icon('external'), kind: 'external' },
  'LOCAL TEMPORARY': { group: 'Temporary tables', ico: icon('temp'), kind: 'temp' },
};

// ================================================================ database lifecycle

async function closeStreams() {
  const all = [...app.streams];
  app.streams.clear();
  await Promise.all(all.map((s) => s.close()));
}

/** Run a write safely: open result cursors are closed first (they would make writes fail with SMALT_BUSY). */
async function write<T>(fn: (db: Database) => Promise<T>): Promise<T> {
  await closeStreams();
  return fn(db());
}

async function openDatabase(name: string, storage: Storage = 'opfs', { quiet = false }: { quiet?: boolean } = {}): Promise<void> {
  if (storage === 'opfs' && !opfsAvailable()) {
    toast('OPFS is not available here (it needs a secure context: https or localhost). Opening in memory instead.', 'err');
    storage = 'memory';
  }
  setDbIndicator('busy', name, storage);
  if (app.db) {
    await closeStreams();
    for (const t of [...app.tabs]) if (t.kind === 'table') closeTab(t, true);
    try {
      await db().close();
    } catch {}
    app.db = null;
  }
  const t0 = now();
  try {
    app.db = await app.engine!.open(name, { storage });
  } catch (e) {
    setDbIndicator('off', name, storage);
    throw e;
  }
  app.dbName = name;
  app.storage = storage;
  prefs.set('lastDb', { name, storage });
  const url = new URL(location.href);
  url.searchParams.set('db', name);
  if (storage === 'memory') url.searchParams.set('storage', 'memory');
  else url.searchParams.delete('storage');
  history.replaceState(null, '', url);
  setDbIndicator('on', name, storage);
  await restoreFiles();
  await refreshSchema();
  updateModeStatus();
  if (!quiet) status(`Opened ${name} (${storage}) in ${fmtMs(now() - t0)}`);
  for (const t of app.tabs) t.onDatabase?.();
}

function setDbIndicator(state: 'on' | 'busy' | 'off', name: string | null, storage: Storage | null): void {
  $('#dbDot').className = 'db-dot ' + (state === 'on' ? 'on' : state === 'busy' ? 'busy' : '');
  $('#dbName').textContent = name ?? 'no database';
  $('#dbStorage').textContent = storage ?? '';
  document.title = name ? `${name} · smaltui` : 'smaltui';
}

function updateModeStatus() {
  const parts = [];
  parts.push(crossOriginIsolated ? 'isolated · parallel readers' : 'not isolated');
  if (app.db) parts.push(db().isLeader ? 'owner tab' : 'shared (another tab owns the engine)');
  $('#stMode').textContent = parts.join(' · ');
}

async function dbPicker() {
  const list = await listOpfsDatabases();
  const rows = list
    .map(
      (d) => `<div class="db-row" data-name="${esc(d.name)}">
        <span class="nm">${esc(d.name)}</span>
        <span class="meta">${fmtBytes(d.size)}${d.modified ? ' · ' + new Date(d.modified).toLocaleString() : ''}</span>
        ${d.name === app.dbName && app.storage === 'opfs' ? '<span class="cur">● open</span>' : ''}
        <span class="acts"><button type="button" data-open>Open</button><button type="button" class="danger" data-del ${d.name === app.dbName && app.storage === 'opfs' ? 'disabled title="Close it first (open another database)"' : ''}>Delete</button></span>
      </div>`,
    )
    .join('');
  const body = `
    ${opfsAvailable() ? `<p>Databases saved in this browser's private storage (OPFS) for <b>${esc(location.origin)}</b>.</p><div class="db-list">${rows || '<div class="db-row"><span class="meta">No saved databases yet.</span></div>'}</div>` : '<p>OPFS is not available in this context, so only in-memory databases can be opened.</p>'}
    <div class="row">
      <label class="field"><span>New or existing database name</span><input type="text" name="dbname" placeholder="e.g. sales" pattern="[A-Za-z0-9_\\-\\.]+" title="letters, digits, _ - ."></label>
      <label class="field" style="flex:0 0 auto"><span>Storage</span>
        <select name="storage">${opfsAvailable() ? '<option value="opfs">OPFS (persistent)</option>' : ''}<option value="memory">Memory (discarded on reload)</option></select></label>
    </div>`;
  const r = await modal<{ name: string; storage: Storage } | { del: string } | null>({
    title: 'Databases',
    body,
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'Open', primary: true, value: (f) => ({ name: f.dbname.value.trim(), storage: f.storage.value as Storage }) },
    ],
    onOpen: (form, done) => {
      $$('[data-open]', form).forEach((b) => (b.onclick = () => done({ name: b.closest<HTMLElement>('.db-row')!.dataset.name!, storage: 'opfs' })));
      $$('[data-del]', form).forEach(
        (b) =>
          (b.onclick = async () => {
            const name = b.closest<HTMLElement>('.db-row')!.dataset.name!;
            done({ del: name });
          }),
      );
    },
  });
  if (!r) return;
  if ('del' in r) {
    if (await confirmBox('Delete database', `Delete <b>${esc(r.del)}</b> and all its data from this browser? This cannot be undone. Close it in other tabs first.`, 'Delete', true)) {
      try {
        await deleteOpfsDatabase(r.del);
        toast(`Deleted ${r.del}`, 'ok');
      } catch (e) {
        toast(`Could not delete ${r.del}: ${(e as Error).message} (is it open in another tab?)`, 'err');
      }
    }
    return dbPicker();
  }
  if (!r.name) return;
  try {
    await openDatabase(r.name, r.storage);
  } catch (e) {
    toast(`Could not open ${r.name}: ${errText(e)}`, 'err');
  }
}

// ================================================================ linked files

async function restoreFiles(): Promise<void> {
  // Files registered with the previous Database object must be registered again.
  const keep = new Map<string, LinkedFile>();
  for (const [name, f] of app.files) if (f.source && f.db === app.dbName) keep.set(name, f);
  app.files = keep;
  for (const [name, f] of app.files) if (f.source) await registerFile(db(), name, f.source).catch(() => (f.state = 'missing'));
  for (const { name, handle } of await loadFileHandles(app.dbName ?? '')) {
    if (app.files.get(name)?.state === 'ok') continue;
    let perm: PermissionState = 'prompt';
    try {
      perm = await handle.queryPermission({ mode: 'read' });
    } catch {}
    if (perm === 'granted') {
      try {
        await registerFile(db(), name, handle);
        app.files.set(name, { source: handle, handle, state: 'ok', db: app.dbName });
        continue;
      } catch {}
    }
    app.files.set(name, { handle, state: 'needs-permission', db: app.dbName });
  }
}

async function linkFile(name: string, source: Blob | FileSystemFileHandle, handle: FileSystemFileHandle | null = null): Promise<void> {
  await registerFile(db(), name, source);
  app.files.set(name, { source, handle, state: 'ok', db: app.dbName });
  if (handle) await saveFileHandle(app.dbName ?? '', name, handle);
  renderLinkedFiles();
}

async function regrantFile(name: string): Promise<void> {
  const f = app.files.get(name);
  if (f?.handle) {
    try {
      if ((await f.handle.requestPermission({ mode: 'read' })) === 'granted') {
        await linkFile(name, f.handle, f.handle);
        toast(`Reconnected file:${name}`, 'ok');
        return;
      }
    } catch {}
  }
  // No handle (or permission refused): ask for the file again.
  const picked = await pickLocalFile();
  if (picked) {
    await linkFile(name, picked.handle ?? picked.file, picked.handle);
    toast(`Attached ${picked.file.name} as file:${name}`, 'ok');
  }
}

interface PickedFile {
  file: File;
  handle: FileSystemFileHandle | null;
}

/** Let the user choose a file: the File System Access picker (keeps a handle) or a plain input. */
async function pickLocalFile(accept = '.csv,.tsv,.txt,.json,.ndjson,.jsonl,.parquet'): Promise<PickedFile | null> {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: [{ description: 'Data files', accept: { 'application/octet-stream': accept.split(',') } }], excludeAcceptAllOption: false });
      return { handle, file: await handle.getFile() };
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
    }
  }
  return new Promise<PickedFile | null>((resolve) => {
    const input = h<HTMLInputElement>(`<input type="file" accept="${accept}" hidden>`);
    input.onchange = () => resolve(input.files?.[0] ? { file: input.files[0], handle: null } : null);
    input.oncancel = () => resolve(null);
    document.body.appendChild(input);
    input.click();
    setTimeout(() => input.remove(), 60000);
  });
}

function renderLinkedFiles() {
  const el = $('#linkedFiles');
  const needed = new Set(app.schema.external.filter((x) => String(x.location).startsWith('file:')).map((x) => String(x.location).slice(5)));
  const names = new Set([...app.files.keys(), ...needed]);
  names.delete('__preview');
  if (!names.size) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `<div style="font-weight:600;margin-bottom:2px">Linked files</div>` + [...names].sort().map((n) => {
    const f = app.files.get(n);
    const st = f?.state === 'ok' ? '<span class="st ok">attached</span>' : f?.state === 'needs-permission' ? `<button class="icon st warn" data-regrant="${esc(n)}" title="Grant read access again">grant access</button>` : `<button class="icon st warn" data-regrant="${esc(n)}" title="Choose the file again">attach…</button>`;
    return `<div class="lf"><span>📄</span><span class="nm" title="file:${esc(n)}">${esc(n)}</span>${st}</div>`;
  }).join('');
  $$('[data-regrant]', el).forEach((b) => (b.onclick = () => regrantFile(b.dataset.regrant!).catch((e) => toast(errText(e), 'err'))));
}

// ================================================================ schema / object explorer

async function refreshSchema(): Promise<void> {
  if (!app.db) return;
  const db = app.db;
  type R = Record<string, string | null>;
  try {
    const [objects, columns, external, conns, pks] = await Promise.all([
      db.query<Schema['objects'][number]>("SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema <> 'information_schema' ORDER BY table_name"),
      db.query<R>("SELECT table_name, column_name, data_type, ordinal_position, is_nullable FROM information_schema.columns WHERE table_schema <> 'information_schema' ORDER BY table_name, ordinal_position"),
      db.query<Schema['external'][number]>('SELECT table_name, location, format, connection_name FROM information_schema.external_tables').catch(() => [] as Schema['external']),
      db.query<NonNullable<Schema['connections']>[number]>('SELECT connection_name, url, credentials FROM information_schema.connections').catch(() => [] as NonNullable<Schema['connections']>),
      db.query<R>("SELECT k.table_name, k.column_name FROM information_schema.key_column_usage k JOIN information_schema.table_constraints c ON c.constraint_name = k.constraint_name AND c.table_name = k.table_name WHERE c.constraint_type = 'PRIMARY KEY'").catch(() => [] as R[]),
    ]);
    const pkSet = new Set(pks.map((p) => `${p.table_name}\u0000${p.column_name}`));
    const tables = new Map<string, SchemaTable>();
    for (const o of objects) {
      const arr: SchemaTable = [];
      arr.kind = OBJECT_KINDS[o.table_type]?.kind ?? 'table';
      arr.type = o.table_type;
      tables.set(o.table_name, arr);
    }
    for (const c of columns) {
      const arr = tables.get(c.table_name ?? '');
      if (arr) arr.push({ name: c.column_name ?? '', type: c.data_type, nullable: c.is_nullable === 'YES', pk: pkSet.has(`${c.table_name}\u0000${c.column_name}`) });
    }
    app.schema = { objects, tables, names: new Set([...tables.keys()].map((n) => n.toLowerCase())), external, connections: conns };
  } catch (e) {
    toast('Could not read the catalog: ' + errText(e), 'err');
  }
  renderTree();
  renderLinkedFiles();
  for (const t of app.tabs) t.onSchema?.();
}

const expanded = new Set<string>(prefs.get<string[]>('expanded', []));
const collapsedGroups = new Set<string>(prefs.get<string[]>('collapsedGroups', []));

function renderTree(): void {
  const tree = $('#tree');
  const filter = $('#treeFilter').value.trim().toLowerCase();
  const groups = new Map<string, { name: string; cols: SchemaTable; kind: (typeof OBJECT_KINDS)[string] }[]>();
  for (const [name, cols] of app.schema.tables) {
    const kind = OBJECT_KINDS[cols.type ?? ''] ?? OBJECT_KINDS['BASE TABLE'];
    if (filter && !name.toLowerCase().includes(filter) && !cols.some((c) => c.name.toLowerCase().includes(filter))) continue;
    if (!groups.has(kind.group)) groups.set(kind.group, []);
    groups.get(kind.group)!.push({ name, cols, kind });
  }
  const order = ['Tables', 'Views', 'Materialized views', 'External tables', 'Temporary tables'];
  let html = '';
  for (const g of order) {
    const items = groups.get(g);
    if (!items) continue;
    const collapsed = collapsedGroups.has(g);
    html += `<div class="tree-group${collapsed ? ' collapsed' : ''}" data-group="${esc(g)}"><div class="tree-label"><span>${collapsed ? '▸' : '▾'}</span>${esc(g)} <span class="count">${items.length}</span></div><div class="tree-items">`;
    for (const it of items) {
      const open = expanded.has(it.name) || (filter && it.cols.some((c) => c.name.toLowerCase().includes(filter)));
      const ext = it.kind.kind === 'external' ? app.schema.external.find((x) => x.table_name === it.name) : null;
      html += `<div class="tree-item${app.active?.objectName === it.name ? ' active' : ''}" role="treeitem" data-obj="${esc(it.name)}" title="${esc(it.name)}${ext ? ' → ' + esc(ext.location) : ''}">
        <span class="twisty" data-twisty>${open ? '▾' : '▸'}</span><span class="ico">${it.kind.ico}</span><span class="nm">${esc(it.name)}</span><span class="meta" title="${it.cols.length} columns">${it.cols.length}</span></div>`;
      if (open) {
        html += `<div class="tree-cols">${it.cols.map((c) => `<div class="tree-col" data-col="${esc(c.name)}" data-of="${esc(it.name)}">${c.pk ? '<span class="pk" title="primary key">⚿</span>' : '<span style="width:9px"></span>'}<span>${esc(c.name)}</span><span class="ty">${esc(c.type ?? '')}</span></div>`).join('')}</div>`;
      }
    }
    html += '</div></div>';
  }
  if (app.schema.connections?.length && !filter) {
    const g = 'Connections';
    const collapsed = collapsedGroups.has(g);
    html += `<div class="tree-group${collapsed ? ' collapsed' : ''}" data-group="${g}"><div class="tree-label"><span>${collapsed ? '▸' : '▾'}</span>${g} <span class="count">${app.schema.connections.length}</span></div><div class="tree-items">`;
    for (const c of app.schema.connections) html += `<div class="tree-item" data-conn="${esc(c.connection_name)}" title="${esc(c.url)}"><span class="twisty"></span><span class="ico">${icon('connection')}</span><span class="nm">${esc(c.connection_name)}</span><span class="meta">${c.credentials ? '🔑' : ''}</span></div>`;
    html += '</div></div>';
  }
  if (!html) {
    html = filter
      ? `<div class="tree-empty">Nothing matches “${esc(filter)}”.</div>`
      : `<div class="tree-empty">This database is empty.<br>Create a table in a query tab, or <a href="#" data-goto-import>import a file</a>.</div>`;
  }
  tree.innerHTML = html;
  $('[data-goto-import]', tree)?.addEventListener('click', (e) => {
    e.preventDefault();
    openImportTab();
  });
}

function wireTree() {
  const tree = $('#tree');
  tree.addEventListener('click', (e) => {
    const label = closest(e, '.tree-label');
    if (label) {
      const g = label.parentElement!.dataset.group!;
      collapsedGroups.has(g) ? collapsedGroups.delete(g) : collapsedGroups.add(g);
      prefs.set('collapsedGroups', [...collapsedGroups]);
      renderTree();
      return;
    }
    const item = closest(e, '[data-obj]');
    if (item) {
      const name = item.dataset.obj!;
      if (closest(e, '[data-twisty]')) {
        expanded.has(name) ? expanded.delete(name) : expanded.add(name);
        prefs.set('expanded', [...expanded]);
        renderTree();
      } else openTableTab(name);
      document.body.classList.remove('side-open');
      return;
    }
    const col = closest(e, '[data-col]');
    if (col) insertIntoEditor(quoteIdent(col.dataset.col!));
    const conn = closest(e, '[data-conn]');
    if (conn) {
      const c = app.schema.connections?.find((x) => x.connection_name === conn.dataset.conn!);
      if (c) showValue(`${c.url}${c.credentials ? `\ncredentials: ${c.credentials}` : ''}`, `Connection ${c.connection_name}`);
    }
  });
  tree.addEventListener('dblclick', (e) => {
    const item = closest(e, '[data-obj]');
    if (item && !closest(e, '[data-twisty]')) insertIntoEditor(quoteIdent(item.dataset.obj!));
  });
  tree.addEventListener('contextmenu', (e) => {
    const item = closest(e, '[data-obj]');
    const conn = closest(e, '[data-conn]');
    if (!item && !conn) return;
    e.preventDefault();
    if (conn) {
      const name = conn.dataset.conn!;
      contextMenu(e.clientX, e.clientY, [
        { label: 'Copy name', run: () => navigator.clipboard?.writeText(name) },
        { label: 'Script DROP CONNECTION', run: () => newQueryTab({ sql: `DROP CONNECTION ${quoteIdent(name)};\n` }) },
      ]);
      return;
    }
    if (item) objectMenu(item.dataset.obj!, e.clientX, e.clientY);
  });
  $('#treeFilter').addEventListener('input', renderTree);
  $('#btnRefreshTree').onclick = () => refreshSchema();
}

function objectMenu(name: string, x: number, y: number): void {
  const cols: SchemaTable = app.schema.tables.get(name) ?? [];
  const kind = cols.kind;
  const q = quoteIdent(name);
  const items: MenuItem[] = [
    { label: 'Open data', run: () => openTableTab(name) },
    { label: 'Query in new tab', run: () => newQueryTab({ sql: `SELECT *\nFROM ${q}\nLIMIT 100;\n`, run: true }) },
    { label: 'Insert name into editor', run: () => insertIntoEditor(q) },
    '-',
    { label: 'Script SELECT with columns', run: () => newQueryTab({ sql: `SELECT ${cols.map((c) => quoteIdent(c.name)).join(',\n       ')}\nFROM ${q};\n` }) },
  ];
  if (kind === 'table') {
    items.push({ label: 'Script INSERT', run: () => newQueryTab({ sql: `INSERT INTO ${q} (${cols.map((c) => quoteIdent(c.name)).join(', ')})\nVALUES (${cols.map(() => '?').join(', ')});\n` }) });
    items.push({ label: 'Script UPDATE', run: () => newQueryTab({ sql: `UPDATE ${q}\nSET ${cols.filter((c) => !c.pk).map((c) => `${quoteIdent(c.name)} = ?`).join(',\n    ')}\nWHERE ${cols.filter((c) => c.pk).map((c) => `${quoteIdent(c.name)} = ?`).join(' AND ') || '…'};\n` }) });
  }
  items.push({ label: 'Script CREATE (DDL)', run: async () => newQueryTab({ sql: (await ddlFor(name)) + '\n' }) });
  items.push({ label: 'Count rows', run: () => countRows(name) });
  if (kind === 'matview') items.push({ label: 'Refresh materialized view', run: () => runAdHoc(`REFRESH MATERIALIZED VIEW ${q}`) });
  items.push('-');
  items.push({ label: 'Export as CSV', run: () => exportObject(name, 'csv') });
  items.push({ label: 'Export as JSON', run: () => exportObject(name, 'json') });
  items.push('-');
  const dropKw = ({ table: 'TABLE', view: 'VIEW', matview: 'MATERIALIZED VIEW', external: 'EXTERNAL TABLE', temp: 'TABLE' } as Record<string, string>)[kind ?? ''] ?? 'TABLE';
  items.push({
    label: `Drop ${dropKw.toLowerCase()}…`,
    danger: true,
    run: async () => {
      const note = kind === 'external' ? 'Only the catalog entry is removed; the source file or URL is not touched.' : 'This deletes it and its data.';
      if (await confirmBox(`Drop ${name}`, `Run <code>DROP ${dropKw} ${esc(q)}</code>? ${note}`, 'Drop', true)) runAdHoc(`DROP ${dropKw} ${q}`);
    },
  });
  contextMenu(x, y, items);
}

async function ddlFor(name: string): Promise<string> {
  const r = await db().query('SELECT sql FROM sqlite_schema WHERE name = ?', [name], { rowMode: 'array' });
  const sql = r[0]?.[0];
  return typeof sql === 'string' && sql ? formatDdl(sql) + ';' : `-- no DDL recorded for ${name}`;
}

function formatDdl(sql: string): string {
  // Put each column definition of CREATE TABLE on its own line.
  const m = /^(\s*CREATE\s+(?:TEMP\w*\s+|LOOSE\s+)?TABLE\s+[^(]+)\(([\s\S]*)\)([^)]*)$/i.exec(sql);
  if (!m || m[2].includes('\n')) return sql;
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  let quote: string | null = null;
  for (const ch of m[2]) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  parts.push(cur.trim());
  return `${m[1].trim()} (\n  ${parts.join(',\n  ')}\n)${m[3]}`;
}

async function countRows(name: string): Promise<void> {
  try {
    const t0 = now();
    const r = await db().query(`SELECT count(*) FROM ${quoteIdent(name)}`, [], { rowMode: 'array' });
    toast(`${name}: ${fmtNum(Number(r[0][0]))} rows (${fmtMs(now() - t0)})`, 'ok');
  } catch (e) {
    toast(errText(e), 'err');
  }
}

async function exportObject(name: string, format: 'csv' | 'json'): Promise<void> {
  try {
    const text = format === 'csv' ? await exportCSV(db(), `SELECT * FROM ${quoteIdent(name)}`) : await exportJSON(db(), `SELECT * FROM ${quoteIdent(name)}`);
    download(`${name}.${format}`, text, format === 'csv' ? 'text/csv' : 'application/json');
  } catch (e) {
    toast(errText(e), 'err');
  }
}

async function runAdHoc(sql: string): Promise<void> {
  try {
    const t0 = now();
    await write((db) => db.exec(sql));
    status(`${leadingKeyword(sql)} done in ${fmtMs(now() - t0)}`);
    addHistory({ sql, db: app.dbName, at: Date.now(), ms: now() - t0 });
    if (changesSchema(sql)) await refreshSchema();
  } catch (e) {
    toast(errText(e), 'err');
  }
}

// ================================================================ tabs

let tabSeq = 0;

/** Put a tab (made with its own pane, see blankPane) on the page and show it. */
function addTab<T extends Tab>(tab: T): T {
  tab.id = ++tabSeq;
  $('#panes').appendChild(tab.el);
  app.tabs.push(tab);
  tab.init?.();
  renderTabs();
  activateTab(tab);
  return tab;
}

function renderTabs(): void {
  const strip = $('#tabs');
  strip.innerHTML = '';
  for (const t of app.tabs) {
    const el = h(`<div class="tab${t === app.active ? ' active' : ''}" role="tab" draggable="true" title="${esc(t.tooltip ?? t.title)}">
      <span class="tab-ico">${t.icon}</span><span class="tab-title">${esc(t.title)}</span>${t.busy ? '<span class="busy-dot"></span>' : ''}
      <button class="tab-close" title="Close (Ctrl+W)" aria-label="Close tab">${icon('close')}</button></div>`);
    el.onclick = (e) => {
      if (closest(e, '.tab-close')) closeTab(t);
      else activateTab(t);
    };
    el.onauxclick = (e) => e.button === 1 && closeTab(t);
    el.ondblclick = (e) => {
      if ((t.kind === 'query' || t.kind === 'ts') && !closest(e, '.tab-close')) renameTab(t);
    };
    el.ondragstart = (e) => e.dataTransfer?.setData('text/x-tab', String(t.id));
    el.ondragover = (e) => e.preventDefault();
    el.ondrop = (e) => {
      const id = Number(e.dataTransfer?.getData('text/x-tab'));
      const from = app.tabs.findIndex((x) => x.id === id);
      const to = app.tabs.indexOf(t);
      if (from < 0 || from === to) return;
      const [moved] = app.tabs.splice(from, 1);
      app.tabs.splice(to, 0, moved);
      renderTabs();
      saveQueryTabs();
    };
    strip.appendChild(el);
  }
  const plus = h(`<button class="icon" title="New query tab" aria-label="New query tab" style="align-self:center;margin-left:4px">${icon('plus')}</button>`);
  plus.onclick = () => newQueryTab();
  strip.appendChild(plus);
}

function activateTab(t: Tab): void {
  app.active = t;
  for (const x of app.tabs) x.el.classList.toggle('active', x === t);
  renderTabs();
  $('#tabs .tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  t.onShow?.();
  $$('#tree .tree-item').forEach((el) => el.classList.toggle('active', el.dataset.obj! === t.objectName));
}

function closeTab(t: Tab, silent = false): void {
  const i = app.tabs.indexOf(t);
  if (i < 0) return;
  t.dispose?.();
  t.el.remove();
  app.tabs.splice(i, 1);
  if (app.active === t) {
    const next = app.tabs[Math.min(i, app.tabs.length - 1)];
    if (next) activateTab(next);
    else if (!silent) newQueryTab();
    else app.active = null;
  }
  renderTabs();
  saveQueryTabs();
}

async function renameTab(t: Tab): Promise<void> {
  const name = await modal<string | null>({
    title: 'Rename tab',
    body: `<label class="field"><span>Title</span><input type="text" name="t" value="${esc(t.title)}"></label>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Rename', primary: true, value: (f) => f.t.value.trim() }],
  });
  if (name) {
    t.title = name;
    renderTabs();
    saveQueryTabs();
  }
}

function saveQueryTabs(): void {
  const tabs = app.tabs.filter((t): t is QueryTab => t.kind === 'query').map((t) => ({ title: t.title, sql: t.editor?.value ?? t.sql ?? '' }));
  prefs.set('queryTabs', tabs);
  prefs.set('tsTabs', app.tabs.filter((t): t is TsTab => t.kind === 'ts').map((t) => ({ title: t.title, source: t.editor?.value ?? t.source ?? '' })));
}

function insertIntoEditor(text: string): void {
  let t: QueryTab | undefined = app.active?.kind === 'query' ? app.active : [...app.tabs].reverse().find((x): x is QueryTab => x.kind === 'query');
  if (!t) t = newQueryTab();
  activateTab(t);
  t.editor.insert(text);
}

// ================================================================ TypeScript tab (smaltdf)
//
// An editor tab for TypeScript with smaltdf, beside the SQL tab: frames and expressions build plans, which run in the
// engine worker against the open database. Ctrl+Enter runs the whole tab. Its last expression, and every value passed
// to show(), is a result: frames are collected and shown as grids, writes report their row count, other values show as
// text. The types are stripped by sucrase; smaltdf and sucrase load from vendor/smaltdf/ on first use.

type DfModule = typeof Df;
let dfLoad: Promise<{ df: DfModule; transform: (code: string, o: object) => { code: string } }> | null = null;
const loadDf = () =>
  (dfLoad ??= Promise.all([import(/* @vite-ignore */ new URL('../vendor/smaltdf/smaltdf.js', import.meta.url).href), import(/* @vite-ignore */ new URL('../vendor/smaltdf/sucrase.js', import.meta.url).href)]).then(([df, su]) => ({ df: df as DfModule, transform: su.transform })));
let dfNames: { globals: string[]; members: string[] } = { globals: [], members: [] };
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...a: unknown[]) => Promise<unknown>;

/** The names TypeScript tabs complete: smaltdf's functions, and the methods of frames, expressions and group-bys. */
function tsNames(): { globals: string[]; members: string[] } {
  if (!dfNames.globals.length) {
    loadDf()
      .then(({ df }) => {
        const methods = (c: unknown) => (c && typeof c === 'function' ? Object.getOwnPropertyNames(c.prototype).filter((n) => n !== 'constructor' && !n.startsWith('_')) : []);
        dfNames = {
          globals: Object.keys(df).filter((k) => /^[a-z]/.test(k) && typeof (df as Record<string, unknown>)[k] === 'function'),
          members: [...new Set([...methods(df.Frame), ...methods(df.Expr), ...methods(df.GroupBy), ...methods(df.Write), 'str', 'dt'])].sort(),
        };
      })
      .catch(() => {});
  }
  return dfNames;
}

let tsSeq = 0;
const TS_STARTER = `// TypeScript with smaltdf: frames and expressions that run in the smaltdb engine.
// Ctrl+Enter runs the tab; its last expression is shown. show(value) shows more.
table('${'${table}'}').head(10)
`;

function newTsTab({ title, source }: { title?: string; source?: string } = {}): TsTab {
  const first = [...app.schema.tables.keys()][0] ?? 'my_table';
  const tab = tsTab(title ?? `TypeScript ${++tsSeq}`, source ?? TS_STARTER.replace('${table}', first));
  addTab(tab);
  saveQueryTabs();
  tab.editor.focus();
  return tab;
}

function tsTab(title: string, source: string): TsTab {
  const tab: TsTab = {
    id: 0,
    el: blankPane(),
    kind: 'ts',
    title,
    icon: icon('typescript'),
    tooltip: `${title}: TypeScript with smaltdf (double-click to rename)`,
    source,
    editor: assignedInInit<Editor>(),
    results: [],
    texts: [],
    planData: null,
    plan: null,
    messages: [],
    grids: [],
    busy: false,
    init() {
      const el = this.el;
      // A SQL tab's toolbar: Run, Explain, Analyze, Stop | Open, Save (no Format yet: no formatter is agreed for TypeScript).
      el.innerHTML = `
        <div class="toolbar">
          <button class="primary run-btn" data-run title="Run the tab (Ctrl+Enter)">▶ Run</button>
          <button data-explain title="Show the query plan of the tab's frame (Ctrl+E)">Explain</button>
          <button data-analyze title="EXPLAIN ANALYZE: run the frame and show estimated vs actual rows per operator">Analyze</button>
          <button data-stop disabled title="Cancel the running query (Esc)">■ Stop</button>
          <span class="sep"></span>
          <button class="ghost" data-open title="Open a .ts file">Open…</button>
          <button class="ghost" data-save title="Save as .ts (Ctrl+S)">Save</button>
          <span class="grow"></span>
          <span class="hint">TypeScript · <a href="https://stenhoor.github.io/smaltdf/" target="_blank" rel="noopener">smaltdf</a>: <code>table</code>, <code>col</code>, <code>lit</code>, <code>len</code>, … · <code>db</code> · <code>show()</code></span>
        </div>
        <div class="qsplit">
          <div class="ed-host"></div>
          <div class="hsplitter" title="Drag to resize"></div>
          <div class="results">
            <div class="subtabs"></div>
            <div class="subpanes"></div>
          </div>
        </div>`;
      this.editor = new Editor($('.ed-host', el), {
        value: this.source,
        language: 'ts',
        tsNames,
        schema: () => app.schema,
        onChange: debounce(() => saveQueryTabs(), 400),
        keys: {
          'Mod+Enter': () => void this.run(),
          'Shift+Mod+Enter': () => void this.run(),
          F5: () => void this.run(),
          'Mod+E': () => void this.run('plan'),
          'Mod+S': () => this.save(),
          Escape: () => this.stop(),
        },
      });
      const split = $('.qsplit', el);
      split.style.setProperty('--ed-h', prefs.get('editorHeight', '42%'));
      dragSplit(
        $('.hsplitter', el),
        (ev) => {
          const r = split.getBoundingClientRect();
          split.style.setProperty('--ed-h', Math.max(12, Math.min(85, ((ev.clientY - r.top) / r.height) * 100)) + '%');
        },
        () => prefs.set('editorHeight', split.style.getPropertyValue('--ed-h')),
      );
      $('[data-run]', el).onclick = () => void this.run();
      $('[data-explain]', el).onclick = () => void this.run('plan');
      $('[data-analyze]', el).onclick = () => void this.run('analyze');
      $('[data-stop]', el).onclick = () => this.stop();
      $('[data-save]', el).onclick = () => this.save();
      $('[data-open]', el).onclick = () => this.openFile();
      tsNames();
      this.renderResults();
    },
    onShow() {
      requestAnimationFrame(() => {
        this.editor.render();
        this.editor.focus();
        this.grids.forEach((g) => g.renderRows(true));
      });
    },
    onSchema() {
      this.editor.render();
    },
    stop() {
      this.abort?.abort();
    },
    setBusy(b: boolean) {
      this.busy = b;
      for (const sel of ['[data-run]', '[data-explain]', '[data-analyze]']) $(sel, this.el).disabled = b;
      $('[data-stop]', this.el).disabled = !b;
      setDbIndicator(b ? 'busy' : 'on', app.dbName, app.storage);
      renderTabs();
    },
    /**
     * Run the tab. With mode 'plan' or 'analyze', the tab's frame (its last expression, or the last value shown) is not
     * collected: its plan runs as EXPLAIN (or EXPLAIN ANALYZE), and the result shows as a SQL tab's does.
     */
    async run(mode: 'run' | 'plan' | 'analyze' = 'run') {
      if (this.busy) return;
      if (!app.db) return void toast('No database is open', 'err');
      this.abort = new AbortController();
      const signal = this.abort.signal;
      this.setBusy(true);
      const t0 = now();
      const code = this.editor.value;
      saveQueryTabs();
      this.results = [];
      this.texts = [];
      this.planData = null;
      this.plan = null;
      const at = timeOfDay();
      try {
        const { df, transform } = await loadDf();
        // smaltdf's names are in scope already, so `import { … } from '@smaltdb/df'` is optional: a plain import is
        // dropped, and `x as y` becomes `const y = __df.x`. Nothing else can be imported here.
        const src = code.replace(/^[ \t]*import\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]@smaltdb\/df['"];?/gm, (_m, type: string | undefined, names: string) =>
          type
            ? ''
            : names
                .split(',')
                .map((n) => /^\s*(\w+)\s+as\s+(\w+)\s*$/.exec(n))
                .filter((m): m is RegExpExecArray => !!m)
                .map((m) => `const ${m[2]} = __df.${m[1]};`)
                .join(' '),
        );
        if (/^[ \t]*import\s/m.test(src)) throw new Error("Only smaltdf can be imported in a TypeScript tab: import { … } from '@smaltdb/df'");
        const js = transform(src, { transforms: ['typescript'], disableESTransforms: true }).code;
        const { body, expr } = splitLastExpression(js);
        const shown: { value: unknown; title?: string }[] = [];
        const show = (value: unknown, title?: string) => void shown.push({ value, title });
        const names = Object.keys(df).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n) && !['db', 'show'].includes(n));
        const sdb = cancellable(db(), signal);
        const fn = new AsyncFunction('__df', 'db', 'show', ...names, `${body}\n${expr ? `return (${expr});` : ''}`);
        const value = await fn(df, sdb, show, ...names.map((n) => (df as Record<string, unknown>)[n]));
        if (expr) shown.push({ value, title: 'Result' });
        if (mode !== 'run') {
          const frame = [...shown].reverse().find((x) => x.value instanceof df.Frame)?.value as Df.Frame | undefined;
          if (!frame) throw new Error(`${mode === 'plan' ? 'Explain' : 'Analyze'} needs a frame: end the tab with one, or show() one`);
          const stmt = (await frame.plan(sdb)) as { kind?: string };
          this.planData = planJson(stmt);
          if (stmt.kind !== 'query') throw new Error(`${mode === 'plan' ? 'Explain' : 'Analyze'} needs a query; this frame's plan is a ${stmt.kind ?? 'statement'}`);
          const r = (await db().queryPlan({ kind: 'explain', mode, query: stmt } as Smaltdb.PlanStatementInput, [], { rowMode: 'array', signal })) as unknown as Row[] & { columns: string[] };
          this.plan = { sql: code, rows: [...r], columns: r.columns, analyze: mode === 'analyze' };
          this.messages.unshift({ kind: 'ok', text: `${mode === 'plan' ? 'Plan' : 'Analyze'} ready (${fmtMs(now() - t0)})`, sql: code, at });
        } else {
          for (const [i, { value: v, title: t }] of shown.entries()) await this.addResult(df, v, t ?? `Shown ${i + 1}`, sdb);
          const ms = now() - t0;
          const what = this.results.length ? `${this.results.length} result${this.results.length === 1 ? '' : 's'}` : this.texts.length ? 'done' : 'done, no value';
          this.messages.unshift({ kind: 'ok', text: `${what} in ${fmtMs(ms)}`, sql: code, at });
          status(`TypeScript: ${what} in ${fmtMs(ms)}`);
        }
        addHistory({ sql: `// TypeScript\n${code}`, db: app.dbName, at: Date.now(), ms: now() - t0 });
        await refreshSchema();
      } catch (e) {
        const text = signal.aborted ? 'Cancelled' : errText(e);
        this.messages.unshift({ kind: signal.aborted ? 'warn' : 'err', text, sql: code, at });
        status(text, signal.aborted ? '' : 'err');
      } finally {
        this.setBusy(false);
        this.renderResults(this.plan ? 'plan' : this.results.length ? 'r0' : this.texts.length ? 't0' : 'messages');
      }
    },
    async addResult(df: DfModule, v: unknown, title: string, sdb: Database) {
      const t0 = now();
      if (v instanceof df.Frame) {
        this.planData = planJson(await v.plan(sdb));
        v = await v.collect(sdb);
      }
      if (v instanceof df.Write) v = await v.run(sdb);
      if (v && typeof v === 'object' && Array.isArray((v as Df.DfResult).columns) && Array.isArray((v as Df.DfResult).rows)) {
        const r = v as Df.DfResult;
        this.results.push({ title, columns: r.columns, rows: r.rows.map((row) => row.map(toCell)), ms: now() - t0 });
      } else if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
        const columns = [...new Set(v.flatMap((x) => Object.keys(x as object)))];
        this.results.push({ title, columns, rows: v.map((x) => columns.map((c) => toCell((x as Record<string, unknown>)[c]))), ms: now() - t0 });
      } else if (v !== undefined) {
        const text = v && typeof v === 'object' && 'rows' in v && Object.keys(v).length === 1 ? `${fmtNum((v as { rows: number }).rows)} row(s) written` : typeof v === 'string' ? v : stringify(v);
        this.texts.push({ title, text });
      }
    },
    renderResults(view = 'messages') {
      const tabsEl = $('.subtabs', this.el);
      const panes = $('.subpanes', this.el);
      tabsEl.innerHTML = '';
      panes.innerHTML = '';
      this.grids = [];
      const views: { key: string; label: string; badge?: string; err?: boolean; build: (pane: HTMLElement) => void }[] = [];
      this.results.forEach((res, i) => {
        views.push({
          key: 'r' + i,
          label: res.title,
          badge: fmtNum(res.rows.length),
          build: (pane) => {
            const gh = pane.appendChild(h('<div class="grid"></div>'));
            const grid = new Grid(gh, { onOpenValue: (r, c) => showValue(res.rows[r][c], res.columns[c]) });
            grid.setData(res.columns, res.rows);
            this.grids.push(grid);
            pane.appendChild(h(`<div class="result-bar"><span>${fmtNum(res.rows.length)} row${res.rows.length === 1 ? '' : 's'} · ${res.columns.length} column${res.columns.length === 1 ? '' : 's'} · ${fmtMs(res.ms)}</span></div>`));
          },
        });
      });
      this.texts.forEach((t, i) => views.push({ key: 't' + i, label: t.title, build: (pane) => void (pane.appendChild(h('<pre class="plan"></pre>')).textContent = t.text) }));
      // Plan / Analyze: the engine's EXPLAIN, shown as a SQL tab shows it.
      if (this.plan) views.push({ key: 'plan', label: this.plan.analyze ? 'Analyze' : 'Plan', build: (pane) => planView(pane, this.plan!) });
      // Plan data: the plan statement smaltdf built and sent to the engine.
      if (this.planData) views.push({ key: 'plandata', label: 'Plan data', build: (pane) => void (pane.appendChild(h('<pre class="plan"></pre>')).textContent = this.planData) });
      views.push({
        key: 'messages',
        label: 'Messages',
        badge: this.messages.length ? String(this.messages.length) : '',
        err: this.messages[0]?.kind === 'err',
        build: (pane) => {
          const box = pane.appendChild(h('<div class="messages"></div>'));
          box.innerHTML = this.messages.length
            ? this.messages.map((m) => `<div class="msg ${m.kind}"><span class="t">${m.at}</span><div><span class="b">${esc(m.text)}</span></div></div>`).join('')
            : `<div class="placeholder"><h3>Ready</h3>Write TypeScript with smaltdf above and press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to run it,<br>or <kbd>Ctrl</kbd>+<kbd>E</kbd> to explain its frame. The last expression is shown; <code>show(value)</code> shows more. <kbd>Ctrl</kbd>+<kbd>Space</kbd> completes names.</div>`;
        },
      });
      for (const v of views) {
        const b = h(`<button class="subtab${v.err ? ' err' : ''}" data-view="${v.key}">${esc(v.label)}${v.badge ? `<span class="badge">${esc(v.badge)}</span>` : ''}</button>`);
        const pane = h(`<div class="subpane" data-pane="${v.key}"></div>`);
        v.build(pane);
        tabsEl.appendChild(b);
        panes.appendChild(pane);
        b.onclick = () => show(v.key);
      }
      const show = (key: string) => {
        $$('.subtab', tabsEl).forEach((x) => x.classList.toggle('active', x.dataset.view! === key));
        $$('.subpane', panes).forEach((x) => x.classList.toggle('active', x.dataset.pane! === key));
        this.grids.forEach((g) => g.renderRows(true));
      };
      show(views.some((v) => v.key === view) ? view : views[0].key);
    },
    save() {
      download((this.title.replace(/[^\w.-]+/g, '_') || 'frames') + '.ts', this.editor.value, 'text/typescript');
    },
    openFile() {
      const input = h<HTMLInputElement>('<input type="file" accept=".ts,.js,text/plain">');
      input.onchange = async () => {
        const f = input.files?.[0];
        if (!f) return;
        this.editor.replaceAll(await f.text());
        this.title = f.name.replace(/\.(ts|js)$/, '');
        renderTabs();
        saveQueryTabs();
      };
      input.click();
    },
  } as TsTab;
  return tab;
}

/** The plan statement smaltdf built, as JSON (bigints as strings). */
function planJson(stmt: unknown): string {
  return JSON.stringify(stmt, (_k, x) => (typeof x === 'bigint' ? x.toString() : x), 2);
}

/**
 * The database as a TypeScript tab's code sees it: every query and statement it sends carries the tab's cancel signal,
 * so Stop (Esc) interrupts what the engine is running. smaltdf's collect() and run() take no signal of their own.
 */
function cancellable(target: Database, signal: AbortSignal): Database {
  const withSignal = new Set(['query', 'queryPlan', 'stream', 'streamPlan', 'exec']);
  return new Proxy(target, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      if (typeof v !== 'function') return v;
      if (typeof k === 'string' && withSignal.has(k)) {
        return (a: unknown, params?: unknown, options: Record<string, unknown> = {}) => (v as (...x: unknown[]) => unknown).call(t, a, params, { ...options, signal });
      }
      return (v as (...x: unknown[]) => unknown).bind(t);
    },
  });
}

/** A Plan / Analyze result: the EXPLAIN tree when it has one, else a grid (both tabs show it this way). */
function planView(pane: HTMLElement, p: PlanResult): void {
  const cols = p.columns ?? [];
  if (cols.includes('detail') && cols.includes('parent') && !p.analyze) {
    pane.appendChild(h('<div class="plan"></div>')).textContent = planTree(p.rows, cols);
  } else {
    new Grid(pane.appendChild(h('<div class="grid"></div>'))).setData(cols, p.rows);
  }
}

function toCell(v: unknown): Value {
  if (v === null || v === undefined || typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint' || v instanceof Uint8Array) return (v ?? null) as Value;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return v.toISOString();
  return stringify(v);
}

function stringify(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x), 2) ?? String(v);
  } catch {
    return String(v);
  }
}

// ================================================================ query tab

let querySeq = 0;
const FETCH_ROWS = 1000;

function newQueryTab({ title, sql = '', run = false }: { title?: string; sql?: string; run?: boolean } = {}): QueryTab {
  const tab = queryTab(title ?? `Query ${++querySeq}`, sql);
  addTab(tab);
  saveQueryTabs();
  if (run) tab.run('statement');
  else tab.editor.focus();
  return tab;
}

function queryTab(title: string, sql: string): QueryTab {
  const tab: QueryTab = {
    id: 0,
    el: blankPane(),
    kind: 'query',
    title,
    icon: icon('query'),
    sql,
    editor: assignedInInit<Editor>(),
    results: [],
    messages: [],
    binds: {},
    plan: null,
    errorAt: null,
    grids: [],
    busy: false,
    init() {
      const el = this.el;
      el.innerHTML = `
        <div class="toolbar">
          <button class="primary run-btn" data-run title="Run statement at cursor, or the selection (Ctrl+Enter)">▶ Run</button>
          <button data-script title="Run the whole script, statement by statement (Ctrl+Shift+Enter / F5)">▶▶ Script</button>
          <button data-explain title="Show the query plan (Ctrl+E)">Explain</button>
          <button data-analyze title="EXPLAIN ANALYZE: run it and show estimated vs actual rows per operator">Analyze</button>
          <button data-stop disabled title="Cancel the running statement (Esc)">■ Stop</button>
          <span class="sep"></span>
          <button class="ghost" data-format title="Format SQL (Ctrl+Shift+F)">Format</button>
          <button class="ghost" data-open title="Open a .sql file">Open…</button>
          <button class="ghost" data-save title="Save as .sql (Ctrl+S)">Save</button>
          <span class="grow"></span>
          <label class="hint"><input type="checkbox" data-continue> continue script on error</label>
        </div>
        <div class="qsplit">
          <div class="ed-host"></div>
          <div class="hsplitter" title="Drag to resize"></div>
          <div class="results">
            <div class="subtabs"></div>
            <div class="subpanes"></div>
          </div>
        </div>`;
      const host = $('.ed-host', el);
      this.editor = new Editor(host, {
        value: this.sql,
        schema: () => app.schema,
        onChange: debounce(() => saveQueryTabs(), 400),
        keys: {
          'Mod+Enter': () => this.run('statement'),
          'Shift+Mod+Enter': () => this.run('script'),
          F5: () => this.run('script'),
          'Mod+E': () => this.run('statement', 'plan'),
          'Shift+Mod+F': () => this.format(),
          'Mod+S': () => this.save(),
          Escape: () => this.stop(),
        },
      });
      const split = $('.qsplit', el);
      split.style.setProperty('--ed-h', prefs.get('editorHeight', '42%'));
      dragSplit(
        $('.hsplitter', el),
        (ev) => {
          const r = split.getBoundingClientRect();
          const pct = Math.max(12, Math.min(85, ((ev.clientY - r.top) / r.height) * 100));
          split.style.setProperty('--ed-h', pct + '%');
        },
        () => prefs.set('editorHeight', split.style.getPropertyValue('--ed-h')),
      );
      $('[data-run]', el).onclick = () => this.run('statement');
      $('[data-script]', el).onclick = () => this.run('script');
      $('[data-explain]', el).onclick = () => this.run('statement', 'plan');
      $('[data-analyze]', el).onclick = () => this.run('statement', 'analyze');
      $('[data-stop]', el).onclick = () => this.stop();
      $('[data-format]', el).onclick = () => this.format();
      $('[data-save]', el).onclick = () => this.save();
      $('[data-open]', el).onclick = () => this.openFile();
      this.renderResults();
    },
    onShow() {
      requestAnimationFrame(() => {
        this.editor.render();
        this.editor.focus();
        this.grids?.forEach((g) => g.renderRows(true));
      });
    },
    onSchema() {
      this.editor.render();
    },
    format() {
      const sel = this.editor.selection();
      if (sel) this.editor.insert(formatSql(sel).trimEnd());
      else this.editor.replaceAll(formatSql(this.editor.value));
    },
    save() {
      const name = (this.title.replace(/[^\w.-]+/g, '_') || 'query') + '.sql';
      download(name, this.editor.value, 'application/sql');
    },
    async openFile() {
      const picked = await pickLocalFile('.sql,.txt');
      if (!picked) return;
      this.editor.replaceAll(await picked.file.text());
      this.title = picked.file.name.replace(/\.sql$/i, '');
      renderTabs();
      saveQueryTabs();
    },
    stop() {
      this.abort?.abort();
    },
    setBusy(b) {
      this.busy = b;
      $('[data-stop]', this.el).disabled = !b;
      $('[data-run]', this.el).disabled = b;
      $('[data-script]', this.el).disabled = b;
      setDbIndicator(b ? 'busy' : 'on', app.dbName, app.storage);
      renderTabs();
    },
    async run(scope, mode = 'run') {
      if (this.busy) return;
      if (!app.db) return toast('No database is open', 'err');
      const text = this.editor.value;
      const range = this.editor.selectionRange();
      let stmts;
      if (range.start !== range.end) stmts = splitStatements(text.slice(range.start, range.end)).map((s) => ({ ...s, start: s.start + range.start, end: s.end + range.start }));
      else if (scope === 'script') stmts = splitStatements(text);
      else {
        const s = this.editor.currentStatement();
        stmts = s ? [s] : [];
      }
      if (!stmts.length) return status('Nothing to run');
      if (mode !== 'run') stmts = stmts.slice(0, 1);
      await closeStreams();
      this.abort = new AbortController();
      const signal = this.abort.signal;
      this.setBusy(true);
      this.results = [];
      this.plan = null;
      this.messages = [];
      this.errorAt = null;
      const scriptT0 = now();
      let schemaChanged = false;
      let failed = 0;
      const continueOnError = $('[data-continue]', this.el).checked;
      for (const st of stmts) {
        if (signal.aborted) break;
        let sql = st.sql;
        if (mode === 'plan') sql = 'EXPLAIN QUERY PLAN ' + sql;
        if (mode === 'analyze') sql = 'EXPLAIN ANALYZE ' + sql;
        const slots = scanParams(st.sql);
        let params: SqlValue[] | undefined;
        if (slots.length) {
          const values = await this.askBinds(slots);
          if (values === null) {
            this.messages.push({ kind: 'warn', text: 'Cancelled (no bind values)', sql: st.sql, at: timeOfDay() });
            break;
          }
          params = values;
        }
        const t0 = now();
        try {
          if (mode === 'plan') {
            const r = await db().query(sql, params, { rowMode: 'array', signal });
            this.plan = { sql: st.sql, rows: r, columns: r.columns };
            this.messages.push({ kind: 'ok', text: `Plan ready (${fmtMs(now() - t0)})`, sql: st.sql, at: timeOfDay() });
          } else if (returnsRows(sql)) {
            const res = await this.fetchResult(sql, params, signal, st === stmts[stmts.length - 1]);
            res.ms = now() - t0;
            res.sql = st.sql;
            this.results.push(res);
            if (mode === 'analyze') this.plan = { sql: st.sql, rows: res.rows, columns: res.columns, analyze: true };
            this.messages.push({ kind: 'ok', text: `${fmtNum(res.rows.length)}${res.more ? '+' : ''} row${res.rows.length === 1 ? '' : 's'} in ${fmtMs(res.ms)}`, sql: st.sql, at: timeOfDay() });
          } else {
            const r = await write((db) => db.exec(sql, params, { signal }));
            const kw = leadingKeyword(sql);
            const ms = now() - t0;
            const what = ['INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'WITH'].includes(kw) ? `${fmtNum(r.changes)} row${r.changes === 1 ? '' : 's'} affected` : `${kw || 'Statement'} OK`;
            this.messages.push({ kind: 'ok', text: `${what} (${fmtMs(ms)})`, sql: st.sql, at: timeOfDay() });
            if (changesSchema(sql)) schemaChanged = true;
          }
          addHistory({ sql: st.sql, db: app.dbName, at: Date.now(), ms: now() - t0 });
        } catch (e) {
          failed++;
          this.messages.push({ kind: 'err', text: errText(e), sql: st.sql, at: timeOfDay() });
          addHistory({ sql: st.sql, db: app.dbName, at: Date.now(), error: errText(e) });
          this.markError(st, e);
          if (!continueOnError || (e as { code?: string }).code === 'SMALT_INTERRUPT') break;
        }
      }
      const total = now() - scriptT0;
      this.setBusy(false);
      $('#stTiming').textContent = `${stmts.length > 1 ? stmts.length + ' statements · ' : ''}${fmtMs(total)}`;
      if (failed) status(`${failed} statement${failed > 1 ? 's' : ''} failed`, 'err');
      else status(stmts.length > 1 ? `Script finished: ${stmts.length} statements` : this.messages.at(-1)?.text ?? 'Done');
      const view = mode !== 'run' ? 'plan' : failed && !this.results.length ? 'messages' : this.results.length ? 'r0' : 'messages';
      this.renderResults(view);
      if (schemaChanged) refreshSchema();
    },
    markError(st, e) {
      const m = /line (\d+), column (\d+)/.exec((e as Error | null)?.message ?? '');
      let start = st.start;
      let end = st.end;
      if (m) {
        const lines = st.sql.split('\n');
        const line = Number(m[1]) - 1;
        const col = Number(m[2]) - 1;
        let off = 0;
        for (let i = 0; i < line && i < lines.length; i++) off += lines[i].length + 1;
        off += col;
        const tail = st.sql.slice(off);
        const len = Math.max(1, (/^[\w$]+|^\S/.exec(tail)?.[0] ?? ' ').length);
        start = st.start + off;
        end = Math.min(st.end, start + len);
      }
      this.editor.highlightRange(start, end);
    },
    async askBinds(slots) {
      const body = `<p>The statement has parameters. Empty values with type “auto” are sent as NULL.</p>` +
        slots
          .map((s, i) => {
            const prev = this.binds[s.label] ?? { v: '', t: 'auto' };
            return `<div class="row"><label class="field"><span class="mono">${esc(s.label)}</span><input type="text" name="v${i}" value="${esc(prev.v)}"></label>
              <label class="field" style="flex:0 0 120px"><span>Type</span><select name="t${i}">${['auto', 'text', 'integer', 'real', 'null'].map((t) => `<option ${t === prev.t ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>`;
          })
          .join('');
      return modal({
        title: 'Bind variables',
        body,
        buttons: [
          { label: 'Cancel', value: null },
          {
            label: 'Run',
            primary: true,
            value: (f) => {
              const vals: SqlValue[] = [];
              slots.forEach((s, i) => {
                const v = f[`v${i}`].value;
                const t = f[`t${i}`].value;
                this.binds[s.label] = { v, t };
                vals[s.index - 1] = coerce(v, t);
              });
              return vals;
            },
          },
        ],
      });
    },
    async fetchResult(sql, params, signal, keepOpen) {
      const it = db().stream(sql, params, { rowMode: 'array', signal, batchSize: 500 });
      const res: ResultSet = { columns: [], rows: [], more: null, sql };
      let gotColumns = false;
      let done = false;
      while (res.rows.length < FETCH_ROWS) {
        const n = await it.next();
        if (n.done) {
          done = true;
          break;
        }
        if (!gotColumns) {
          res.columns = n.value.columns;
          gotColumns = true;
        }
        for (const r of n.value) res.rows.push(r);
      }
      if (!gotColumns) {
        try {
          const st = await db().prepare(sql);
          res.columns = st.columns ?? [];
          await st.finalize();
        } catch {
          res.columns = [];
        }
      }
      if (!done) {
        if (keepOpen) {
          const cursor: OpenCursor = {
            it,
            close: async () => {
              res.more = null;
              res.closed = true;
              await it.return?.();
              this.refreshResultBar();
            },
          };
          res.more = cursor;
          app.streams.add(cursor);
        } else {
          await it.return?.();
          res.closed = true;
        }
      }
      return res;
    },
    async fetchMore(res, all = false) {
      const cursor = res.more;
      if (!cursor) return;
      const grid = this.grids[this.results.indexOf(res)];
      const t0 = now();
      let n = 0;
      try {
        while (all || n < FETCH_ROWS) {
          const x = await cursor.it.next();
          if (x.done) {
            app.streams.delete(cursor);
            res.more = null;
            break;
          }
          for (const r of x.value) res.rows.push(r); // the grid shares res.rows
          grid.refresh();
          n += x.value.length;
          if (all && n % 20000 < 500) this.refreshResultBar();
        }
      } catch (e) {
        app.streams.delete(cursor);
        res.more = null;
        toast(errText(e), 'err');
      }
      status(`Fetched ${fmtNum(n)} more rows in ${fmtMs(now() - t0)}`);
      this.refreshResultBar();
    },
    renderResults(view = 'messages') {
      const tabsEl = $('.subtabs', this.el);
      const panes = $('.subpanes', this.el);
      tabsEl.innerHTML = '';
      panes.innerHTML = '';
      this.grids = [];
      const views: { key: string; label: string; badge?: string; err?: boolean; build: (pane: HTMLElement) => void }[] = [];
      this.results.slice(0, 20).forEach((res, i) => {
        views.push({
          key: 'r' + i,
          label: this.results.length > 1 ? `Result ${i + 1}` : 'Result',
          badge: fmtNum(res.rows.length) + (res.more ? '+' : ''),
          build: (pane) => {
            const gridHost = h('<div class="grid"></div>');
            pane.appendChild(gridHost);
            const grid = new Grid(gridHost, { onOpenValue: (r, c) => showValue(res.rows[r][c], res.columns[c]) });
            grid.setData(res.columns, res.rows);
            this.grids[i] = grid;
            const bar = h(`<div class="result-bar" data-bar="${i}"></div>`);
            pane.appendChild(bar);
            this.fillBar(bar, res, grid);
          },
        });
      });
      views.push({
        key: 'messages',
        label: 'Messages',
        badge: this.messages.length ? String(this.messages.length) : '',
        err: this.messages.some((m) => m.kind === 'err'),
        build: (pane) => {
          const box = h('<div class="messages"></div>');
          box.innerHTML = this.messages.length
            ? this.messages.map((m) => `<div class="msg ${m.kind}"><span class="t">${m.at}</span><div><span class="b">${esc(m.text)}</span><code class="sql">${esc(m.sql.length > 300 ? m.sql.slice(0, 300) + '…' : m.sql)}</code></div></div>`).join('')
            : `<div class="placeholder"><h3>Ready</h3>Write SQL above and press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to run the statement under the cursor,<br>or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd> to run the whole script. <kbd>Ctrl</kbd>+<kbd>Space</kbd> completes names.</div>`;
          pane.appendChild(box);
        },
      });
      if (this.plan) {
        views.push({
          key: 'plan',
          label: this.plan.analyze ? 'Analyze' : 'Plan',
          build: (pane) => planView(pane, this.plan!),
        });
      }
      for (const v of views) {
        const b = h(`<button class="subtab${v.err ? ' err' : ''}" data-view="${v.key}">${esc(v.label)}${v.badge ? `<span class="badge">${esc(v.badge)}</span>` : ''}</button>`);
        const pane = h(`<div class="subpane" data-pane="${v.key}"></div>`);
        v.build(pane);
        tabsEl.appendChild(b);
        panes.appendChild(pane);
        b.onclick = () => show(v.key);
      }
      const show = (key: string) => {
        $$('.subtab', tabsEl).forEach((x) => x.classList.toggle('active', x.dataset.view! === key));
        $$('.subpane', panes).forEach((x) => x.classList.toggle('active', x.dataset.pane! === key));
        this.grids.forEach((g) => g.renderRows(true));
      };
      show(views.some((v) => v.key === view) ? view : views[0].key);
    },
    refreshResultBar() {
      this.results.forEach((res, i) => {
        const bar = $(`[data-bar="${i}"]`, this.el);
        if (bar) this.fillBar(bar, res, this.grids[i]);
        const badge = $(`.subtab[data-view="r${i}"] .badge`, this.el);
        if (badge) badge.textContent = fmtNum(res.rows.length) + (res.more ? '+' : '');
      });
    },
    fillBar(bar, res, grid) {
      bar.innerHTML = `<span>${fmtNum(res.rows.length)} row${res.rows.length === 1 ? '' : 's'}${res.more ? ' fetched — more available' : res.closed ? ' (cursor closed; re-run to fetch more)' : ''} · ${res.columns.length} column${res.columns.length === 1 ? '' : 's'} · ${fmtMs(res.ms ?? 0)}</span>
        ${res.more ? '<button data-more>Fetch more</button><button data-all>Fetch all</button>' : ''}
        <span class="grow"></span>
        <button data-copy title="Copy as tab-separated text (paste into a spreadsheet)">Copy</button>
        <button data-x="csv">CSV</button><button data-x="json">JSON</button><button data-x="sql" title="INSERT statements">SQL</button>
        <button data-totable title="Save the fetched rows as a new table">Save as table…</button>`;
      $('[data-more]', bar)?.addEventListener('click', () => this.fetchMore(res));
      $('[data-all]', bar)?.addEventListener('click', () => this.fetchMore(res, true));
      $('[data-copy]', bar).onclick = () => {
        navigator.clipboard?.writeText(exportRows('tsv', res.columns, grid.viewRows()));
        toast('Copied ' + fmtNum(res.rows.length) + ' rows');
      };
      $$('[data-x]', bar).forEach(
        (b) =>
          (b.onclick = () => {
            const f = b.dataset.x!;
            download(`result.${f}`, exportRows(f as ExportFormat, res.columns, grid.viewRows(), 'result'), f === 'json' ? 'application/json' : f === 'csv' ? 'text/csv' : 'text/plain');
          }),
      );
      $('[data-totable]', bar).onclick = () => saveResultAsTable(res, grid);
    },
    dispose() {
      this.abort?.abort();
    },
  };
  return tab;
}

/** A bind value from its text and chosen type ('auto' guesses numbers; empty is NULL). */
function coerce(v: string, t: string): SqlValue {
  if (t === 'null') return null;
  if (t === 'text') return v;
  if (t === 'integer') return /^-?\d+$/.test(v.trim()) && !Number.isSafeInteger(Number(v)) ? BigInt(v.trim()) : Math.trunc(Number(v));
  if (t === 'real') return Number(v);
  if (v === '') return null;
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v.trim())) {
    const n = Number(v);
    if (/^-?\d+$/.test(v.trim()) && !Number.isSafeInteger(n)) return BigInt(v.trim());
    return n;
  }
  return v;
}

function planTree(rows: Row[], cols: string[]): string {
  const id = cols.indexOf('id');
  const parent = cols.indexOf('parent');
  const detail = cols.indexOf('detail');
  const children = new Map<Value, Row[]>();
  for (const r of rows) {
    const p = r[parent];
    if (!children.has(p)) children.set(p, []);
    children.get(p)!.push(r);
  }
  const ids = new Set(rows.map((r) => r[id]));
  const roots = rows.filter((r) => !ids.has(r[parent]));
  let out = 'QUERY PLAN\n';
  const walk = (r: Row, prefix: string, last: boolean): void => {
    out += `${prefix}${last ? '└── ' : '├── '}${r[detail]}\n`;
    const kids = children.get(r[id]) ?? [];
    kids.forEach((k, i) => walk(k, prefix + (last ? '    ' : '│   '), i === kids.length - 1));
  };
  roots.forEach((r, i) => walk(r, '', i === roots.length - 1));
  return out;
}

async function saveResultAsTable(res: ResultSet, grid: Grid): Promise<void> {
  const name = await modal({
    title: 'Save result as table',
    body: `<p>Creates a table from the ${fmtNum(res.rows.length)} fetched rows (column types are inferred).</p><label class="field"><span>Table name</span><input type="text" name="n" value="result_${Date.now().toString(36).slice(-4)}"></label>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Create', primary: true, value: (f) => f.n.value.trim() }],
  });
  if (!name) return;
  try {
    const cols = res.columns.map((c, i) => (res.columns.indexOf(c) !== i ? `${c}_${i + 1}` : c));
    const data = grid.viewRows().map((r) => Object.fromEntries(cols.map((c, i) => { const v = r[i]; return [c, typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? null : v]; })));
    const r = await write((db) => importJSON(db, name, JSON.stringify(data), { create: true }));
    toast(`Created ${name} with ${fmtNum(r.rows)} rows`, 'ok');
    await refreshSchema();
  } catch (e) {
    toast(errText(e), 'err');
  }
}

function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

// ================================================================ table viewer tab

function openTableTab(name: string): void {
  const existing = app.tabs.find((t) => t.kind === 'table' && t.objectName === name);
  if (existing) return activateTab(existing);
  addTab(tableTab(name));
}

function tableTab(name: string): TableTab {
  const tab: TableTab = {
    id: 0,
    el: blankPane(),
    kind: 'table',
    objectName: name,
    kindName: 'table',
    title: name,
    icon: icon('table'),
    grid: assignedInInit<Grid>(),
    where: '',
    sort: null,
    limit: prefs.get<number>('pageSize', 200),
    offset: 0,
    total: null,
    rows: [],
    columns: [],
    view: 'data',
    init() {
      const cols = app.schema.tables.get(name);
      this.icon = OBJECT_KINDS[cols?.type ?? '']?.ico ?? icon('table');
      this.kindName = cols?.kind ?? 'table';
      this.tooltip = `${name} (${(cols?.type ?? 'table').toLowerCase()})`;
      this.el.innerHTML = `
        <div class="toolbar">
          <button data-refresh title="Reload (F5)">↻</button>
          <input type="text" class="filter-input" data-where placeholder="WHERE …   e.g. price > 10 AND name LIKE 'a%'" aria-label="Filter (SQL WHERE clause)">
          <button data-apply>Filter</button>
          <span class="sep"></span>
          <div class="pager"><button data-first title="First page">⏮</button><button data-prev title="Previous page">◀</button><span data-range>—</span><button data-next title="Next page">▶</button><button data-last title="Last page">⏭</button></div>
          <select data-limit title="Rows per page">${[50, 100, 200, 500, 1000, 5000].map((n) => `<option ${n === this.limit ? 'selected' : ''}>${n}</option>`).join('')}</select>
          <span class="sep"></span>
          <span data-edit-tools></span>
          <span class="grow"></span>
          <button class="ghost" data-sql title="Open this view's query in a query tab">SQL</button>
        </div>
        <div class="results" style="flex:1">
          <div class="subtabs"></div>
          <div class="subpanes"></div>
        </div>`;
      const el = this.el;
      $('[data-refresh]', el).onclick = () => this.load();
      $('[data-apply]', el).onclick = () => {
        this.where = $('[data-where]', el).value.trim();
        this.offset = 0;
        this.load(true);
      };
      $('[data-where]', el).addEventListener('keydown', (e) => e.key === 'Enter' && $('[data-apply]', el).click());
      $('[data-first]', el).onclick = () => this.page(0);
      $('[data-prev]', el).onclick = () => this.page(this.offset - this.limit);
      $('[data-next]', el).onclick = () => this.page(this.offset + this.limit);
      $('[data-last]', el).onclick = () => this.total !== null && this.page(Math.max(0, Math.floor((this.total - 1) / this.limit) * this.limit));
      $('[data-limit]', el).onchange = (e) => {
        this.limit = Number((e.target as HTMLSelectElement).value);
        prefs.set('pageSize', this.limit);
        this.offset = 0;
        this.load();
      };
      $('[data-sql]', el).onclick = () => newQueryTab({ sql: this.selectSql(true) + ';\n' });
      this.buildViews();
      this.load(true);
    },
    onShow() {
      requestAnimationFrame(() => this.grid?.renderRows(true));
    },
    onSchema() {
      if (!app.schema.tables.has(name)) {
        closeTab(this, true);
        return;
      }
      if (this.view !== 'data') this.showView(this.view);
    },
    page(offset) {
      this.offset = Math.max(0, offset);
      if (this.total !== null && this.offset >= this.total) this.offset = Math.max(0, this.total - this.limit);
      this.load();
    },
    pkCols() {
      return (app.schema.tables.get(name) ?? []).filter((c) => c.pk).map((c) => c.name);
    },
    editable() {
      return this.kindName === 'table' && this.pkCols().length > 0;
    },
    selectSql(withPaging = false) {
      let sql = `SELECT * FROM ${quoteIdent(name)}`;
      if (this.where) sql += ` WHERE ${this.where}`;
      if (this.sort) sql += ` ORDER BY ${quoteIdent(this.sort.col)} ${this.sort.dir.toUpperCase()}`;
      if (withPaging) sql += ` LIMIT ${this.limit} OFFSET ${this.offset}`;
      return sql;
    },
    async load(recount = false) {
      if (!app.db) return;
      const t0 = now();
      const sql = this.selectSql() + ' LIMIT ? OFFSET ?';
      try {
        const r = await db().query(sql, [this.limit, this.offset], { rowMode: 'array' });
        const meta = app.schema.tables.get(name) ?? [];
        this.columns = r.columns.map((c) => {
          const m = meta.find((x) => x.name === c);
          return { name: c, type: m?.type, pk: m?.pk };
        });
        this.rows = r;
        const ms = now() - t0;
        if ((recount || this.total === null) && this.kindName !== 'external') {
          try {
            const c = await db().query(`SELECT count(*) FROM ${quoteIdent(name)}${this.where ? ` WHERE ${this.where}` : ''}`, [], { rowMode: 'array' });
            this.total = Number(c[0][0]);
          } catch {
            this.total = null;
          }
        } else if (this.kindName === 'external') this.total = r.length < this.limit ? this.offset + r.length : null;
        const sort = this.sort;
        const colIdx = sort ? this.columns.findIndex((c) => c.name === sort.col) : -1;
        this.grid.setData(this.columns, this.rows, { serverSort: sort && colIdx >= 0 ? { col: colIdx, dir: sort.dir } : null });
        this.updatePager();
        status(`${name}: rows ${fmtNum(this.offset + (r.length ? 1 : 0))}–${fmtNum(this.offset + r.length)}${this.total !== null ? ' of ' + fmtNum(this.total) : ''} in ${fmtMs(ms)}`);
        this.renderEditTools();
      } catch (e) {
        this.grid.setData([], []);
        this.grid.empty.textContent = errText(e);
        this.grid.empty.style.display = '';
        status(errText(e), 'err');
      }
    },
    updatePager() {
      const n = this.rows.length;
      const range = n ? `${fmtNum(this.offset + 1)}–${fmtNum(this.offset + n)}` : '0';
      $('[data-range]', this.el).textContent = this.total !== null ? `${range} of ${fmtNum(this.total)}` : range;
      $('[data-prev]', this.el).disabled = $('[data-first]', this.el).disabled = this.offset === 0;
      const atEnd = this.total !== null ? this.offset + n >= this.total : n < this.limit;
      $('[data-next]', this.el).disabled = atEnd;
      $('[data-last]', this.el).disabled = atEnd || this.total === null;
    },
    renderEditTools() {
      const box = $('[data-edit-tools]', this.el);
      if (!this.editable()) {
        box.innerHTML = this.kindName === 'table' ? '<span class="hint" title="Rows can be edited in tables with a primary key">read-only (no primary key)</span>' : `<span class="hint">read-only ${esc(this.kindName === 'external' ? 'external table' : this.kindName)}</span>`;
        if (this.kindName === 'matview') {
          box.insertAdjacentHTML('beforeend', ' <button data-refresh-mv>Refresh view</button>');
          $('[data-refresh-mv]', box).onclick = async () => {
            await runAdHoc(`REFRESH MATERIALIZED VIEW ${quoteIdent(name)}`);
            this.load(true);
          };
        }
        return;
      }
      box.innerHTML = `<button data-add title="Insert a row">＋ Row</button> <button data-del title="Delete the selected row">− Row</button> <span class="hint">double-click a cell to edit</span>`;
      $('[data-add]', box).onclick = () => this.insertRow();
      $('[data-del]', box).onclick = () => this.deleteRow();
    },
    keyOf(row) {
      const pk = this.pkCols();
      return { where: pk.map((c) => `${quoteIdent(c)} = ?`).join(' AND '), params: pk.map((c) => row[this.columns.findIndex((x) => x.name === c)] ?? null) };
    },
    async editCell(r, c, value) {
      const col = this.columns[c];
      const row = this.rows[r];
      const v = value === null ? null : coerceForType(value, col.type);
      const k = this.keyOf(row);
      try {
        const sql = `UPDATE ${quoteIdent(name)} SET ${quoteIdent(col.name)} = ? WHERE ${k.where}`;
        const res = await write((db) => db.exec(sql, [v, ...k.params]));
        addHistory({ sql: `${sql}  -- ${JSON.stringify([v, ...k.params], (_, x) => (typeof x === 'bigint' ? x.toString() : x))}`, db: app.dbName, at: Date.now() });
        if (res.changes !== 1) toast(`${res.changes} rows changed`, 'err');
        // Re-read the row to show stored (converted) values.
        const k2 = col.pk ? { where: k.where, params: this.pkCols().map((p) => (p === col.name ? v : k.params[this.pkCols().indexOf(p)])) } : k;
        const fresh = await db().query(`SELECT * FROM ${quoteIdent(name)} WHERE ${k2.where}`, k2.params, { rowMode: 'array' });
        if (fresh[0]) this.rows[r] = fresh[0];
        status(`Updated ${name}.${col.name}`);
      } catch (e) {
        toast(errText(e), 'err');
        throw e;
      }
    },
    async deleteRow() {
      const r = this.grid.selectedSourceRow();
      if (r < 0) return toast('Select a row first');
      const k = this.keyOf(this.rows[r]);
      if (!(await confirmBox('Delete row', `Delete the row where ${esc(this.pkCols().map((c, i) => `${c} = ${formatValue(k.params[i])}`).join(', '))}?`, 'Delete', true))) return;
      try {
        await write((db) => db.exec(`DELETE FROM ${quoteIdent(name)} WHERE ${k.where}`, k.params));
        this.load(true);
      } catch (e) {
        toast(errText(e), 'err');
      }
    },
    async insertRow() {
      const meta = app.schema.tables.get(name) ?? [];
      const body = `<p>Leave a field empty to use the column default (or NULL).</p>` + meta.map((c, i) => `<label class="field"><span>${esc(c.name)} <span class="mono" style="color:var(--faint)">${esc(c.type ?? '')}${c.pk ? ' · primary key' : ''}${c.nullable ? '' : ' · not null'}</span></span><input type="text" name="c${i}"></label>`).join('');
      const vals = await modal<string[] | null>({
        title: `Insert into ${name}`,
        body,
        buttons: [{ label: 'Cancel', value: null }, { label: 'Insert', primary: true, value: (f) => meta.map((c, i) => f[`c${i}`].value) }],
      });
      if (!vals) return;
      const cols: string[] = [];
      const params: SqlValue[] = [];
      meta.forEach((c, i) => {
        if (vals[i] === '') return;
        cols.push(quoteIdent(c.name));
        params.push(vals[i].toUpperCase() === 'NULL' ? null : coerceForType(vals[i], c.type));
      });
      try {
        const sql = cols.length ? `INSERT INTO ${quoteIdent(name)} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})` : `INSERT INTO ${quoteIdent(name)} DEFAULT VALUES`;
        await write((db) => db.exec(sql, params));
        toast('Row inserted', 'ok');
        this.load(true);
      } catch (e) {
        toast(errText(e), 'err');
      }
    },
    buildViews() {
      const views = [
        ['data', 'Data'],
        ['columns', 'Columns'],
        ['indexes', 'Indexes'],
        ['constraints', 'Constraints'],
        ['ddl', 'DDL'],
      ];
      if (this.kindName === 'external') views.splice(1, 0, ['source', 'Source']);
      if (this.kindName === 'matview') views.splice(1, 0, ['refresh', 'Refresh']);
      const tabsEl = $('.subtabs', this.el);
      const panes = $('.subpanes', this.el);
      for (const [key, label] of views) {
        const b = h(`<button class="subtab" data-view="${key}">${label}</button>`);
        b.onclick = () => this.showView(key);
        tabsEl.appendChild(b);
        panes.appendChild(h(`<div class="subpane" data-pane="${key}"></div>`));
      }
      const dataPane = $('[data-pane="data"]', panes);
      const gh = h('<div class="grid"></div>');
      dataPane.appendChild(gh);
      this.grid = new Grid(gh, {
        onSort: (c, dir) => {
          this.sort = dir ? { col: this.columns[c].name, dir } : null;
          this.offset = 0;
          this.load();
        },
        editable: (r, c) => this.editable() && !(app.schema.tables.get(name) ?? []).find((x) => x.name === this.columns[c]?.name && x.generated),
        onEdit: (r, c, v) => this.editCell(r, c, v),
        onOpenValue: (r, c) => showValue(this.rows[r][c], this.columns[c].name),
      });
      this.showView('data');
    },
    async showView(key) {
      this.view = key;
      $$('.subtab', this.el).forEach((x) => x.classList.toggle('active', x.dataset.view! === key));
      $$('.subpane', this.el).forEach((x) => x.classList.toggle('active', x.dataset.pane! === key));
      const pane = $(`[data-pane="${key}"]`, this.el);
      if (key === 'data') return this.grid.renderRows(true);
      pane.innerHTML = '';
      const q = (sql: string, p: SqlValue[] = []) => db().query(sql, p, { rowMode: 'array' });
      const gridOf = (r: ArrayResult) => {
        const gh = h('<div class="grid"></div>');
        pane.appendChild(gh);
        new Grid(gh, { emptyText: 'None' }).setData(r.columns, r);
      };
      try {
        if (key === 'columns') gridOf(await q('SELECT column_name, data_type, is_nullable, column_default, collation_name, is_identity, is_generated FROM information_schema.columns WHERE table_name = ? ORDER BY ordinal_position', [name]));
        else if (key === 'indexes') gridOf(await q('SELECT index_name, seq_in_index, column_name, non_unique, collation, index_type FROM information_schema.statistics WHERE table_name = ? ORDER BY index_name, seq_in_index', [name]));
        else if (key === 'constraints') gridOf(await q("SELECT c.constraint_name, c.constraint_type, group_concat(k.column_name, ', ') AS columns, ch.check_clause FROM information_schema.table_constraints c LEFT JOIN information_schema.key_column_usage k ON k.constraint_name = c.constraint_name AND k.table_name = c.table_name LEFT JOIN information_schema.check_constraints ch ON ch.constraint_name = c.constraint_name WHERE c.table_name = ? GROUP BY c.constraint_name, c.constraint_type, ch.check_clause", [name]));
        else if (key === 'ddl') {
          const pre = h('<pre class="ddl"></pre>');
          pre.innerHTML = (await import('./sql.js')).highlight(await ddlFor(name), app.schema.names);
          pane.appendChild(pre);
        } else if (key === 'source') {
          const r = await db().query('SELECT * FROM information_schema.external_tables WHERE table_name = ?', [name], { rowMode: 'object' });
          const x = r[0] ?? {};
          pane.appendChild(h(`<dl class="kv">${Object.entries(x).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v ?? '—')}</dd>`).join('')}</dl>`));
          pane.appendChild(h(`<p class="hint" style="padding:0 16px;color:var(--muted)">External tables read their source on every query. For fast repeat reads, cache it: <code>CREATE MATERIALIZED VIEW ${esc(name)}_cache AS SELECT * FROM ${esc(quoteIdent(name))}</code></p>`));
        } else if (key === 'refresh') {
          const r = await db().query('SELECT * FROM information_schema.materialized_views WHERE table_name = ?', [name], { rowMode: 'object' });
          const x = r[0] ?? {};
          pane.appendChild(h(`<dl class="kv">${Object.entries(x).filter(([k]) => k !== 'view_definition').map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v ?? '—')}</dd>`).join('')}</dl>`));
          const b = h('<div class="actions" style="padding:0 16px"><button data-r>Refresh now</button><button data-rc>Refresh concurrently</button><button data-ri title="Only when a source changed">Refresh if changed</button></div>');
          pane.appendChild(b);
          const go = async (sfx: '' | 'c' | 'i') => {
            await runAdHoc(`REFRESH MATERIALIZED VIEW ${sfx === 'c' ? 'CONCURRENTLY ' : ''}${quoteIdent(name)}${sfx === 'i' ? ' IF CHANGED' : ''}`);
            this.showView('refresh');
            this.load(true);
          };
          $('[data-r]', b).onclick = () => go('');
          $('[data-rc]', b).onclick = () => go('c');
          $('[data-ri]', b).onclick = () => go('i');
        }
      } catch (e) {
        pane.appendChild(h(`<div class="placeholder">${esc(errText(e))}</div>`));
      }
    },
  };
  return tab;
}

/** A cell value typed for its column: integers and reals become numbers, anything else stays text. */
function coerceForType(value: string, type: string | null | undefined): SqlValue {
  const t = String(type ?? '').toUpperCase();
  const s = String(value).trim();
  if (/INT/.test(t) && /^-?\d+$/.test(s)) return Number.isSafeInteger(Number(s)) ? Number(s) : BigInt(s);
  if (/REAL|FLOA|DOUB|NUM|DEC/.test(t) && s !== '' && !isNaN(Number(s))) return Number(s);
  return value;
}

// ================================================================ import tab

function openImportTab(section?: string): ImportTab {
  let t = app.tabs.find((x): x is ImportTab => x.kind === 'import');
  if (!t) t = addTab(importTab());
  else activateTab(t);
  if (section) $(`[data-card="${section}"]`, t.el)?.scrollIntoView({ behavior: 'smooth' });
  return t;
}

function importTab(): ImportTab {
  const tab: ImportTab = {
    id: 0,
    el: blankPane(),
    kind: 'import',
    title: 'Import',
    icon: icon('import'),
    previewGrid: assignedInInit<Grid>(),
    lsrc: 'url',
    init() {
      this.el.innerHTML = `
      <div class="scroll-page">
        <div class="page-head"><h2>Import &amp; link data</h2>
          <p><b>Import</b> copies rows into a table in this database. <b>Link</b> creates an <i>external table</i>: the data stays in the file or at the URL and is read each time you query it. Everything happens in your browser; nothing is uploaded.</p></div>
        <div class="cards">
          <section class="card" data-card="import">
            <h3>Import into a table</h3>
            <p class="sub">CSV, TSV, JSON (array of objects), NDJSON or Parquet. Column types are inferred for new tables.</p>
            <div class="seg" data-src-seg><button class="on" data-src="file">File</button><button data-src="url">URL</button><button data-src="paste">Paste</button></div>
            <div data-src-file><div class="drop" data-drop tabindex="0"><b>Drop a file here</b> or click to choose</div></div>
            <div data-src-url hidden><label class="field"><span>URL (must allow CORS)</span><input type="url" data-url placeholder="https://raw.githubusercontent.com/…/data.csv"></label><div class="note url-note" data-url-note></div><button data-fetch>Fetch</button></div>
            <div data-src-paste hidden><label class="field"><span>Data</span><textarea class="plain sqlbox" data-paste placeholder="id,name&#10;1,Ada&#10;2,Grace"></textarea></label><button data-use-paste>Use pasted data</button></div>
            <div data-imp-detail hidden>
              <div class="row">
                <label class="field"><span>Format</span><select data-fmt><option value="csv">CSV</option><option value="tsv">TSV</option><option value="json">JSON</option><option value="ndjson">NDJSON</option><option value="parquet">Parquet</option></select></label>
                <label class="field" data-delim-field><span>Delimiter</span><input type="text" data-delim value="," maxlength="2" style="width:60px"></label>
                <label class="field"><span>Target</span><select data-mode><option value="new">New table</option><option value="existing">Existing table</option></select></label>
                <label class="field"><span>Table</span><input type="text" data-table list="smaltui-tables"></label>
              </div>
              <div class="checks" data-csv-only><label><input type="checkbox" data-header checked> First row is a header</label><label><input type="checkbox" data-emptynull checked> Empty fields are NULL</label></div>
              <div class="preview" data-preview></div>
              <div class="actions"><button class="primary" data-do-import>Import</button><span class="note" data-imp-note></span></div>
              <div data-imp-result></div>
            </div>
          </section>

          <section class="card" data-card="link">
            <h3>Link an external table</h3>
            <p class="sub">Query a file or URL in place with <code>CREATE EXTERNAL TABLE</code>. Read-only; re-read on every query (Parquet reads only the columns and row groups a query needs).</p>
            <div class="seg" data-lsrc-seg><button class="on" data-lsrc="url">URL</button><button data-lsrc="file">Local file</button></div>
            <div data-lsrc-url><label class="field"><span>Location (absolute URL, or a path relative to the connection)</span><input type="text" data-lurl placeholder="https://raw.githubusercontent.com/…/prices.csv"></label><div class="note url-note" data-lurl-note></div></div>
            <div data-lsrc-file hidden>
              <div class="actions" style="margin-bottom:10px"><button data-lpick>Choose file…</button><span class="note" data-lfile-note>${window.showOpenFilePicker ? 'The file stays linked across reloads (you may be asked to grant access again).' : 'This browser cannot keep file access: re-attach the file after a reload.'}</span></div>
            </div>
            <div class="row">
              <label class="field"><span>Table name</span><input type="text" data-lname></label>
              <label class="field"><span>Format</span><select data-lfmt><option value="">auto</option><option>csv</option><option>tsv</option><option>json</option><option>ndjson</option><option>parquet</option></select></label>
              <label class="field"><span>Connection</span><select data-lconn></select></label>
            </div>
            <div data-newconn hidden class="card" style="margin-bottom:10px;padding:10px">
              <div class="row">
                <label class="field"><span>Connection name</span><input type="text" data-cname placeholder="api"></label>
                <label class="field" style="flex:2 1 200px"><span>Base URL</span><input type="url" data-curl placeholder="https://data.example.com/v1/"></label>
              </div>
              <div class="row">
                <label class="field"><span>Header (optional)</span><input type="text" data-chead placeholder="Authorization"></label>
                <label class="field" style="flex:2 1 200px"><span>Value</span><input type="text" data-cval placeholder="Bearer …" autocomplete="off"></label>
              </div>
              <p class="sub" style="margin:0">Header values are kept in this tab's memory only — never in SQL or the database — and are sent only to URLs under the base URL.</p>
            </div>
            <div class="row">
              <label class="field"><span>Delimiter</span><input type="text" data-ldelim placeholder="," maxlength="2"></label>
              <label class="field"><span>NULL text</span><input type="text" data-lnull placeholder="e.g. NA"></label>
              <label class="field"><span>Skip rows</span><input type="number" data-lskip min="0" placeholder="0"></label>
            </div>
            <div class="checks"><label><input type="checkbox" data-lheader checked> Header row</label><label><input type="checkbox" data-lcache> Also cache locally as a materialized view</label><label data-lcache-every hidden>refresh every <input type="number" data-levery min="0" placeholder="seconds" style="width:90px"></label></div>
            <label class="field"><span>SQL to run (you can edit it)</span><textarea class="plain sqlbox" data-lsql spellcheck="false"></textarea></label>
            <div class="actions"><button data-ltest>Preview</button><button class="primary" data-lcreate>Create</button><button class="ghost" data-ltoeditor>Open in editor</button></div>
            <div class="preview" data-lpreview hidden></div>
            <div data-lresult></div>
          </section>

          <section class="card" data-card="env">
            <h3>Environments</h3>
            <p class="sub">An environment is a JSON manifest that builds a database (schema, data, linked sources and saved queries). Serve one next to this page and share <code>?env=path/to/env.json</code>.</p>
            <div data-env-list></div>
            <label class="field"><span>Manifest URL</span><input type="text" data-env-url placeholder="envs/demo/env.json"></label>
            <div class="actions"><button class="primary" data-env-load>Load</button><button data-env-file>Load from file…</button><button data-env-export>Export this database…</button></div>
            <div data-env-result></div>
          </section>
        </div>
        <datalist id="smaltui-tables"></datalist>
      </div>`;
      this.wireImport();
      this.wireLink();
      this.wireEnv();
      this.onSchema?.();
    },
    onSchema() {
      const dl = $('#smaltui-tables', this.el);
      dl.innerHTML = [...app.schema.tables.entries()].filter(([, c]) => c.kind === 'table').map(([n]) => `<option value="${esc(n)}">`).join('');
      const sel = $('[data-lconn]', this.el);
      const cur = sel.value;
      sel.innerHTML = `<option value="">none</option>${(app.schema.connections ?? []).map((c) => `<option value="${esc(c.connection_name)}">${esc(c.connection_name)}</option>`).join('')}<option value="__new">new connection…</option>`;
      if ([...(sel as unknown as HTMLSelectElement).options].some((o) => o.value === cur)) sel.value = cur;
    },
    onDatabase() {
      this.onSchema?.();
    },
    // -------------------------------------------------- import
    wireImport() {
      const el = this.el;
      const seg = $('[data-src-seg]', el);
      seg.onclick = (e) => {
        const b = closest(e, '[data-src]');
        if (!b) return;
        $$('button', seg).forEach((x) => x.classList.toggle('on', x === b));
        for (const k of ['file', 'url', 'paste']) $(`[data-src-${k}]`, el).hidden = k !== b.dataset.src!;
      };
      const drop = $('[data-drop]', el);
      drop.onclick = async () => {
        const p = await pickLocalFile();
        if (p) this.setImportSource(p.file, p.file.name);
      };
      drop.onkeydown = (e) => (e.key === 'Enter' || e.key === ' ') && drop.click();
      drop.ondragover = (e) => {
        e.preventDefault();
        drop.classList.add('over');
      };
      drop.ondragleave = () => drop.classList.remove('over');
      drop.ondrop = (e) => {
        e.preventDefault();
        drop.classList.remove('over');
        const f = e.dataTransfer?.files[0];
        if (f) this.setImportSource(f, f.name);
      };
      $('[data-fetch]', el).onclick = async () => {
        const input = $('[data-url]', el).value.trim();
        if (!input) return;
        const { url, note } = normalizeDataUrl(input);
        $('[data-url-note]', el).textContent = note;
        try {
          const r = await fetch(url);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          this.setImportSource(await r.blob(), url);
        } catch (e) {
          this.importResult(`Could not fetch ${url}: ${(e as Error).message}.\n${corsHint('CORS ' + url)}`, true);
        }
      };
      $('[data-use-paste]', el).onclick = () => {
        const text = $('[data-paste]', el).value;
        if (!text.trim()) return;
        const fmt = /^\s*\[/.test(text) ? 'json' : /^\s*\{/.test(text) ? 'ndjson' : text.split('\n')[0].includes('\t') ? 'tsv' : 'csv';
        this.setImportSource(new Blob([text]), `pasted.${fmt}`);
      };
      const reprev = () => this.previewImport();
      $('[data-fmt]', el).onchange = () => {
        $('[data-delim]', el).value = $('[data-fmt]', el).value === 'tsv' ? '\\t' : ',';
        reprev();
      };
      $('[data-delim]', el).onchange = reprev;
      $('[data-header]', el).onchange = reprev;
      // Follow the table name: an existing local table means append, anything else a new table.
      $('[data-table]', el).addEventListener('input', () => this.syncImportMode());
      $('[data-mode]', el).onchange = () => {
        const existing = $('[data-mode]', el).value === 'existing';
        $('[data-table]', el).placeholder = existing ? 'choose a table' : '';
      };
      $('[data-do-import]', el).onclick = () => this.doImport();
      this.previewGrid = new Grid($('[data-preview]', el).appendChild(h('<div class="grid"></div>')), { emptyText: 'Preview appears here' });
    },
    setImportSource(blob, label) {
      const el = this.el;
      this.source = { blob, label };
      $('[data-imp-detail]', el).hidden = false;
      const fmt = formatFromName(label);
      $('[data-fmt]', el).value = fmt;
      $('[data-delim]', el).value = fmt === 'tsv' ? '\\t' : ',';
      $('[data-table]', el).value = tableNameFrom(label);
      this.syncImportMode();
      $('[data-imp-note]', el).textContent = `${label} · ${fmtBytes(blob.size)}`;
      $('[data-imp-result]', el).innerHTML = '';
      $('[data-drop]', el).innerHTML = `<b>${esc(label.split('/').pop())}</b> (${fmtBytes(blob.size)}) — drop or click to replace`;
      this.previewImport();
    },
    syncImportMode() {
      const name = $('[data-table]', this.el).value.trim();
      $('[data-mode]', this.el).value = app.schema.tables.get(name)?.kind === 'table' ? 'existing' : 'new';
    },
    readerArgs() {
      const el = this.el;
      const fmt = $('[data-fmt]', el).value;
      const args = [];
      if (fmt === 'csv' || fmt === 'tsv') {
        const d = $('[data-delim]', el).value.replace('\\t', '\t');
        if (d && d !== (fmt === 'tsv' ? '\t' : ',')) args.push(`delimiter => ${quoteLiteral(d)}`);
        args.push(`header => ${$('[data-header]', el).checked}`);
      } else if (fmt !== 'parquet') args.push(`format => ${quoteLiteral(fmt)}`);
      return { fmt, args };
    },
    async previewImport() {
      if (!this.source || !app.db) return;
      const { fmt, args } = this.readerArgs();
      const fn = fmt === 'parquet' ? 'read_parquet' : fmt === 'json' || fmt === 'ndjson' ? 'read_json' : 'read_csv';
      const csv = fmt === 'csv' || fmt === 'tsv';
      $('[data-delim-field]', this.el).hidden = !csv;
      $('[data-csv-only]', this.el).hidden = !csv;
      try {
        // Small text files are previewed whole; big ones from their first 256 KB (enough for 100 rows).
        // Parquet is read whole: its footer is at the end and the engine reads only what it needs.
        let blob = this.source.blob;
        if (blob.size > 262144 && csv) {
          const text = await blob.slice(0, 262144).text();
          blob = new Blob([text.slice(0, text.lastIndexOf('\n') + 1)]);
        }
        await registerFile(db(), '__preview', blob);
        const r = await db().query(`SELECT * FROM ${fn}('file:__preview'${args.length ? ', ' + args.join(', ') : ''}) LIMIT 100`, [], { rowMode: 'array' });
        const types = r.columns.map((_, i) => {
          const seen = new Set(r.map((row) => (row[i] === null ? null : typeof row[i] === 'number' ? (Number.isInteger(row[i]) ? 'INTEGER' : 'REAL') : typeof row[i] === 'bigint' ? 'INTEGER' : 'TEXT')));
          seen.delete(null);
          return seen.size === 1 ? [...seen][0] : seen.has('TEXT') ? 'TEXT' : seen.size ? 'REAL' : '';
        });
        this.previewGrid.setData(r.columns.map((c, i) => ({ name: c, type: types[i] })), r);
        $('[data-imp-note]', this.el).textContent = `${this.source.label.split('/').pop()} · ${fmtBytes(this.source.blob.size)} · ${r.columns.length} columns · preview of first ${r.length} rows`;
      } catch (e) {
        this.previewGrid.setData([], []);
        this.previewGrid.empty.textContent = errText(e);
        this.previewGrid.empty.style.display = '';
      } finally {
        registerFile(db(), '__preview', null).catch(() => {});
      }
    },
    importResult(text, err = false) {
      $('[data-imp-result]', this.el).innerHTML = `<div class="${err ? 'inline-err' : 'inline-ok'}">${esc(text)}</div>`;
    },
    async doImport() {
      const el = this.el;
      const table = $('[data-table]', el).value.trim();
      if (!table) return this.importResult('Enter a table name', true);
      const mode = $('[data-mode]', el).value;
      const kind = app.schema.tables.get(table)?.kind;
      if (kind && kind !== 'table') return this.importResult(`${table} is ${kind === 'external' ? 'an external table' : 'a ' + kind} and cannot be imported into. Choose another table name.`, true);
      if (mode === 'new' && kind) return this.importResult(`Table ${table} already exists — choose “Existing table” to append to it, or another name.`, true);
      if (mode === 'existing' && !kind) return this.importResult(`There is no table named ${table}.`, true);
      const fmt = $('[data-fmt]', el).value;
      const t0 = now();
      const btn = $('[data-do-import]', el);
      btn.disabled = true;
      try {
        let r;
        const blob = this.source!.blob;
        if (fmt === 'parquet') r = await write((db) => importParquet(db, table, blob));
        else if (fmt === 'json' || fmt === 'ndjson') r = await write((db) => importJSON(db, table, blob, { create: mode === 'new' }));
        else {
          const delimiter = $('[data-delim]', el).value.replace('\\t', '\t') || (fmt === 'tsv' ? '\t' : ',');
          r = await write((db) => importCSV(db, table, blob, { create: mode === 'new', header: $('[data-header]', el).checked, delimiter, emptyAsNull: $('[data-emptynull]', el).checked }));
        }
        this.importResult(`Imported ${fmtNum(r.rows)} rows into ${table} in ${fmtMs(now() - t0)}.`);
        addHistory({ sql: `-- import ${this.source!.label} → ${table} (${r.rows} rows)`, db: app.dbName, at: Date.now() });
        await refreshSchema();
        const b = h(`<button style="margin-top:8px">Open ${esc(table)}</button>`);
        b.onclick = () => openTableTab(table);
        $('[data-imp-result]', el).appendChild(b);
      } catch (e) {
        this.importResult(errText(e), true);
      } finally {
        btn.disabled = false;
      }
    },
    // -------------------------------------------------- link
    wireLink() {
      const el = this.el;
      const seg = $('[data-lsrc-seg]', el);
      this.lsrc = 'url';
      seg.onclick = (e) => {
        const b = closest(e, '[data-lsrc]');
        if (!b) return;
        this.lsrc = b.dataset.lsrc as 'url' | 'file';
        $$('button', seg).forEach((x) => x.classList.toggle('on', x === b));
        $('[data-lsrc-url]', el).hidden = this.lsrc !== 'url';
        $('[data-lsrc-file]', el).hidden = this.lsrc !== 'file';
        this.updateLinkSql();
      };
      $('[data-lpick]', el).onclick = async () => {
        const p = await pickLocalFile();
        if (!p) return;
        this.lfile = p;
        const name = tableNameFrom(p.file.name);
        let fname = p.file.name.replace(/[^\w.-]+/g, '_');
        $('[data-lfile-note]', el).textContent = `${p.file.name} (${fmtBytes(p.file.size)}) → file:${fname}`;
        this.lfileName = fname;
        if (!$('[data-lname]', el).value) $('[data-lname]', el).value = name;
        this.updateLinkSql();
      };
      $('[data-lurl]', el).addEventListener('input', () => {
        const v = $('[data-lurl]', el).value.trim();
        if (v && !this.lnameTouched) $('[data-lname]', el).value = tableNameFrom(v);
        this.updateLinkSql();
      });
      $('[data-lname]', el).addEventListener('input', () => {
        this.lnameTouched = true;
        this.updateLinkSql();
      });
      $('[data-lconn]', el).onchange = () => {
        $('[data-newconn]', el).hidden = $('[data-lconn]', el).value !== '__new';
        this.updateLinkSql();
      };
      for (const sel of ['[data-lfmt]', '[data-ldelim]', '[data-lnull]', '[data-lskip]', '[data-lheader]', '[data-lcache]', '[data-levery]', '[data-cname]', '[data-curl]'])
        $(sel, el).addEventListener('input', () => {
          $('[data-lcache-every]', el).hidden = !$('[data-lcache]', el).checked;
          this.updateLinkSql();
        });
      $('[data-lsql]', el).addEventListener('input', () => (this.lsqlTouched = true));
      $('[data-lcreate]', el).onclick = () => this.createLink();
      $('[data-ltest]', el).onclick = () => this.previewLink();
      $('[data-ltoeditor]', el).onclick = () => newQueryTab({ sql: $('[data-lsql]', el).value + '\n' });
      this.updateLinkSql();
    },
    linkSpec() {
      const el = this.el;
      const val = (s: string) => $(s, el).value.trim();
      const table = val('[data-lname]') || 'linked';
      const norm = normalizeDataUrl(val('[data-lurl]'));
      $('[data-lurl-note]', el).textContent = this.lsrc === 'url' ? norm.note : '';
      let location = this.lsrc === 'file' ? (this.lfileName ? `file:${this.lfileName}` : 'file:…') : norm.url;
      let connection = val('[data-lconn]');
      let connSql = '';
      if (connection === '__new') {
        connection = val('[data-cname]') || 'api';
        const credName = val('[data-chead]') ? `${connection}_credentials` : '';
        connSql = `CREATE CONNECTION ${quoteIdent(connection)} WITH (url = ${quoteLiteral(val('[data-curl]'))}${credName ? `, credentials = ${quoteLiteral(credName)}` : ''});\n`;
      }
      const options: ReaderOptions = {};
      if (!$('[data-lheader]', el).checked) options.header = false;
      if (val('[data-ldelim]')) options.delimiter = val('[data-ldelim]').replace('\\t', '\t');
      if (val('[data-lnull]')) options.null = val('[data-lnull]');
      if (val('[data-lskip]')) options.skip = Number(val('[data-lskip]'));
      const format = val('[data-lfmt]') || (/\.(csv|tsv|json|ndjson|jsonl|parquet)(\?|#|$)/i.test(location) ? undefined : 'csv');
      let sql = connSql + externalTableSql({ table, location, format, options, connection: connection || undefined }) + ';';
      if ($('[data-lcache]', el).checked) {
        const every = Number(val('[data-levery]'));
        sql += `\nCREATE MATERIALIZED VIEW ${quoteIdent(table + '_cache')}${every > 0 ? ` WITH (refresh_every = ${every})` : ''}\n  AS SELECT * FROM ${quoteIdent(table)};`;
      }
      return { table, location, sql, connection, format, options };
    },
    updateLinkSql() {
      if (this.lsqlTouched) return;
      $('[data-lsql]', this.el).value = this.linkSpec().sql;
    },
    async prepareLink() {
      const el = this.el;
      if (this.lsrc === 'file') {
        if (!this.lfile) throw new Error('Choose a file first');
        await linkFile(this.lfileName!, this.lfile.handle ?? this.lfile.file, this.lfile.handle);
      }
      if ($('[data-lconn]', el).value === '__new' && $('[data-chead]', el).value.trim()) {
        const connection = $('[data-cname]', el).value.trim() || 'api';
        await registerCredentials(db(), `${connection}_credentials`, { endpoint: $('[data-curl]', el).value.trim(), headers: { [$('[data-chead]', el).value.trim()]: $('[data-cval]', el).value } });
      }
    },
    async previewLink() {
      const el = this.el;
      const res = $('[data-lresult]', el);
      res.innerHTML = '';
      const box = $('[data-lpreview]', el);
      box.hidden = false;
      box.innerHTML = '';
      const g = new Grid(box.appendChild(h('<div class="grid"></div>')), { emptyText: 'Loading…' });
      try {
        await this.prepareLink();
        const spec = this.linkSpec();
        let loc = spec.location;
        if (spec.connection && !/^[a-z]+:/i.test(loc)) {
          const c = app.schema.connections?.find((x) => x.connection_name === spec.connection);
          const base = c?.url ?? $('[data-curl]', el).value.trim();
          loc = new URL(loc, base).href;
        }
        const fmt = spec.format ?? formatFromName(loc);
        const fn = fmt === 'parquet' ? 'read_parquet' : fmt === 'json' || fmt === 'ndjson' ? 'read_json' : 'read_csv';
        const args = Object.entries({ ...spec.options, ...(fn === 'read_json' ? { format: fmt } : fmt === 'tsv' && !spec.options.delimiter ? { delimiter: '\t' } : {}) }).map(([k, v]) => `${k} => ${typeof v === 'string' ? quoteLiteral(v) : v}`);
        const r = await db().query(`SELECT * FROM ${fn}(${quoteLiteral(loc)}${args.length ? ', ' + args.join(', ') : ''}) LIMIT 100`, [], { rowMode: 'array' });
        g.setData(r.columns, r);
      } catch (e) {
        g.setData([], []);
        g.empty.textContent = errText(e);
        g.empty.style.display = '';
      }
    },
    async createLink() {
      const el = this.el;
      const res = $('[data-lresult]', el);
      const spec = this.linkSpec();
      try {
        await this.prepareLink();
        const sql = $('[data-lsql]', el).value;
        const t0 = now();
        await write((db) => db.exec(sql));
        addHistory({ sql, db: app.dbName, at: Date.now(), ms: now() - t0 });
        await refreshSchema();
        res.innerHTML = `<div class="inline-ok">Created ${esc(spec.table)} in ${fmtMs(now() - t0)}.</div>`;
        const b = h(`<button style="margin-top:8px">Open ${esc(spec.table)}</button>`);
        b.onclick = () => openTableTab(spec.table);
        res.appendChild(b);
        this.lsqlTouched = false;
      } catch (e) {
        res.innerHTML = `<div class="inline-err">${esc(errText(e))}</div>`;
      }
    },
    // -------------------------------------------------- environments
    wireEnv() {
      const el = this.el;
      const out = $('[data-env-result]', el);
      const say = (t: string, err = false) => (out.innerHTML = `<div class="${err ? 'inline-err' : 'inline-ok'}">${esc(t)}</div>`);
      $('[data-env-load]', el).onclick = async () => {
        const url = $('[data-env-url]', el).value.trim();
        if (!url) return;
        try {
          await loadEnvironment(url, { force: true });
          say('Environment loaded.');
        } catch (e) {
          say(errText(e), true);
        }
      };
      $('[data-env-file]', el).onclick = async () => {
        const p = await pickLocalFile('.json');
        if (!p) return;
        try {
          const m = JSON.parse(await p.file.text());
          await loadEnvironment(null, { manifest: m, force: true });
          say(`Loaded ${m.name ?? p.file.name}.`);
        } catch (e) {
          say(errText(e), true);
        }
      };
      $('[data-env-export]', el).onclick = () => exportEnvironmentDialog();
      fetch(new URL('../envs/index.json', import.meta.url))
        .then((r) => (r.ok ? r.json() : []))
        .then((list) => {
          if (!list.length) return;
          const box = $('[data-env-list]', el);
          box.innerHTML = `<div class="db-list">${list.map((e: { name: string; path: string; description?: string }) => `<div class="db-row"><div><div class="nm">${esc(e.name)}</div><div class="meta">${esc(e.description ?? '')}</div></div><span class="acts"><button type="button" data-env="${esc(e.path)}">Open</button></span></div>`).join('')}</div>`;
          $$('[data-env]', box).forEach((b) => (b.onclick = () => loadEnvironment(new URL(b.dataset.env!, new URL('../envs/', import.meta.url)).href, { force: true }).catch((e) => say(errText(e), true))));
        })
        .catch(() => {});
    },
  };
  return tab;
}

// ================================================================ environments

async function loadEnvironment(url: string | null, { manifest = null, force = false }: { manifest?: Manifest | null; force?: boolean } = {}): Promise<void> {
  const m = manifest ?? (await fetchManifest(url ?? ''));
  const dbName = m.database?.name ?? 'env';
  const storage = m.database?.storage === 'opfs' && opfsAvailable() ? 'opfs' : 'memory';
  const key = manifestKey(m);
  let fresh = true;
  if (storage === 'opfs') {
    const exists = (await listOpfsDatabases()).some((d) => d.name === dbName);
    const applied = prefs.get(key, false);
    if (exists && applied && m.init !== 'always' && !force) fresh = false;
    else if (exists && (m.init === 'always' || force)) {
      if (app.db && app.dbName === dbName && app.storage === 'opfs') {
        await closeStreams();
        await db().close();
        app.db = null;
      }
      await deleteOpfsDatabase(dbName).catch(() => {});
    }
  }
  if (storage === 'memory' && app.db && app.dbName === dbName && app.storage === 'memory') {
    await closeStreams();
    await db().close();
    app.db = null;
  }
  status(`Loading environment ${m.name ?? dbName}…`);
  await openDatabase(dbName, storage, { quiet: true });
  if (fresh) {
    const log = [];
    try {
      await applyManifest(db(), m, (lvl, text) => {
        log.push(text);
        status(text);
      });
    } catch (e) {
      toast(`Environment ${m.name ?? dbName}: ${errText(e)}`, 'err');
      await refreshSchema();
      throw e;
    }
    prefs.set(key, true);
  }
  await refreshSchema();
  app.env = m;
  for (const q of m.queries ?? []) {
    if (q.lang === 'ts') {
      if (!app.tabs.some((t) => t.kind === 'ts' && t.editor?.value.trim() === q.sql.trim())) newTsTab({ title: q.title, source: q.sql });
    } else if (!app.tabs.some((t) => t.kind === 'query' && t.editor?.value.trim() === q.sql.trim())) newQueryTab({ title: q.title, sql: q.sql });
  }
  for (const t of m.open ?? []) if (app.schema.tables.has(t)) openTableTab(t);
  // Drop the starter tab if it is still empty.
  for (const t of [...app.tabs]) if (t.kind === 'query' && !t.editor.value.trim() && app.tabs.length > 1) closeTab(t, true);
  for (const t of [...app.tabs]) if (t.kind === 'welcome') closeTab(t, true);
  status(`Environment “${m.name ?? dbName}” ready${fresh ? '' : ' (already initialised; use Load to rebuild)'}`);
  toast(`Environment “${m.name ?? dbName}” ready`, 'ok');
}

async function exportEnvironmentDialog(): Promise<void> {
  if (!app.db) return;
  const r = await modal<'sql' | { data: boolean; queries: boolean; name: string } | null>({
    title: 'Export database',
    body: `<p>Save <b>${esc(app.dbName)}</b> as an environment manifest: its schema, the rows of local tables (as JSON), external tables and connections (by reference, never credentials), and your open query tabs. Serve the file with smaltui and open <code>?env=&lt;path&gt;</code> to recreate it anywhere.</p>
      <div class="checks"><label><input type="checkbox" name="data" checked> Include table data</label><label><input type="checkbox" name="queries" checked> Include query tabs</label></div>
      <label class="field"><span>Name</span><input type="text" name="name" value="${esc(app.dbName)}"></label>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'SQL dump instead', value: 'sql' }, { label: 'Download manifest', primary: true, value: (f) => ({ data: f.data.checked, queries: f.queries.checked, name: f.name.value }) }],
  });
  if (!r) return;
  try {
    if (r === 'sql') return download(`${app.dbName}.sql`, await exportSqlDump(app.db), 'application/sql');
    const queries = r.queries
      ? app.tabs
          .filter((t): t is QueryTab | TsTab => (t.kind === 'query' || t.kind === 'ts') && !!t.editor.value.trim())
          .map((t) => (t.kind === 'ts' ? { title: t.title, sql: t.editor.value, lang: 'ts' as const } : { title: t.title, sql: t.editor.value }))
      : [];
    const m = await exportManifest(db(), { name: r.name, dbName: app.dbName ?? 'smaltui', includeData: r.data, queries });
    download(`${app.dbName}.env.json`, JSON.stringify(m, null, 2), 'application/json');
  } catch (e) {
    toast(errText(e), 'err');
  }
}

// ================================================================ history tab

function openHistoryTab(): void {
  const t = app.tabs.find((x): x is HistoryTab => x.kind === 'history');
  if (t) {
    activateTab(t);
    t.render();
    return;
  }
  addTab<HistoryTab>({
    id: 0,
    el: blankPane(),
    kind: 'history',
    title: 'History',
    icon: icon('history'),
    init() {
      this.el.innerHTML = `<div class="toolbar"><input type="search" data-q placeholder="Search history…" style="flex:1"><label class="hint"><input type="checkbox" data-thisdb checked> this database only</label><button data-clear class="danger">Clear</button></div><div class="hist-list"></div>`;
      $('[data-q]', this.el).oninput = () => this.render();
      $('[data-thisdb]', this.el).onchange = () => this.render();
      $('[data-clear]', this.el).onclick = async () => {
        if (await confirmBox('Clear history', 'Remove all query history stored in this browser?', 'Clear', true)) {
          clearHistory();
          this.render();
        }
      };
      this.render();
    },
    onShow() {
      this.render();
    },
    render() {
      const q = $('[data-q]', this.el).value.toLowerCase();
      const only = $('[data-thisdb]', this.el).checked;
      const items = loadHistory().filter((x) => (!only || x.db === app.dbName) && (!q || x.sql.toLowerCase().includes(q)));
      const list = $('.hist-list', this.el);
      list.innerHTML = items.length
        ? items
            .slice(0, 300)
            .map(
              (x, i) => `<div class="hist" data-i="${i}"><pre>${esc(x.sql)}</pre>
              <div class="acts"><button data-ins title="Insert into the current editor">Insert</button><button data-new title="Open in a new tab">Open</button></div>
              <div class="meta"><span>${new Date(x.at).toLocaleString()}</span><span>${esc(x.db ?? '')}</span>${x.ms !== undefined ? `<span>${fmtMs(x.ms)}</span>` : ''}${(x.runs ?? 1) > 1 ? `<span>×${x.runs}</span>` : ''}${x.error ? `<span class="err">${esc(x.error)}</span>` : ''}</div></div>`,
            )
            .join('')
        : '<div class="placeholder">No history yet.</div>';
      list.onclick = (e) => {
        const row = closest(e, '.hist');
        if (!row) return;
        const x = items[Number(row.dataset.i!)];
        if (closest(e, '[data-new]')) newQueryTab({ sql: x.sql + '\n' });
        else if (closest(e, '[data-ins]')) insertIntoEditor(x.sql);
      };
      list.ondblclick = (e) => {
        const row = closest(e, '.hist');
        if (row) newQueryTab({ sql: items[Number(row.dataset.i!)].sql + '\n' });
      };
    },
  });
}

// ================================================================ welcome tab

function welcomeTab(): WelcomeTab {
  return {
    id: 0,
    el: blankPane(),
    kind: 'welcome',
    title: 'Welcome',
    icon: icon('welcome'),
    init() {
      const v = app.engine?.version;
      this.el.innerHTML = `<div class="scroll-page"><div class="welcome">
        <h2 class="welcome-mark"><img class="logo-light" src="brand/logos/smaltui/wordmark.svg" alt="smaltui" height="34"><img class="logo-dark" src="brand/logos/smaltui/wordmark-on-dark.svg" alt="smaltui" height="34"></h2>
        <p class="tagline">Small. Alternative. Query.</p>
        <p class="lead">A SQL console for <a href="https://smaltdb.dev" target="_blank" rel="noopener">smaltdb</a> that runs entirely in the browser. Databases live in this browser's private storage (OPFS) or in memory, and the page fetches only the files and URLs you import or link.</p>
        <div class="quick">
          <button data-q="query"><b>${icon('query')} New query</b><span>Write SQL with highlighting, completion and bind variables.</span></button>
          <button data-q="ts"><b>${icon('typescript')} New TypeScript tab</b><span>Query with smaltdf: frames and expressions in TypeScript, run in the engine.</span></button>
          <button data-q="import"><b>${icon('import')} Import a file</b><span>Load CSV, TSV, JSON, NDJSON or Parquet into a table.</span></button>
          <button data-q="link"><b>${icon('external')} Link a source</b><span>Query a file or URL in place as an external table.</span></button>
          <button data-q="demo"><b>${icon('welcome')} Open the demo</b><span>A sample environment with tables, a view and saved queries.</span></button>
          <button data-q="db"><b>${icon('database')} Databases</b><span>Open, create or delete databases stored in this browser.</span></button>
        </div>
        <p class="lead" style="font-size:12px">Engine: ${esc(app.engine?.label ?? '—')}${v?.version ? ` · smaltdb ${esc(v.version)}` : ''}${v?.source === 'checkout' && v.commit ? ` @ <code>${esc(v.commit.slice(0, 10))}</code>` : ''}. Shortcuts: <kbd>Ctrl</kbd>+<kbd>Enter</kbd> run · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd> run script · <kbd>Ctrl</kbd>+<kbd>E</kbd> explain · <kbd>Ctrl</kbd>+<kbd>Space</kbd> complete.</p>
      </div></div>`;
      $('.quick', this.el).onclick = (e) => {
        const b = closest(e, '[data-q]');
        if (!b) return;
        const q = b.dataset.q!;
        if (q === 'query') newQueryTab();
        else if (q === 'ts') newTsTab();
        else if (q === 'import') openImportTab('import');
        else if (q === 'link') openImportTab('link');
        else if (q === 'db') dbPicker();
        else if (q === 'demo') loadEnvironment(new URL('../envs/demo/env.json', import.meta.url).href, { force: false }).catch((err) => toast(errText(err), 'err'));
      };
    },
  };
}

// ================================================================ menus, shortcuts, init

async function engineDialog() {
  const cur = engineSpec();
  const r = await modal({
    title: 'Engine source',
    body: `<p>smaltui loads the smaltdb engine from one of these. The page reloads to switch.</p>
      <label class="field"><span>Source</span><select name="kind">
        <option value="vendor" ${cur === 'vendor' ? 'selected' : ''}>Bundled (./vendor/smaltdb/: smaltdb with smaltql and the io, external and Parquet plugins, pinned in packed.json)</option>
        <option value="url" ${cur !== 'vendor' ? 'selected' : ''}>Custom URL (a folder built like vendor/smaltdb/, with smaltdb.js and smaltdb-worker.js)</option>
      </select></label>
      <label class="field"><span>Custom URL</span><input type="text" name="val" value="${esc(cur === 'vendor' ? '' : cur)}" placeholder="https://…/vendor/smaltdb/"></label>
      <p>Current: <code>${esc(app.engine?.label ?? cur)}</code></p>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Use and reload', primary: true, value: (f) => (f.kind.value === 'vendor' || !f.val.value.trim() ? 'vendor' : f.val.value.trim()) }],
  });
  if (!r) return;
  setEngineSpec(r);
  const url = new URL(location.href);
  url.searchParams.delete('engine');
  location.href = url.href;
}

function shortcutsDialog() {
  const rows = [
    ['Ctrl+Enter', 'Run the statement at the cursor (or the selection)'],
    ['Ctrl+Shift+Enter / F5', 'Run the whole script'],
    ['Ctrl+E', 'Explain the statement at the cursor'],
    ['Esc', 'Cancel the running statement'],
    ['Ctrl+Space', 'Complete keywords, tables and columns'],
    ['Ctrl+/', 'Toggle line comments'],
    ['Ctrl+Shift+F', 'Format SQL'],
    ['Tab / Shift+Tab', 'Indent / outdent'],
    ['Ctrl+S', 'Save the editor as a .sql file'],
    ['Ctrl+Shift+N', 'New query tab'],
    ['Ctrl+Shift+O', 'Open database'],
    ['Alt+W', 'Close tab'],
    ['Alt+← / Alt+→', 'Previous / next tab'],
    ['Grid: arrows, PgUp/PgDn, Ctrl+C', 'Move, copy cell (Ctrl+Shift+C copies the row)'],
    ['Grid: Enter / double-click', 'Edit cell (tables with a primary key) or view the value'],
    ['Grid: Ctrl+Delete while editing', 'Set the cell to NULL'],
  ];
  modal({ title: 'Keyboard shortcuts', body: `<dl class="shortcuts">${rows.map(([k, v]) => `<dt>${k.split(' / ').map((x) => x.split('+').map((p) => `<kbd>${esc(p)}</kbd>`).join('+')).join(' / ')}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` });
}

function aboutDialog(): void {
  const v: Partial<NonNullable<Engine['version']>> = app.engine?.version ?? {};
  modal({
    title: 'About smaltui',
    body: `<p class="about-badges"><a href="https://smaltworks.dev/stability" target="_blank" rel="noopener" title="What work in progress means for you"><img class="logo-light" src="brand/badges/work-in-progress.svg" alt="Work in progress. Come build with us." height="56"><img class="logo-dark" src="brand/badges/work-in-progress-on-dark.svg" alt="Work in progress. Come build with us." height="56"></a></p>
      <p>smaltui is a SQL console for <a href="https://smaltdb.dev" target="_blank" rel="noopener">smaltdb</a> that runs entirely in the browser. It is a static site: serve the folder from any static host, and every visitor gets their own databases in their own browser.</p>
      <p>It is a work in progress: things change between releases, so keep the source data for anything you build here. Try it, break it, tell us on <a href="https://github.com/stenhoor/smaltui/issues" target="_blank" rel="noopener">GitHub</a>.</p>
      <dl class="kv" style="padding:0"><dt>Engine</dt><dd>${esc(app.engine?.label ?? '—')}</dd>
      ${v.version ? `<dt>smaltdb version</dt><dd>${esc(v.version)}</dd>` : ''}${v.commit ? `<dt>smaltdb commit</dt><dd>${esc(v.commit)}</dd>` : ''}
      ${Object.entries(v.packages ?? {}).filter(([n]) => n !== 'smaltdb').map(([n, p]) => `<dt>${esc(n)}</dt><dd>${esc(p.version)}${p.commit ? ' · ' + esc(p.commit.slice(0, 7)) : ''}</dd>`).join('')}
      <dt>Cross-origin isolated</dt><dd>${crossOriginIsolated ? 'yes (parallel readers, interruptible statements)' : 'no — serve with COOP/COEP headers for parallel readers'}</dd>
      <dt>OPFS</dt><dd>${opfsAvailable() ? 'available' : 'not available'}</dd>
      <dt>Database</dt><dd>${esc(app.dbName ?? '—')} (${esc(app.storage ?? '')}${app.db ? (db().isLeader ? ', owner tab' : ', shared with another tab') : ''})</dd></dl>
      <p class="about-badges"><a href="https://smaltworks.dev" target="_blank" rel="noopener"><img class="logo-light" src="brand/badges/a-smaltworks-project.svg" alt="A smaltworks project" height="28"><img class="logo-dark" src="brand/badges/a-smaltworks-project-on-dark.svg" alt="A smaltworks project" height="28"></a></p>`,
  });
}

function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  prefs.set('theme', root.dataset.theme);
}

function wireChrome() {
  $('#dbPicker').onclick = () => dbPicker();
  // Static buttons name their icon (data-icon); draw them.
  $$<HTMLElement>('[data-icon]').forEach((el) => el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon as IconName)));
  $('#btnNewQuery').onclick = () => newQueryTab();
  $('#btnNewTs').onclick = () => newTsTab();
  $('#btnImport').onclick = () => openImportTab();
  $('#btnHistory').onclick = () => openHistoryTab();
  $('#btnMore').onclick = () => ($('#moreMenu').hidden = !$('#moreMenu').hidden);
  $('#moreMenu').onclick = (e) => {
    const b = closest(e, '[data-act]');
    if (!b) return;
    $('#moreMenu').hidden = true;
    const act = b.dataset.act!;
    if (act === 'export-env') exportEnvironmentDialog();
    else if (act === 'export-sql') exportSqlDump(db()).then((s) => download(`${app.dbName}.sql`, s, 'application/sql')).catch((err) => toast(errText(err), 'err'));
    else if (act === 'load-env') openImportTab('env');
    else if (act === 'engine') engineDialog();
    else if (act === 'theme') toggleTheme();
    else if (act === 'shortcuts') shortcutsDialog();
    else if (act === 'about') aboutDialog();
  };
  $('.brand').onclick = () => {
    if (matchMedia('(max-width: 760px)').matches) document.body.classList.toggle('side-open');
  };
  const ws = $('.workspace');
  ws.style.setProperty('--side-w', prefs.get('sideWidth', 260) + 'px');
  dragSplit(
    $('#sideSplitter'),
    (ev) => ws.style.setProperty('--side-w', Math.max(160, Math.min(560, ev.clientX)) + 'px'),
    () => prefs.set('sideWidth', parseInt(ws.style.getPropertyValue('--side-w'))),
  );
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.shiftKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      newQueryTab();
    } else if (mod && e.shiftKey && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      dbPicker();
    } else if (e.altKey && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      if (app.active) closeTab(app.active);
    } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const i = app.active ? app.tabs.indexOf(app.active) : -1;
      const next = app.tabs[(i + (e.key === 'ArrowRight' ? 1 : app.tabs.length - 1)) % app.tabs.length];
      if (next) activateTab(next);
    } else if (e.key === 'F5' && app.active?.kind === 'table') {
      e.preventDefault();
      app.active.load(true);
    }
  });
  window.addEventListener('beforeunload', () => saveQueryTabs());
}

async function init() {
  wireChrome();
  wireTree();
  const params = new URLSearchParams(location.search);
  try {
    app.engine = await loadEngine();
    const v = app.engine.version;
    $('#stEngine').textContent = `smaltdb ${v?.version ?? ''}${v?.source === 'checkout' && v.commit ? ' @ ' + v.commit.slice(0, 8) : ''} · ${app.engine.label}`;
  } catch (e) {
    $('#stEngine').textContent = 'engine failed to load';
    $('#panes').innerHTML = `<div class="placeholder"><h3>The smaltdb engine could not be loaded</h3>${esc((e as Error).message)}<br><br>Run <code>npm install</code> to copy it into <code>vendor/smaltdb/</code>, or choose another source with <code>?engine=npm</code> or <code>?engine=&lt;url&gt;</code>.</div>`;
    return;
  }
  // Restore query tabs.
  const saved = prefs.get<{ title: string; sql: string }[]>('queryTabs', []);
  for (const q of saved) {
    const n = /^Query (\d+)$/.exec(q.title);
    if (n) querySeq = Math.max(querySeq, Number(n[1]));
  }
  const savedTs = prefs.get<{ title: string; source: string }[]>('tsTabs', []);
  for (const t of savedTs) {
    const n = /^TypeScript (\d+)$/.exec(t.title);
    if (n) tsSeq = Math.max(tsSeq, Number(n[1]));
  }
  const restoreTsTabs = () => {
    for (const t of savedTs) addTab(tsTab(t.title, t.source));
  };
  const envUrl = params.get('env');
  try {
    if (envUrl) {
      for (const q of saved) addTab(queryTab(q.title, q.sql));
      restoreTsTabs();
      await loadEnvironment(envUrl);
    } else {
      const last = prefs.get<{ name: string; storage: Storage } | null>('lastDb', null);
      const name = params.get('db') ?? last?.name ?? 'scratch';
      const storage = (params.get('storage') ?? (params.get('db') ? 'opfs' : last?.storage ?? 'opfs')) as Storage;
      await openDatabase(name, storage);
      if (!saved.length) addTab(welcomeTab());
      for (const q of saved) addTab(queryTab(q.title, q.sql));
      restoreTsTabs();
      if (!saved.length) newQueryTab({ sql: '-- Ctrl+Enter runs the statement under the cursor\nSELECT \'hello, smaltdb\' AS greeting, datetime(\'now\') AS now;\n' });
      activateTab(app.tabs.find((t) => t.kind === 'welcome') ?? app.tabs[0]);
    }
  } catch (e) {
    toast(errText(e), 'err');
    status(errText(e), 'err');
    if (!app.tabs.length) addTab(welcomeTab());
    if (!app.db) {
      try {
        await openDatabase('scratch', 'memory');
      } catch {}
    }
  }
  // ?sql=… opens (and runs) a shared query, e.g. from the landing page's console. It is removed
  // from the URL so a reload does not open it again.
  const shared = params.get('sql');
  if (shared && app.db) {
    const url = new URL(location.href);
    url.searchParams.delete('sql');
    history.replaceState(null, '', url);
    const existing = app.tabs.find((t): t is QueryTab => t.kind === 'query' && t.editor?.value.trim() === shared.trim());
    if (existing) {
      activateTab(existing);
      existing.run('script');
    } else {
      const t = newQueryTab({ title: 'Shared query', sql: shared.endsWith('\n') ? shared : shared + '\n' });
      t.run('script');
    }
  }
}

init();
