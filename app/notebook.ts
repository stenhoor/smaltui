// Notebooks: a page of cells that run against the open database, top to bottom.
//
//   SQL cells (smaltql)        one or more statements; the last statement that returns rows is shown as a grid
//   Dataframe cells (smaltdf)  TypeScript-style JavaScript with smaltdf in scope: `pl`, `col`, `lit`, `when`, `len`, …
//
// Every cell's result is named after its number: `_1`, `_2`, … (and `_` is the previous cell's). A SQL cell's result is a
// smaltdf LazyFrame over its last query, so a dataframe cell can build on it: `_1.filter(col('qty').gt(1))`. A
// dataframe cell's value is the value of its last expression, or what it returns. LazyFrames are collected for display
// (the first rows only), DataFrames and arrays of objects are shown as grids, anything else as text.
//
// smaltdf is loaded on first use from vendor/smaltdf/ (scripts/vendor-smaltdb.mjs). Code in a dataframe cell runs in
// this page, like code typed into the browser console: a notebook only runs when you press Run.

import type * as Df from '@smaltdb/df';
import type { Database } from './engine.js';
import { Editor, type EditorSchema } from './editor.js';
import { Grid, type Row, type Value } from './grid.js';
import { changesSchema, returnsRows, splitStatements } from './sql.js';

export type CellKind = 'sql' | 'df';

export interface NotebookCell {
  kind: CellKind;
  source: string;
}

/** A notebook as saved: in this browser, in an environment manifest ("notebooks") or as a .smaltnb.json file. */
export interface NotebookDoc {
  smaltnb?: 1;
  title: string;
  cells: NotebookCell[];
}

export interface NotebookHost {
  db(): Database;
  schema(): EditorSchema;
  refreshSchema(): Promise<void>;
  onChange(doc: NotebookDoc): void;
  onBusy(busy: boolean): void;
  showValue(value: Value, title: string): void;
  toast(text: string, kind?: string): void;
}

type DfModule = typeof Df;
type Pl = ReturnType<DfModule['smaltdf']>;

