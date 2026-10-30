import { ICON_PX, type Bang, type Message, type QueryResponse, type Result, type SettingEdit, type Where } from '../shared/messages';

const MAX_ROWS = 8;
const SVG_NS = 'http://www.w3.org/2000/svg';

const ICONS = {
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z', 'm20 20-4-4'],
  gear: [
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    'M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  ],
  arrow: ['M5 12h14', 'm13 6 6 6-6 6'],
};

/** Builds a stroked SVG icon without innerHTML (pages may enforce Trusted Types). */
export function icon(paths: string[], cls: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

/** Minifies smaller than addEventListener (this ships in content.js). */
function on<K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, listener: (e: HTMLElementEventMap[K]) => void): void {
  target.addEventListener(type, listener);
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  e.append(...children);
  return e;
}

/** Native where available (Chrome 140+): a JS loop over 4 KB per icon is slow before it's optimized. */
function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const native = (Uint8Array as { fromBase64?: (s: string) => Uint8Array<ArrayBuffer> }).fromBase64;
  if (native) return native.call(Uint8Array, s);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function send<T>(msg: Message): Promise<T | undefined> {
  try {
    return chrome.runtime.sendMessage<Message, T>(msg).catch(() => undefined);
  } catch {
    // Extension context invalidated (the extension was reloaded under this page).
    return Promise.resolve(undefined);
  }
}

interface Row {
  el: HTMLElement;
  favicon: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Icon currently drawn on `favicon`. */
  icon: string | undefined;
  search: SVGSVGElement;
  gear: SVGSVGElement;
  title: HTMLElement;
  sep: HTMLElement;
  sub: HTMLElement;
  badge: HTMLElement;
  /** A setting's current value. */
  value: HTMLElement;
  swatch: HTMLElement;
  valueText: HTMLElement;
}

export interface PaletteOptions {
  /** True on the extension's own palette page (new tab / fallback), false for the in-page overlay. */
  page: boolean;
  /** Asks the host to hide the palette. `restoreFocus` is false when focus already moved elsewhere. */
  onClose(restoreFocus: boolean): void;
}

export class Palette {
  readonly #opts: PaletteOptions;
  readonly #panel: HTMLElement;
  readonly #input: HTMLInputElement;
  readonly #list: HTMLElement;
  /** Names the options level in the bar. */
  readonly #chip: HTMLElement;
  /** The selected setting's help. */
  readonly #foot: HTMLElement;
  readonly #picker: HTMLInputElement;
  readonly #rows: Row[] = [];
  #results: Result[] = [];
  #selected = 0;
  /** Id of the latest query sent, and of the one whose results are displayed. */
  #sent = 0;
  #shown = 0;
  /** Enter was pressed before the latest results arrived; holds its Shift state. */
  #pendingEnter: boolean | null = null;
  /** In options mode. */
  #options = false;
  /** The open submenu, if any. */
  #menu: { key: string; label: string } | null = null;
  /** The setting being edited, and the filter to restore after. */
  #editing: SettingEdit | null = null;
  #filter = '';
  /** The bang in the chip; queries carry it. */
  #bang: Bang | null = null;

  constructor(parent: Node, opts: PaletteOptions) {
    this.#opts = opts;
    this.#input = el('input', 'input');
    this.#input.placeholder = 'Search...';
    this.#input.spellcheck = false;
    this.#input.autocomplete = 'off';

    const list = (this.#list = el('div', 'list'));
    this.#addRows(MAX_ROWS);
    this.#chip = el('span', 'chip');
    this.#chip.hidden = true;
    on(this.#chip, 'click', () => this.#escape());
    this.#foot = el('div', 'foot');
    this.#foot.hidden = true;
    this.#picker = el('input', 'picker');
    this.#picker.type = 'color';
    this.#picker.tabIndex = -1;
    this.#picker.hidden = true;

    this.#panel = el('div', 'panel empty', el('label', 'bar', icon(ICONS.search, 'search'), this.#chip, this.#input, this.#picker), list, this.#foot);
    if (opts.page) {
      // A page loads before its results arrive: stay invisible until they render, rather
      // than showing a bare bar that then grows (the overlay gets results before it shows).
      this.#panel.classList.add('pending');
      setTimeout(() => this.#panel.classList.remove('pending'), 150);
    }
    parent.appendChild(this.#panel);

    on(this.#input, 'input', () => (this.#editing ? this.#preview() : this.#query(this.#input.value)));
    on(this.#input, 'keydown', (e) => this.#onKey(e));
    // The native color picker takes focus while open; that blur mustn't close the overlay.
    on(this.#input, 'blur', (e) => opts.page || e.relatedTarget === this.#picker || opts.onClose(false));
    on(this.#picker, 'input', () => {
      this.#input.value = this.#picker.value;
      this.#preview();
    });
    on(this.#picker, 'change', () => this.#input.focus());
    on(this.#picker, 'keydown', (e) => {
      this.#input.focus();
      this.#onKey(e);
    });
    // Keep focus in the input when clicking elsewhere in the panel: losing it closes the overlay.
    on(this.#panel, 'mousedown', (e) => e.target !== this.#input && e.target !== this.#picker && e.preventDefault());
    on(list, 'mousemove', (e) => {
      const i = this.#rowIndex(e);
      if (i >= 0 && i !== this.#selected && !this.#editing) this.#select(i);
    });
    on(list, 'click', (e) => {
      const i = this.#rowIndex(e);
      if (i < 0) return;
      // While editing, a click switches colors, or steps the choice whose URL is being edited.
      if (this.#editing) {
        const setting = this.#results[i]?.setting;
        if (this.#editing.color) this.#switchEdit(i);
        else if (i === this.#selected && setting?.control === 'choice') {
          this.#finishEdit(false);
          this.#set(setting.key, e.shiftKey ? -1 : 1);
        }
      } else this.#activate(i, e.shiftKey);
    });
  }

  /** Options mode can list more than MAX_ROWS. */
  #addRows(n: number): void {
    while (this.#rows.length < n) {
      const favicon = el('canvas', 'icon');
      favicon.width = favicon.height = ICON_PX;
      const swatch = el('span', 'swatch');
      const valueText = el('span', 'vtext');
      const row: Row = {
        el: el('div', 'row'),
        favicon,
        ctx: favicon.getContext('2d')!,
        icon: undefined,
        search: icon(ICONS.search, 'icon glyph'),
        gear: icon(ICONS.gear, 'icon glyph'),
        title: el('span', 'title'),
        sep: el('span', 'sub', document.createTextNode(' — ')),
        sub: el('span', 'sub'),
        badge: el('span', 'badge', el('span', 'label', document.createTextNode('Switch to Tab')), el('span', 'key', icon(ICONS.arrow, 'arrow'))),
        value: el('span', 'value', swatch, valueText),
        swatch,
        valueText,
      };
      row.el.dataset.i = String(this.#rows.length);
      row.el.hidden = true;
      row.value.hidden = true;
      row.el.append(row.favicon, row.search, row.gear, el('span', 'text', row.title, row.sep, row.sub), row.badge, row.value);
      this.#list.append(row.el);
      this.#rows.push(row);
    }
  }

  /**
   * Clears the input and focuses it. Renders `results` (the empty-query results sent
   * with the shortcut) synchronously, so they're in the first visible frame, or asks for them.
   */
  open(results?: Result[]): void {
    this.reset();
    if (results) this.#show(this.#sent, results);
    else this.#query('');
    this.#input.focus({ preventScroll: true });
  }

  /**
   * Lays out every part of the palette once, so the first open doesn't pay for font
   * setup and text shaping (tens of ms on slow machines). The caller makes it renderable
   * around this call, in the same task, so nothing is painted.
   */
  warm(): void {
    const empty = this.#panel.classList.contains('empty');
    const hidden = this.#rows.map((r) => r.el.hidden);
    this.#panel.classList.remove('empty');
    for (const r of this.#rows) r.el.hidden = false;
    void this.#panel.offsetHeight;
    this.#panel.classList.toggle('empty', empty);
    this.#rows.forEach((r, i) => (r.el.hidden = hidden[i]));
  }

  openOptions(): void {
    this.reset();
    this.#setMode(true);
    this.#clear();
    this.#input.focus({ preventScroll: true });
  }

  /** Clears the input, leaves options mode, and drops any results still in flight. */
  reset(): void {
    this.#input.value = '';
    this.#pendingEnter = null;
    this.#sent++;
    this.#setBang(null);
    if (this.#options) this.#setMode(false);
  }

  #setMode(options: boolean): void {
    this.#options = options;
    this.#editing = null;
    this.#menu = null;
    this.#input.placeholder = options ? 'Search options...' : 'Search...';
    this.#updateChip();
    this.#chip.hidden = this.#foot.hidden = !options;
    this.#picker.hidden = true;
    this.#panel.style.cssText = '';
  }

  #updateChip(): void {
    this.#chip.textContent = this.#editing?.label ?? this.#menu?.label ?? this.#bang?.name ?? 'Float options';
  }

  #setBang(bang: Bang | null): void {
    this.#bang = bang;
    this.#updateChip();
    this.#chip.hidden = !bang;
    this.#input.placeholder = bang ? `Search ${bang.name}...` : 'Search...';
  }

  /** Lists the current level unfiltered, selecting the setting `select`. */
  #clear(select?: string): void {
    this.#input.value = '';
    this.#query('', false, select);
  }

  #openMenu(key: string, label: string): void {
    this.#menu = { key, label };
    this.#updateChip();
    this.#clear();
  }

  /** Esc or the chip: stop editing, go up a level, or close. */
  #escape(): void {
    if (this.#editing) this.#finishEdit(false);
    else if (this.#options || this.#bang) this.#back();
    else this.#opts.onClose(true);
  }

  /** Up a level, reselecting the submenu just left. Leaving a bang keeps its terms as a search. */
  #back(): void {
    if (this.#bang) {
      this.#setBang(null);
      return this.#query(this.#input.value);
    }
    const key = this.#menu?.key;
    if (key) {
      this.#menu = null;
      this.#updateChip();
    } else this.#setMode(false);
    this.#clear(key);
  }

  #startEdit(edit: SettingEdit): void {
    this.#filter = this.#input.value;
    this.#editing = edit;
    this.#updateChip();
    this.#input.value = edit.raw;
    this.#input.placeholder = edit.placeholder;
    this.#preview();
    this.#updateFoot();
    this.#picker.hidden = !edit.color;
    // Start at the color shown now, which may be the theme default.
    if (edit.color) this.#picker.value = this.#hex(getComputedStyle(this.#panel).getPropertyValue(`--c-${edit.color}`));
  }

  /** Any CSS color as #rrggbb (the picker has no alpha), normalized by a canvas. */
  #hex(color: string): string {
    const ctx = this.#rows[0].ctx;
    ctx.fillStyle = '#000';
    ctx.fillStyle = color.trim();
    const v = String(ctx.fillStyle);
    if (v[0] === '#') return v;
    return '#' + v.match(/[\d.]+/g)!.slice(0, 3).map((n) => (+n).toString(16).padStart(2, '0')).join('');
  }

  /** An invalid color isn't saved: it would leave the palette unstyled. */
  #badColor(): boolean {
    const v = this.#input.value.trim();
    return !!this.#editing?.color && !!v && !CSS.supports('color', v);
  }

  #finishEdit(save: boolean): void {
    const edit = this.#editing!;
    const value = this.#input.value;
    save &&= !this.#badColor();
    this.#editing = null;
    this.#updateChip();
    this.#picker.hidden = true;
    this.#input.value = this.#filter;
    this.#input.placeholder = 'Search options...';
    this.#updateFoot();
    // A saved color keeps its preview until the host applies it.
    if (save && value !== edit.raw) this.#save({ type: 'set', key: edit.key, value });
    else if (!save) this.#panel.style.cssText = '';
  }

  /** Saves the edit, then activates row `i`. */
  #switchEdit(i: number): void {
    this.#finishEdit(true);
    this.#select(i);
    this.#activate(i, false);
  }

  /** Previews the color being typed, unsaved. */
  #preview(): void {
    const key = this.#editing?.color;
    if (!key) return;
    const v = this.#input.value.trim();
    // `initial` falls back to the theme default.
    if (!v) this.#panel.style.setProperty(`--float-${key}`, 'initial');
    else if (CSS.supports('color', v)) {
      this.#panel.style.setProperty(`--float-${key}`, v);
      this.#picker.value = this.#hex(v);
    } else this.#panel.style.removeProperty(`--float-${key}`);
  }

  /** Flips a toggle or steps a choice. */
  #set(key: string, step: number): void {
    this.#save({ type: 'set', key, step });
  }

  /** Saves a change, then refreshes the rows in place. */
  #save(msg: Message): void {
    void send(msg).then(() => this.#options && this.#query(this.#editing ? this.#filter : this.#input.value, true));
  }

  #rowIndex(e: Event): number {
    const row = (e.target as Element).closest<HTMLElement>('.row');
    return row ? Number(row.dataset.i) : -1;
  }

  /** `keep` holds the selection (same rows, fresh values); `select` picks a setting by key. */
  #query(text: string, keep = false, select?: string): void {
    const id = ++this.#sent;
    const msg: Message = this.#options
      ? { type: 'query', id, text, options: true, menu: this.#menu?.key }
      : { type: 'query', id, text: this.#bang ? `!${this.#bang.trigger} ${text}` : text };
    void send<QueryResponse>(msg).then((res) => {
      if (!res || id !== this.#sent) return;
      // A leading bang moves into the chip once a space follows it.
      const lead = this.#input.value.match(/^\s*!(\S+)\s/);
      if (res.bang && !this.#bang && lead?.[1].toLowerCase() === res.bang.trigger) {
        this.#input.value = this.#input.value.slice(lead[0].length);
        this.#setBang(res.bang);
      }
      this.#show(id, res.results, keep);
      if (select) this.#select(Math.max(0, res.results.findIndex((r) => r.setting?.key === select)));
      if (this.#pendingEnter !== null) {
        const alt = this.#pendingEnter;
        this.#pendingEnter = null;
        this.#activate(0, alt);
      } else if (res.more) this.#queryOlder(id, text);
    });
  }

  #show(id: number, results: Result[], keep = false): void {
    this.#shown = id;
    this.#results = results;
    if (keep) this.#selected = Math.max(0, Math.min(this.#selected, results.length - 1));
    else {
      this.#selected = 0;
      this.#list.scrollTop = 0;
    }
    this.#render();
  }

  /** Appends older history below the shown results, so nothing already visible moves. */
  #queryOlder(id: number, text: string): void {
    const exclude = this.#results.map((r) => r.url);
    void send<QueryResponse>({ type: 'older', id, text, exclude }).then((res) => {
      if (!res?.results.length || id !== this.#sent) return;
      this.#results = this.#results.concat(res.results).slice(0, MAX_ROWS);
      this.#render();
    });
  }

  #render(): void {
    this.#panel.classList.toggle('empty', this.#results.length === 0);
    this.#panel.classList.remove('pending');
    this.#addRows(this.#results.length);
    this.#rows.forEach((row, i) => {
      const r = this.#results[i];
      row.el.hidden = !r;
      if (!r) return;
      const s = r.setting;
      const gear = r.kind === 'chrome' || r.kind === 'options';
      const favicon = r.kind !== 'search' && !gear && !s;
      row.favicon.hidden = !favicon;
      row.search.style.display = r.kind === 'search' ? '' : 'none';
      row.gear.style.display = gear ? '' : 'none';
      if (favicon) this.#drawIcon(row, r.icon);
      row.title.textContent = r.title;
      row.sub.textContent = r.sub;
      row.sep.hidden = row.sub.hidden = !r.sub || r.sub === r.title;
      row.badge.hidden = r.kind !== 'tab';
      row.value.hidden = !s?.value;
      if (s) {
        row.valueText.textContent = s.value;
        row.swatch.hidden = !s.swatch;
        if (s.swatch) row.swatch.style.background = s.swatch;
        row.value.classList.toggle('choice', s.control === 'choice');
      }
      row.el.classList.toggle('disabled', !!s?.disabled);
      row.el.classList.toggle('selected', i === this.#selected);
    });
    this.#updateFoot();
  }

  #updateFoot(): void {
    if (!this.#options) return;
    const editingText = this.#editing && !this.#editing.color;
    this.#foot.textContent = editingText ? 'Enter saves, Esc cancels.' : (this.#results[this.#selected]?.setting?.help ?? '');
  }

  /** Synchronous, so a row and its icon always appear in the same frame. */
  #drawIcon(row: Row, icon: string | undefined): void {
    if (row.icon === icon) return;
    row.icon = icon;
    if (!icon) return row.ctx.clearRect(0, 0, ICON_PX, ICON_PX);
    row.ctx.putImageData(new ImageData(new Uint8ClampedArray(fromBase64(icon).buffer), ICON_PX, ICON_PX), 0, 0);
  }

  #select(i: number): void {
    this.#rows[this.#selected]?.el.classList.remove('selected');
    this.#selected = i;
    this.#rows[i]?.el.classList.add('selected');
    if (this.#options) {
      this.#rows[i]?.el.scrollIntoView({ block: 'nearest' });
      this.#updateFoot();
    }
  }

  #move(delta: number): void {
    const n = this.#results.length;
    if (n) this.#select((this.#selected + delta + n) % n);
  }

  #onKey(e: KeyboardEvent): void {
    if (e.isComposing) return;
    if (this.#editing) return this.#onEditKey(e);

    const k = e.key;
    const ctrl = e.ctrlKey && !e.altKey && !e.metaKey;
    const down = k === 'ArrowDown' || (k === 'Tab' && !e.shiftKey) || (ctrl && (k === 'n' || k === 'j'));
    const up = k === 'ArrowUp' || (k === 'Tab' && e.shiftKey) || (ctrl && (k === 'p' || k === 'k'));
    const atStart = this.#input.selectionEnd === 0;
    const deleteChip = k === 'Backspace' && atStart && (this.#options || !!this.#bang);
    const setting = this.#results[this.#selected]?.setting;
    const choice = (k === 'ArrowLeft' || k === 'ArrowRight') && setting?.control === 'choice' ? setting : null;

    if (down) this.#move(1);
    else if (up) this.#move(-1);
    else if (k === 'Enter') {
      // Results for what was typed haven't arrived yet: act once they do.
      if (this.#shown !== this.#sent) this.#pendingEnter = e.shiftKey;
      else this.#activate(this.#selected, e.shiftKey);
    } else if (k === 'Escape') this.#escape();
    // Held keys don't repeat these: Backspace would leave the mode, and each step is a quota-limited write.
    else if (deleteChip) {
      if (!e.repeat) this.#back();
    } else if (choice) {
      if (!e.repeat) this.#set(choice.key, k === 'ArrowLeft' ? -1 : 1);
    } else return;
    e.preventDefault();
  }

  /** Keys while editing a setting's text. */
  #onEditKey(e: KeyboardEvent): void {
    const k = e.key;
    if (k === 'Enter') {
      // An invalid color keeps editing, so it can be fixed.
      if (!this.#badColor()) this.#finishEdit(true);
    } else if (k === 'Escape') this.#finishEdit(false);
    else if (this.#editing!.color && (k === 'ArrowDown' || k === 'ArrowUp')) {
      // ↑/↓ move between colors, editing each.
      const n = this.#results.length;
      const by = k === 'ArrowDown' ? 1 : -1;
      this.#switchEdit((this.#selected + by + n) % n);
    } else if (k !== 'Tab') return; // Tab would move focus out of the palette.
    e.preventDefault();
  }

  /** `alt` (Shift) flips the default: new tab from the overlay, current tab from the palette page. */
  #activate(i: number, alt: boolean): void {
    const result = this.#results[i];
    if (!result) return;
    if (result.kind === 'options') {
      this.#setMode(true);
      return this.#clear();
    }
    const s = result.setting;
    if (s?.control === 'menu') return this.#openMenu(s.key, s.label ?? result.title);
    if (s?.disabled) return;
    if (s && s.control !== 'link') {
      if (s.edit) this.#startEdit(s.edit);
      else this.#set(s.key, alt ? -1 : 1);
      return;
    }
    // Setting links open in a new tab.
    const newTab = !!s || this.#opts.page === alt;
    const where: Where = newTab ? 'new' : 'current';
    void send({ type: 'open', result, where });
    if (!this.#opts.page) this.#opts.onClose(true);
  }
}
