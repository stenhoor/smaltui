// A small SQL editor: a transparent <textarea> over a highlighted <pre>, with line numbers,
// auto-indent, comment toggling, bracket/quote pairing and a completion popup.
import { highlight, wordBefore, aliasesIn, statementAt, KEYWORDS, FUNCTIONS, unquote, type Statement } from './sql.js';

/** A column as the object explorer and completion know it. */
export interface SchemaColumn {
  name: string;
  type?: string | null;
  nullable?: boolean;
  pk?: boolean;
  generated?: boolean;
}

/** A table's columns, tagged with its kind ('table', 'view', 'matview', 'external', 'temp') and catalog type. */
export type SchemaTable = SchemaColumn[] & { kind?: string; type?: string };

/** What the editor needs from the schema: lower-cased object names (for highlighting) and columns per table. */
export interface EditorSchema {
  names: Set<string>;
  tables: Map<string, SchemaTable>;
}

export interface EditorOptions {
  value?: string;
  onChange?: (value: string) => void;
  schema?: () => EditorSchema;
  /** Shortcuts such as "Mod+Enter", "Shift+Mod+Enter", "F5", "Mod+E". */
  keys?: Record<string, (e: KeyboardEvent) => void>;
}

interface CompletionItem {
  label: string;
  kind: string;
  detail: string;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class Editor {
  opts: EditorOptions;
  host: HTMLElement;
  ta: HTMLTextAreaElement;
  hl: HTMLPreElement;
  lines: HTMLDivElement;
  gutter: HTMLDivElement;
  stmtMark: HTMLDivElement;
  popup: HTMLDivElement;
  errorRange: { start: number; end: number; cls: string } | null = null;
  lineCount = 0;
  compItems: CompletionItem[] = [];
  compStart = 0;
  compIndex = 0;
  private _lh = 0;
  private _cw = 0;

  constructor(host: HTMLElement, opts: EditorOptions = {}) {
    this.opts = opts;
    host.classList.add('editor');
    host.innerHTML = `<div class="ed-gutter"><div class="ed-lines"></div></div><div class="ed-body"><pre class="ed-hl" aria-hidden="true"></pre><div class="ed-stmt"></div><textarea class="ed-input" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" aria-label="SQL editor"></textarea></div><div class="ed-complete" role="listbox" hidden></div>`;
    this.host = host;
    this.ta = host.querySelector('textarea')!;
    this.hl = host.querySelector<HTMLPreElement>('.ed-hl')!;
    this.lines = host.querySelector<HTMLDivElement>('.ed-lines')!;
    this.gutter = host.querySelector<HTMLDivElement>('.ed-gutter')!;
    this.stmtMark = host.querySelector<HTMLDivElement>('.ed-stmt')!;
    this.popup = host.querySelector<HTMLDivElement>('.ed-complete')!;
    this.ta.value = opts.value ?? '';
    this.ta.addEventListener('input', () => this.changed());
    this.ta.addEventListener('scroll', () => this.syncScroll());
    this.ta.addEventListener('keydown', (e) => this.onKey(e));
    this.ta.addEventListener('click', () => {
      this.hideComplete();
      this.markStatement();
    });
    this.ta.addEventListener('keyup', (e) => {
      if (!['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(e.key) || this.popup.hidden) this.markStatement();
    });
    this.ta.addEventListener('blur', () => setTimeout(() => this.hideComplete(), 150));
    this.popup.addEventListener('mousedown', (e) => {
      const li = (e.target as Element | null)?.closest<HTMLElement>('[data-i]');
      if (!li) return;
      e.preventDefault();
      this.compIndex = Number(li.dataset.i);
      this.acceptComplete();
    });
    this.render();
  }

  get value(): string {
    return this.ta.value;
  }

  set value(v: string) {
    this.ta.value = v;
    this.render();
  }

  focus(): void {
    this.ta.focus();
  }

  /** Selected text, or '' */
  selection(): string {
    return this.ta.value.slice(this.ta.selectionStart, this.ta.selectionEnd);
  }

  selectionRange(): { start: number; end: number } {
    return { start: this.ta.selectionStart, end: this.ta.selectionEnd };
  }

  /** The statement under the cursor: { sql, start, end } */
  currentStatement(): Statement | null {
    return statementAt(this.ta.value, this.ta.selectionStart);
  }

  insert(text: string): void {
    this.ta.focus();
    const { selectionStart: s, selectionEnd: e } = this.ta;
    this.ta.setRangeText(text, s, e, 'end');
    this.changed();
  }

  /** Replace the whole text through the undo stack where supported. */
  replaceAll(text: string): void {
    this.ta.focus();
    this.ta.select();
    if (!document.execCommand?.('insertText', false, text)) this.ta.value = text;
    this.changed();
  }

  highlightRange(start: number | null, end = 0, cls = 'ed-err'): void {
    this.errorRange = start === null ? null : { start, end, cls };
    this.render();
  }

  changed(): void {
    this.errorRange = null;
    this.render();
    this.opts.onChange?.(this.ta.value);
    this.markStatement();
  }

  render(): void {
    const text = this.ta.value;
    const schema = this.opts.schema?.();
    let html = highlight(text, schema?.names);
    if (this.errorRange) {
      // Re-render with an error mark: simplest is to highlight the three slices separately.
      const { start, end, cls } = this.errorRange;
      html = highlight(text.slice(0, start), schema?.names).slice(0, -1) + `<mark class="${cls}">` + highlight(text.slice(start, end), schema?.names).slice(0, -1) + '</mark>' + highlight(text.slice(end), schema?.names);
    }
    this.hl.innerHTML = html;
    const n = text.split('\n').length;
    if (n !== this.lineCount) {
      this.lineCount = n;
      let s = '';
      for (let i = 1; i <= n; i++) s += i + '\n';
      this.lines.textContent = s;
    }
    this.syncScroll();
  }

  syncScroll(): void {
    this.hl.style.transform = `translate(${-this.ta.scrollLeft}px, ${-this.ta.scrollTop}px)`;
    this.stmtMark.style.transform = `translateY(${-this.ta.scrollTop}px)`;
    this.lines.style.transform = `translateY(${-this.ta.scrollTop}px)`;
  }

  /** Shade the lines of the statement under the cursor (what Ctrl+Enter runs). */
  markStatement(): void {
    const text = this.ta.value;
    if (this.ta.selectionStart !== this.ta.selectionEnd || !text.trim()) {
      this.stmtMark.style.display = 'none';
      return;
    }
    const st = statementAt(text, this.ta.selectionStart);
    if (!st) {
      this.stmtMark.style.display = 'none';
      return;
    }
    const lh = this.lineHeight();
    const l0 = text.slice(0, st.start).split('\n').length - 1;
    const l1 = text.slice(0, st.end).split('\n').length - 1;
    this.stmtMark.style.display = '';
    this.stmtMark.style.top = 8 + l0 * lh + 'px';
    this.stmtMark.style.height = (l1 - l0 + 1) * lh + 'px';
  }

  lineHeight(): number {
    if (!this._lh) this._lh = parseFloat(getComputedStyle(this.ta).lineHeight) || 20;
    return this._lh;
  }

  onKey(e: KeyboardEvent): void {
    const ta = this.ta;
    const mod = e.ctrlKey || e.metaKey;
    if (!this.popup.hidden) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = this.compItems.length;
        this.compIndex = (this.compIndex + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        this.renderComplete();
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        this.acceptComplete();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this.hideComplete();
        return;
      }
    }
    // Application shortcuts (run, explain, …)
    for (const [combo, fn] of Object.entries(this.opts.keys ?? {})) {
      if (matchCombo(e, combo)) {
        e.preventDefault();
        this.hideComplete();
        fn(e);
        return;
      }
    }
    if (mod && e.key === ' ') {
      e.preventDefault();
      this.showComplete(true);
      return;
    }
    if (mod && e.key === '/') {
      e.preventDefault();
      this.toggleComment();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      this.indent(e.shiftKey);
      return;
    }
    if (e.key === 'Enter' && !mod && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      const s = ta.selectionStart;
      const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
      const indent = /^[ \t]*/.exec(ta.value.slice(lineStart, s))?.[0] ?? '';
      const before = ta.value.slice(lineStart, s).trimEnd();
      const extra = before.endsWith('(') ? '  ' : '';
      document.execCommand?.('insertText', false, '\n' + indent + extra) || this.insert('\n' + indent + extra);
      return;
    }
    const pairs: Record<string, string> = { '(': ')', "'": "'", '"': '"' };
    if (pairs[e.key] && !mod) {
      const { selectionStart: s, selectionEnd: en } = ta;
      if (s !== en) {
        e.preventDefault();
        const inner = ta.value.slice(s, en);
        document.execCommand?.('insertText', false, e.key + inner + pairs[e.key]) || this.insert(e.key + inner + pairs[e.key]);
        return;
      }
    }
    if (e.key === ')' && ta.value[ta.selectionStart] === ')' && ta.selectionStart === ta.selectionEnd) {
      // Typing over an auto-inserted closer is not tracked; leave typing as is.
    }
    // Auto-complete after a dot or while typing a word.
    if (!mod && e.key.length === 1) {
      queueMicrotask(() => {
        const { word, qualifier } = wordBefore(ta.value, ta.selectionStart);
        if (qualifier !== null || word.length >= 2) this.showComplete(false);
        else this.hideComplete();
      });
    } else if (e.key === 'Backspace') {
      queueMicrotask(() => (this.popup.hidden ? null : this.showComplete(false)));
    }
  }

  indent(outdent: boolean): void {
    const ta = this.ta;
    const v = ta.value;
    let { selectionStart: s, selectionEnd: e } = ta;
    if (s === e && !outdent) {
      document.execCommand?.('insertText', false, '  ') || this.insert('  ');
      return;
    }
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    const block = v.slice(ls, e);
    const out = outdent ? block.replace(/^ {1,2}/gm, '') : block.replace(/^/gm, '  ');
    ta.setSelectionRange(ls, e);
    document.execCommand?.('insertText', false, out) || ta.setRangeText(out, ls, e, 'select');
    ta.setSelectionRange(ls, ls + out.length);
    this.changed();
  }

  toggleComment(): void {
    const ta = this.ta;
    const v = ta.value;
    const { selectionStart: s, selectionEnd: e } = ta;
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    let le = v.indexOf('\n', Math.max(e - (e > s && v[e - 1] === '\n' ? 1 : 0), s));
    if (le < 0) le = v.length;
    const block = v.slice(ls, le);
    const lines = block.split('\n');
    const all = lines.filter((l) => l.trim()).every((l) => /^\s*--/.test(l));
    const out = lines.map((l) => (all ? l.replace(/^(\s*)-- ?/, '$1') : l.trim() ? '-- ' + l : l)).join('\n');
    ta.setSelectionRange(ls, le);
    document.execCommand?.('insertText', false, out) || ta.setRangeText(out, ls, le, 'select');
    ta.setSelectionRange(ls, ls + out.length);
    this.changed();
  }

  // ---------------------------------------------------------------- completion

  candidates(explicit: boolean): { items: CompletionItem[]; start: number } {
    const v = this.ta.value;
    const pos = this.ta.selectionStart;
    const { word, start, qualifier } = wordBefore(v, pos);
    const schema: EditorSchema = this.opts.schema?.() ?? { names: new Set(), tables: new Map() };
    const w = word.toLowerCase();
    const items: CompletionItem[] = [];
    const seen = new Set<string>();
    const add = (label: string, kind: string, detail: string | null | undefined = '') => {
      const key = kind + ':' + label.toLowerCase();
      if (seen.has(key) || !label.toLowerCase().startsWith(w)) return;
      if (!explicit && label.toLowerCase() === w) return;
      seen.add(key);
      items.push({ label, kind, detail: detail ?? '' });
    };
    if (qualifier !== null) {
      const st = statementAt(v, pos);
      const tableNames = new Set([...schema.tables.keys()].map((k) => k.toLowerCase()));
      const aliases = aliasesIn(st?.sql ?? v, tableNames);
      const tname = aliases.get(qualifier.toLowerCase()) ?? qualifier;
      const cols = findTable(schema.tables, tname);
      if (cols) for (const c of cols) add(c.name, 'col', c.type);
      return { items, start };
    }
    // Columns of tables referenced in the current statement first.
    const st = statementAt(v, pos);
    if (st) {
      const tableNames = new Set([...schema.tables.keys()].map((k) => k.toLowerCase()));
      for (const t of new Set(aliasesIn(st.sql, tableNames).values())) for (const c of findTable(schema.tables, t) ?? []) add(c.name, 'col', `${t}.${c.type ?? ''}`);
    }
    for (const [t, cols] of schema.tables) add(t, cols.kind ?? 'table', cols.kind === 'view' ? 'view' : '');
    for (const f of FUNCTIONS) add(f, 'fn');
    for (const k of KEYWORDS) add(k, 'kw');
    return { items: items.slice(0, 60), start };
  }

  showComplete(explicit: boolean): void {
    const { items, start } = this.candidates(explicit);
    if (!items.length) {
      this.hideComplete();
      return;
    }
    this.compItems = items;
    this.compStart = start;
    this.compIndex = 0;
    this.renderComplete();
    // Position under the caret.
    const v = this.ta.value.slice(0, this.ta.selectionStart);
    const line = v.split('\n').length - 1;
    const col = v.length - v.lastIndexOf('\n') - 1;
    const lh = this.lineHeight();
    const cw = this.charWidth();
    const body = this.ta.getBoundingClientRect();
    const hostR = this.host.getBoundingClientRect();
    let x = body.left - hostR.left + 12 + col * cw - this.ta.scrollLeft;
    let y = body.top - hostR.top + 8 + (line + 1) * lh - this.ta.scrollTop + 2;
    x = Math.min(x, hostR.width - 260);
    if (y + 220 > hostR.height) y = Math.max(0, y - 220 - lh - 4);
    this.popup.style.left = Math.max(0, x) + 'px';
    this.popup.style.top = y + 'px';
    this.popup.hidden = false;
  }

  charWidth(): number {
    if (!this._cw) {
      const s = document.createElement('span');
      s.textContent = 'MMMMMMMMMM';
      s.style.visibility = 'hidden';
      this.hl.appendChild(s);
      this._cw = s.getBoundingClientRect().width / 10 || 8;
      s.remove();
    }
    return this._cw;
  }

  renderComplete(): void {
    this.popup.innerHTML = this.compItems
      .map((it, i) => `<div class="ac-item${i === this.compIndex ? ' active' : ''}" data-i="${i}" role="option"><span class="ac-kind ac-${it.kind}">${it.kind}</span><span class="ac-label">${esc(it.label)}</span><span class="ac-detail">${esc(it.detail || '')}</span></div>`)
      .join('');
    this.popup.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  acceptComplete(): void {
    const it = this.compItems[this.compIndex];
    if (!it) return;
    const ta = this.ta;
    let text = it.label;
    if (it.kind === 'fn') text += '(';
    ta.setSelectionRange(this.compStart, ta.selectionStart);
    document.execCommand?.('insertText', false, text) || ta.setRangeText(text, this.compStart, ta.selectionEnd, 'end');
    this.hideComplete();
    this.changed();
  }

  hideComplete(): void {
    this.popup.hidden = true;
  }
}

function findTable(tables: Map<string, SchemaTable>, name: string): SchemaTable | null {
  const n = unquote(name).toLowerCase();
  for (const [t, cols] of tables) if (t.toLowerCase() === n) return cols;
  return null;
}

/** "Mod+Enter", "Shift+Mod+Enter", "F5", "Mod+E" */
function matchCombo(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.split('+');
  const key = parts.pop() ?? '';
  const want = new Set(parts.map((p) => p.toLowerCase()));
  const mod = e.ctrlKey || e.metaKey;
  if (want.has('mod') !== mod) return false;
  if (want.has('shift') !== e.shiftKey) return false;
  if (want.has('alt') !== e.altKey) return false;
  return e.key.toLowerCase() === key.toLowerCase();
}