const SHOW_ROWS = 1000;
const DF_URL = new URL('../vendor/smaltdf/smaltdf.js', import.meta.url).href;
let dfModule: Promise<DfModule> | null = null;
/** smaltdf, loaded once on first use. */
export const loadSmaltdf = (): Promise<DfModule> => (dfModule ??= import(/* @vite-ignore */ DF_URL) as Promise<DfModule>);

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const now = (): number => performance.now();
const fmtMs = (ms: number): string => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`);
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...a: unknown[]) => Promise<unknown>;

function el<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}

const LABEL: Record<CellKind, { name: string; lang: string; hint: string }> = {
  sql: { name: 'SQL', lang: 'smaltql', hint: 'SQL statements; Ctrl+Enter runs the cell' },
  df: { name: 'Dataframe', lang: 'smaltdf', hint: "pl.scanTable('orders').groupBy('region').agg(col('qty').sum()); Ctrl+Enter runs the cell" },
};

interface CellView {
  kind: CellKind;
  el: HTMLElement;
  editor?: Editor;
  area?: HTMLTextAreaElement;
  out: HTMLElement;
  value(): string;
  focus(): void;
}

/** One notebook's page. */
export class Notebook {
  readonly el: HTMLElement;
  title: string;
  private host: NotebookHost;
  private cells: CellView[] = [];
  private list: HTMLElement;
  private running = false;
  private scope: Record<string, unknown> = {};

  constructor(host: NotebookHost, doc: NotebookDoc) {
    this.host = host;
    this.title = doc.title;
    this.el = el(`<div class="notebook">
      <div class="toolbar nb-bar">
        <button class="primary" data-nb="run-all" title="Run every cell, top to bottom">▶ Run all</button>
        <button data-nb="add-sql" title="Add a SQL cell">＋ SQL</button>
        <button data-nb="add-df" title="Add a dataframe cell">＋ Dataframe</button>
        <span class="grow"></span>
        <span class="nb-status" data-nb-status role="status"></span>
        <button class="ghost" data-nb="export" title="Download this notebook as a .smaltnb.json file">⇩ Save file</button>
      </div>
      <div class="scroll-page"><div class="nb-cells"></div>
        <div class="nb-add"><button data-nb="add-sql">＋ SQL cell</button><button data-nb="add-df">＋ Dataframe cell</button></div>
        <p class="nb-help">SQL cells run in <b>smaltql</b>; dataframe cells use <b>smaltdf</b> (<code>pl</code>, <code>col</code>, <code>lit</code>, <code>when</code>, <code>len</code>, …). Each cell's result is <code>_1</code>, <code>_2</code>, … for the cells below it; a SQL cell's result is a LazyFrame over its query.</p>
      </div>
    </div>`);
    this.list = this.el.querySelector('.nb-cells')!;
    for (const c of doc.cells) this.addCell(c.kind, c.source, false);
    if (doc.cells.length === 0) this.addCell('sql', '', false);
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-nb]');
      if (!b) return;
      const act = b.dataset.nb!;
      if (act === 'run-all') void this.runAll();
      else if (act === 'add-sql') this.addCell('sql', '').focus();
      else if (act === 'add-df') this.addCell('df', '').focus();
      else if (act === 'export') this.download();
    });
  }

  doc(): NotebookDoc {
    return { smaltnb: 1, title: this.title, cells: this.cells.map((c) => ({ kind: c.kind, source: c.value() })) };
  }

  /** Rebuild completions after the schema changed (the SQL editors read it lazily, so nothing to do). */
  focus(): void {
    this.cells[0]?.focus();
  }

  private changed(): void {
    this.host.onChange(this.doc());
  }

  private status(text: string, err = false): void {
    const s = this.el.querySelector<HTMLElement>('[data-nb-status]')!;
    s.textContent = text;
    s.classList.toggle('err', err);
  }

  addCell(kind: CellKind, source: string, notify = true, after?: CellView): CellView {
    const label = LABEL[kind];
    const box = el(`<section class="nb-cell nb-${kind}">
      <div class="nb-head">
        <span class="nb-num"></span>
        <span class="nb-lang" title="${esc(label.hint)}">${label.lang}</span>
        <span class="grow"></span>
        <button class="icon" data-c="run" title="Run this cell (Ctrl+Enter)">▶</button>
        <button class="icon" data-c="up" title="Move up">↑</button>
        <button class="icon" data-c="down" title="Move down">↓</button>
        <button class="icon" data-c="del" title="Delete cell">✕</button>
      </div>
      <div class="nb-src"></div>
      <div class="nb-out" hidden></div>
    </section>`);
    const src = box.querySelector<HTMLElement>('.nb-src')!;
    const view: CellView = { kind, el: box, out: box.querySelector<HTMLElement>('.nb-out')!, value: () => '', focus: () => {} };
    const runKeys = { 'Mod+Enter': () => void this.runFrom(view, false), 'Shift+Enter': () => void this.runFrom(view, false, true) };
    if (kind === 'sql') {
      const host = src.appendChild(el('<div class="nb-editor"></div>'));
      view.editor = new Editor(host, { value: source, schema: () => this.host.schema(), onChange: () => (this.fit(view), this.changed()), keys: runKeys });
      view.value = () => view.editor!.value;
      view.focus = () => view.editor!.focus();
    } else {
      const area = src.appendChild(el<HTMLTextAreaElement>(`<textarea class="nb-code" spellcheck="false" placeholder="${esc(label.hint)}"></textarea>`));
      area.value = source;
      area.addEventListener('input', () => (this.fit(view), this.changed()));
      area.addEventListener('keydown', (e) => {
        const mod = e.ctrlKey || e.metaKey;
        if (e.key === 'Enter' && (mod || e.shiftKey)) {
          e.preventDefault();
          void this.runFrom(view, false, e.shiftKey && !mod);
        } else if (e.key === 'Tab' && !mod) {
          e.preventDefault();
          const { selectionStart: a, selectionEnd: b } = area;
          area.setRangeText('  ', a, b, 'end');
          this.changed();
        }
      });
      view.area = area;
      view.value = () => area.value;
      view.focus = () => area.focus();
    }
    box.querySelector('.nb-head')!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-c]');
      if (!b) return;
      const i = this.cells.indexOf(view);
      const act = b.dataset.c!;
      if (act === 'run') void this.runFrom(view, false);
      else if (act === 'del') {
        this.cells.splice(i, 1);
        box.remove();
        if (this.cells.length === 0) this.addCell('sql', '', false);
        this.renumber();
        this.changed();
      } else if (act === 'up' || act === 'down') {
        const j = act === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= this.cells.length) return;
        this.cells.splice(i, 1);
        this.cells.splice(j, 0, view);
        if (act === 'up') this.list.insertBefore(box, this.cells[j + 1].el);
        else this.list.insertBefore(box, this.cells[j - 1].el.nextSibling);
        this.renumber();
        this.changed();
      }
    });
    const at = after ? this.cells.indexOf(after) + 1 : this.cells.length;
    this.cells.splice(at, 0, view);
    this.list.insertBefore(box, this.cells[at + 1]?.el ?? null);
    this.renumber();
    requestAnimationFrame(() => this.fit(view));
    if (notify) this.changed();
    return view;
  }

  /** Grow a cell's editor with its text (no inner scrolling for short cells). */
  private fit(view: CellView): void {
    const lines = Math.min(Math.max(view.value().split('\n').length, 2), 30);
    const px = lines * 19 + 14;
    if (view.area) view.area.style.height = `${px}px`;
    else (view.el.querySelector('.nb-editor') as HTMLElement).style.height = `${px}px`;
  }

  private renumber(): void {
    this.cells.forEach((c, i) => (c.el.querySelector('.nb-num')!.textContent = `[${i + 1}]`));
  }

  async runAll(): Promise<void> {
    if (this.cells.length) await this.runFrom(this.cells[0], true);
  }

  /** Run one cell (all: and every cell after it). Cells above it keep their results in scope. */
  private async runFrom(start: CellView, all: boolean, advance = false): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.host.onBusy(true);
    const t0 = now();
    const from = this.cells.indexOf(start);
    const upto = all ? this.cells.length : from + 1;
    let ran = 0;
    try {
      for (let i = from; i < upto; i++) {
        const ok = await this.runCell(this.cells[i], i);
        ran++;
        if (!ok) {
          this.status(`Stopped at cell [${i + 1}]`, true);
          return;
        }
      }
      this.status(`${ran} cell${ran === 1 ? '' : 's'} in ${fmtMs(now() - t0)}`);
      if (advance) {
        const next = this.cells[from + 1] ?? this.addCell(start.kind, '');
        next.focus();
      }
    } finally {
      this.running = false;
      this.host.onBusy(false);
    }
  }

  private async runCell(view: CellView, index: number): Promise<boolean> {
    const out = view.out;
    out.hidden = false;
    out.className = 'nb-out running';
    out.innerHTML = '<div class="nb-msg">Running…</div>';
    view.el.classList.add('is-running');
    const t0 = now();
    try {
      const value = view.kind === 'sql' ? await this.runSql(view.value()) : await this.runDf(view.value());
      this.scope[`_${index + 1}`] = value.result;
      this.scope._ = value.result;
      await this.show(out, value.display, now() - t0);
      return true;
    } catch (e) {
      out.className = 'nb-out err';
      out.innerHTML = `<div class="nb-msg"><b>Error</b> ${esc(errText(e))}</div>`;
      return false;
    } finally {
      view.el.classList.remove('is-running');
    }
  }

  private async pl(): Promise<{ df: DfModule; pl: Pl }> {
    const df = await loadSmaltdf();
    return { df, pl: df.smaltdf(this.host.db()) };
  }

  /** Statements in order; the last one that returns rows is shown, and is the cell's result as a LazyFrame. */
  private async runSql(text: string): Promise<{ result: unknown; display: unknown }> {
    const db = this.host.db();
    const stmts = splitStatements(text).filter((s) => s.sql.trim());
    if (stmts.length === 0) return { result: undefined, display: undefined };
    let last: { sql: string; columns: string[]; rows: Row[]; more: boolean } | null = null;
    let changed = 0;
    let schema = false;
    for (const s of stmts) {
      if (returnsRows(s.sql)) {
        const it = db.stream(s.sql, undefined, { rowMode: 'array', batchSize: 500 });
        const rows: Row[] = [];
        let columns: string[] = [];
        let more = false;
        for (;;) {
          const n = await it.next();
          if (n.done) break;
          columns = n.value.columns;
          for (const r of n.value) rows.push(r as Row);
          if (rows.length >= SHOW_ROWS) {
            more = true;
            await it.return?.();
            break;
          }
        }
        if (columns.length === 0) columns = (await db.query(`SELECT * FROM (${s.sql.replace(/;\s*$/, '')}) LIMIT 0`, undefined, { rowMode: 'array' })).columns;
        last = { sql: s.sql, columns, rows: rows.slice(0, SHOW_ROWS), more };
      } else {
        const r = await db.exec(s.sql);
        changed += r.changes ?? 0;
        if (changesSchema(s.sql)) schema = true;
      }
    }
    if (schema) await this.host.refreshSchema();
    if (!last) return { result: undefined, display: `${stmts.length} statement${stmts.length === 1 ? '' : 's'} done${changed ? `, ${changed} row${changed === 1 ? '' : 's'} changed` : ''}` };
    const { pl } = await this.pl();
    const sql = last.sql.trim().replace(/;\s*$/, '');
    return { result: pl.scanSql(sql), display: { columns: last.columns, rows: last.rows, more: last.more } };
  }

  /** The cell's code as the body of an async function, with smaltdf and the earlier results in scope. */
  private async runDf(code: string): Promise<{ result: unknown; display: unknown }> {
    if (!code.trim()) return { result: undefined, display: undefined };
    const { pl } = await this.pl();
    const env: Record<string, unknown> = {
      pl,
      db: this.host.db(),
      col: pl.col,
      lit: pl.lit,
      when: pl.when,
      len: pl.len,
      all: pl.all,
      sum: pl.sum,
      mean: pl.mean,
      min: pl.min,
      max: pl.max,
      count: pl.count,
      ...this.scope,
    };
    const names = Object.keys(env).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n));
    // A single expression is the cell's value; anything else is a function body that may `return` one.
    const body = code.replace(/;\s*$/, '');
    let fn: (...a: unknown[]) => Promise<unknown>;
    try {
      fn = new AsyncFunction(...names, `return (\n${body}\n);`);
    } catch {
      fn = new AsyncFunction(...names, code);
    }
    const result = await fn(...names.map((n) => env[n]));
    return { result, display: result };
  }

  private async show(out: HTMLElement, value: unknown, ms: number): Promise<void> {
    out.className = 'nb-out';
    out.innerHTML = '';
    const meta = (text: string) => out.appendChild(el(`<div class="nb-meta">${esc(text)} · ${fmtMs(ms)}</div>`));
    const df = dfModule ? await dfModule : null;
    if (df && value instanceof df.LazyFrame) value = await value.head(SHOW_ROWS + 1).collect();
    if (df && value instanceof df.DataFrame) {
      const rows = value.rows() as Row[];
      const more = rows.length > SHOW_ROWS;
      this.grid(out, value.columns, more ? rows.slice(0, SHOW_ROWS) : rows);
      meta(`${more ? `first ${SHOW_ROWS} rows` : `${rows.length} row${rows.length === 1 ? '' : 's'}`} × ${value.columns.length} column${value.columns.length === 1 ? '' : 's'}`);
      return;
    }
    if (value && typeof value === 'object' && 'columns' in value && 'rows' in value && Array.isArray((value as { rows: unknown }).rows)) {
      const r = value as { columns: string[]; rows: Row[]; more?: boolean };
      this.grid(out, r.columns, r.rows);
      meta(`${r.more ? `first ${r.rows.length} rows` : `${r.rows.length} row${r.rows.length === 1 ? '' : 's'}`}`);
      return;
    }
    if (Array.isArray(value) && value.length && value.every((v) => v && typeof v === 'object' && !Array.isArray(v))) {
      const columns = [...new Set(value.flatMap((v) => Object.keys(v as object)))];
      this.grid(out, columns, value.slice(0, SHOW_ROWS).map((v) => columns.map((c) => toValue((v as Record<string, unknown>)[c]))));
      meta(`${value.length} row${value.length === 1 ? '' : 's'}`);
      return;
    }
    if (value === undefined) {
      out.appendChild(el('<div class="nb-msg">Done</div>'));
      meta('no value');
      return;
    }
    out.appendChild(el(`<pre class="nb-text">${esc(typeof value === 'string' ? value : stringify(value))}</pre>`));
    meta(typeof value);
  }

  private grid(out: HTMLElement, columns: string[], rows: Row[]): void {
    const box = out.appendChild(el('<div class="nb-grid"><div class="grid"></div></div>'));
    box.style.height = `${Math.min(rows.length, 12) * 26 + 34}px`;
    const g = new Grid(box.firstElementChild as HTMLElement, { emptyText: 'No rows', onOpenValue: (r, c) => this.host.showValue(rows[r][c], columns[c]) });
    g.setData(columns, rows);
  }

  private download(): void {
    const blob = new Blob([JSON.stringify(this.doc(), null, 2) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.title.replace(/[^\w.-]+/g, '_') || 'notebook'}.smaltnb.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}

function toValue(v: unknown): Value {
  if (v === null || v === undefined || typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint' || v instanceof Uint8Array) return v as Value;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return stringify(v);
}

function stringify(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x), 2) ?? String(v);
  } catch {
    return String(v);
  }
}

/** Check that a parsed file is a notebook. */
export function asNotebook(data: unknown): NotebookDoc {
  const d = data as Partial<NotebookDoc> | null;
  if (!d || typeof d !== 'object' || !Array.isArray(d.cells)) throw new Error('Not a notebook: expected { "title": …, "cells": [ … ] }');
  const cells = d.cells.map((c, i) => {
    if (!c || (c.kind !== 'sql' && c.kind !== 'df') || typeof c.source !== 'string') throw new Error(`Notebook cell ${i + 1}: expected { "kind": "sql" | "df", "source": "…" }`);
    return { kind: c.kind, source: c.source };
  });
  return { smaltnb: 1, title: typeof d.title === 'string' && d.title ? d.title : 'Notebook', cells };
}
