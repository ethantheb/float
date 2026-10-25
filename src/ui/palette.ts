import type { Message, QueryResponse, Result, Where } from '../shared/messages';

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
function icon(paths: string[], cls: string): SVGSVGElement {
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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, ...children: Node[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  e.append(...children);
  return e;
}

const ICON_PX = 32;

/**
 * Decodes without loading any URL, so page CSP and origin checks don't apply.
 * Not cached: this runs in every tab, and redrawing only happens when a row's icon changes.
 */
function decodeIcon(base64: string): Promise<ImageBitmap> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return createImageBitmap(new Blob([bytes], { type: 'image/png' }));
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
  /** Icon currently drawn (or being drawn) on `favicon`. */
  icon: string | undefined;
  search: SVGSVGElement;
  gear: SVGSVGElement;
  title: HTMLElement;
  sep: HTMLElement;
  sub: HTMLElement;
  badge: HTMLElement;
}

export interface PaletteOptions {
  /** True on the extension's own palette page (new tab / fallback), false for the in-page overlay. */
  page: boolean;
  /** Asks the host to hide the palette. `restoreFocus` is false when focus already moved elsewhere. */
  onClose(restoreFocus: boolean): void;
}

export class Palette {
  private readonly panel: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly rows: Row[] = [];
  private results: Result[] = [];
  private selected = 0;
  /** Id of the latest query sent, and of the one whose results are displayed. */
  private sent = 0;
  private shown = 0;
  /** Enter was pressed before the latest results arrived; holds its Shift state. */
  private pendingEnter: boolean | null = null;

  constructor(parent: Node, private readonly opts: PaletteOptions) {
    this.input = el('input', 'input');
    this.input.placeholder = 'Search...';
    this.input.spellcheck = false;
    this.input.autocomplete = 'off';

    const list = el('div', 'list');
    for (let i = 0; i < MAX_ROWS; i++) {
      const favicon = el('canvas', 'icon');
      favicon.width = favicon.height = ICON_PX;
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
        badge: el('span', 'badge', el('span', 'label', document.createTextNode('Switch to Tab')),el('span', 'key', icon(ICONS.arrow, 'arrow'))),
      };
      row.el.dataset.i = String(i);
      row.el.hidden = true;
      row.el.append(row.favicon, row.search, row.gear, el('span', 'text', row.title, row.sep, row.sub), row.badge);
      list.append(row.el);
      this.rows.push(row);
    }

    this.panel = el('div', 'panel empty', el('label', 'bar', icon(ICONS.search, 'search'), this.input), list);
    parent.appendChild(this.panel);

    this.input.addEventListener('input', () => this.query(this.input.value));
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.input.addEventListener('blur', () => opts.page || opts.onClose(false));
    // Keep focus in the input while clicking rows.
    list.addEventListener('mousedown', (e) => e.preventDefault());
    list.addEventListener('mousemove', (e) => {
      const i = this.rowIndex(e);
      if (i >= 0 && i !== this.selected) this.select(i);
    });
    list.addEventListener('click', (e) => {
      const i = this.rowIndex(e);
      if (i >= 0) this.activate(i, e.shiftKey);
    });
  }

  /** Focuses the input and refreshes results for an empty query. */
  open(): void {
    this.input.focus({ preventScroll: true });
    this.reset();
  }

  /** Clears the input and preloads empty-query results for the next open. */
  reset(): void {
    this.input.value = '';
    this.pendingEnter = null;
    this.query('');
  }

  private rowIndex(e: Event): number {
    const row = (e.target as Element).closest<HTMLElement>('.row');
    return row ? Number(row.dataset.i) : -1;
  }

  private query(text: string): void {
    const id = ++this.sent;
    void send<QueryResponse>({ type: 'query', id, text }).then((res) => {
      if (!res || id !== this.sent) return;
      this.shown = id;
      this.results = res.results;
      this.selected = 0;
      this.render();
      if (this.pendingEnter !== null) {
        const alt = this.pendingEnter;
        this.pendingEnter = null;
        this.activate(0, alt);
      } else if (res.more) this.queryOlder(id, text);
    });
  }

  /** Appends older history below the shown results, so nothing already visible moves. */
  private queryOlder(id: number, text: string): void {
    const exclude = this.results.map((r) => r.url);
    void send<QueryResponse>({ type: 'older', id, text, exclude }).then((res) => {
      if (!res?.results.length || id !== this.sent) return;
      this.results = this.results.concat(res.results).slice(0, MAX_ROWS);
      this.render();
    });
  }

  private render(): void {
    this.panel.classList.toggle('empty', this.results.length === 0);
    this.rows.forEach((row, i) => {
      const r = this.results[i];
      row.el.hidden = !r;
      if (!r) return;
      const favicon = r.kind !== 'search' && r.kind !== 'chrome';
      row.favicon.hidden = !favicon;
      row.search.style.display = r.kind === 'search' ? '' : 'none';
      row.gear.style.display = r.kind === 'chrome' ? '' : 'none';
      if (favicon) this.drawIcon(row, r.icon);
      row.title.textContent = r.title;
      row.sub.textContent = r.sub;
      row.sep.hidden = row.sub.hidden = !r.sub || r.sub === r.title;
      row.badge.hidden = r.kind !== 'tab';
      row.el.classList.toggle('selected', i === this.selected);
    });
  }

  private drawIcon(row: Row, icon: string | undefined): void {
    if (row.icon === icon) return;
    row.icon = icon;
    row.ctx.clearRect(0, 0, ICON_PX, ICON_PX);
    if (!icon) return;
    decodeIcon(icon)
      .then((bitmap) => {
        // The row may have moved on to another result meanwhile.
        if (row.icon === icon) {
          row.ctx.clearRect(0, 0, ICON_PX, ICON_PX);
          row.ctx.drawImage(bitmap, 0, 0, ICON_PX, ICON_PX);
        }
        bitmap.close();
      })
      .catch(() => {});
  }

  private select(i: number): void {
    this.rows[this.selected]?.el.classList.remove('selected');
    this.selected = i;
    this.rows[i]?.el.classList.add('selected');
  }

  private move(delta: number): void {
    const n = this.results.length;
    if (n) this.select((this.selected + delta + n) % n);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.isComposing) return;
    const ctrl = e.ctrlKey && !e.altKey && !e.metaKey;
    const k = e.key;
    if (k === 'ArrowDown' || (k === 'Tab' && !e.shiftKey) || (ctrl && (k === 'n' || k === 'j'))) this.move(1);
    else if (k === 'ArrowUp' || (k === 'Tab' && e.shiftKey) || (ctrl && (k === 'p' || k === 'k'))) this.move(-1);
    else if (k === 'Enter') {
      // Results for what was typed haven't arrived yet: act once they do.
      if (this.shown !== this.sent) this.pendingEnter = e.shiftKey;
      else this.activate(this.selected, e.shiftKey);
    } else if (k === 'Escape') this.opts.onClose(true);
    else return;
    e.preventDefault();
  }

  /** `alt` (Shift) flips the default: new tab from the overlay, current tab from the palette page. */
  private activate(i: number, alt: boolean): void {
    const result = this.results[i];
    if (!result) return;
    const where: Where = this.opts.page === alt ? 'new' : 'current';
    void send({ type: 'open', result, where });
    if (!this.opts.page) this.opts.onClose(true);
  }
}
