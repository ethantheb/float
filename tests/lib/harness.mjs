// Launches Helium once with the built extension and gives tests what they need: a local
// web server, tab/state helpers, and views onto the palette (the page's, and the overlay's closed shadow root).
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

export const DIST = resolve('dist');
/** The extension's ID is pinned by the manifest `key`. */
export const EXT_ID = 'ielgjbnkjikemadobenfanpmchjjokff';
export const EXT = `chrome-extension://${EXT_ID}`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function browserPath() {
  const p = process.env.FLOAT_TEST_BROWSER || join(process.env.LOCALAPPDATA || '', 'imput/Helium/Application/chrome.exe');
  if (!existsSync(p)) throw new Error(`Browser not found at ${p}. Set FLOAT_TEST_BROWSER to a Chromium that loads unpacked extensions.`);
  return p;
}

/** Polls until `fn` returns something truthy. */
export async function waitFor(fn, { timeout = 5000, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}${last instanceof Error ? `: ${last.message}` : ''}`);
    await sleep(40);
  }
}

/** A tiny web server for pages with known titles, so tests don't touch the internet. */
function startServer() {
  const requests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    requests.push(url.pathname);
    const html = (head, body = '<p>page</p>', headers = {}) => {
      res.writeHead(200, { 'content-type': 'text/html', ...headers });
      res.end(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`);
    };
    const [, kind, arg = ''] = url.pathname.split('/');
    if (kind === 'p') return html(`<title>${decodeURIComponent(arg)}</title>`);
    if (kind === 'untitled' || url.pathname === '/') return html('');
    if (kind === 'keys') return html('<title>Keys</title>', '<script>window.keys=[];addEventListener("keydown",e=>keys.push(e.key),true);addEventListener("keypress",e=>keys.push(e.key),true)</script><input id=i>');
    if (kind === 'csp') {
      return html('<title>Strict</title>', '<p>strict page</p>', {
        'content-security-policy': "default-src 'none'; style-src 'none'; script-src 'none'; require-trusted-types-for 'script'",
      });
    }
    res.writeHead(404);
    res.end('not found');
  });
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      // `*.test` resolves to this machine (see the browser flag), so hosts can look real.
      ok({ port, requests, url: (path, host = 'www.example.test') => `http://${host}:${port}${path}`, close: () => server.close() });
    }),
  );
}

export class Env {
  static async start({ headless = false } = {}) {
    const env = new Env();
    env.server = await startServer();
    env.dir = mkdtempSync(join(tmpdir(), 'float-test-'));
    env.browser = await puppeteer.launch({
      executablePath: browserPath(),
      headless,
      userDataDir: env.dir,
      defaultViewport: { width: 900, height: 600 },
      args: [
        `--load-extension=${DIST}`,
        `--disable-extensions-except=${DIST}`,
        // mail.google.com: a well-known site (see R323), kept off the network.
        '--host-resolver-rules=MAP *.test 127.0.0.1, MAP mail.google.com 127.0.0.1',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    env.browser.on('targetcreated', async (target) => {
      const page = await target.page().catch(() => null);
      page?.on('pageerror', (e) => env.pageErrors.push(`${page.url()}: ${e.message}`));
    });
    await env.#ready();
    return env;
  }

  pageErrors = [];
  claimed = new WeakSet();
  /** Facts about the first launch, which later resets erase. */
  facts = {};

  async #ready() {
    const w = await this.worker();
    // The bang list is written right after install.
    await waitFor(() => w.evaluate(async () => !!(await chrome.storage.local.get('bangs:version'))['bangs:version']), { timeout: 20000, what: 'bangs install' });
    const welcome = await waitFor(() => this.browser.pages().then((ps) => ps.find((p) => p.url().endsWith('options.html?welcome'))), { timeout: 10000, what: 'welcome tab' }).catch(() => null);
    if (welcome) {
      await sleep(500);
      this.facts.welcome = await welcome.evaluate(() => {
        const root = document.querySelector('float-root')?.shadowRoot;
        return { url: location.href, hasBox: !!root?.querySelector('h1'), box: root?.querySelector('h1')?.textContent ?? '', optionsChip: root?.querySelector('.chip')?.textContent ?? '' };
      });
    }
  }

  /** The service worker, waking it if it went idle. */
  async worker() {
    const find = () => this.browser.targets().find((t) => t.type() === 'service_worker' && t.url().startsWith(EXT));
    let target = find();
    if (!target) {
      // Any extension page that sends a message wakes the worker.
      const p = await this.browser.newPage();
      await p.goto(`${EXT}/palette.html?fallback`);
      target = await waitFor(find, { what: 'service worker' });
      await p.close();
    }
    return target.worker();
  }

  async evalSw(fn, ...args) {
    const w = await this.worker();
    return w.evaluate(fn, ...args);
  }

  /** Back to a clean slate between tests: one blank tab, no bookmarks or history, default settings. */
  async reset() {
    this.pageErrors.length = 0;
    await this.evalSw(async () => {
      const anchor = await chrome.tabs.create({ url: 'about:blank', active: true });
      for (const t of await chrome.tabs.query({})) if (t.id !== anchor.id) await chrome.tabs.remove(t.id).catch(() => {});
      for (const w of await chrome.windows.getAll()) if (w.id !== anchor.windowId) await chrome.windows.remove(w.id).catch(() => {});
      for (const root of await chrome.bookmarks.getTree()) {
        for (const folder of root.children ?? []) for (const b of folder.children ?? []) await chrome.bookmarks.removeTree(b.id).catch(() => {});
      }
      await chrome.history.deleteAll();
      // sync storage has a write quota, so only clear when something changed.
      if (Object.keys(await chrome.storage.sync.get(null)).length) {
        await new Promise((done) => {
          const l = () => (chrome.storage.onChanged.removeListener(l), done());
          chrome.storage.onChanged.addListener(l);
          chrome.storage.sync.clear();
        });
      }
    });
  }

  /** Changes settings and waits until the worker has dropped its cached copy. */
  async settings(obj) {
    await this.evalSw(
      (o) =>
        new Promise((done) => {
          // Registered after the worker's own listener, so by now it has seen the change.
          const l = () => (chrome.storage.onChanged.removeListener(l), done());
          chrome.storage.onChanged.addListener(l);
          chrome.storage.sync.set(o);
        }),
      obj,
    );
  }

  /**
   * Opens a page in a new tab and returns { page, tabId }. The tab is made by the extension API, not
   * puppeteer's newPage: that opens the browser's new tab page, which Float swaps for another tab mid-navigation.
   */
  async open(url, { pinned = false, active = true } = {}) {
    const tab = await this.evalSw((u, a) => chrome.tabs.create({ url: u, active: a }), url, active);
    const page = await waitFor(async () => (await this.browser.pages()).find((p) => !this.claimed.has(p) && p.url() === url), { timeout: 15000, what: `page for ${url}` }).catch(async (e) => {
      throw new Error(`${e.message}; pages: ${(await this.browser.pages()).map((p) => p.url()).join(' | ')}; targets: ${this.browser.targets().map((t) => t.type() + ':' + t.url()).join(' | ')}`);
    });
    this.claimed.add(page);
    await waitFor(() => page.evaluate(() => document.readyState === 'complete'), { timeout: 15000, what: `${url} to load` });
    if (pinned) await this.evalSw((id) => chrome.tabs.update(id, { pinned: true }), tab.id);
    return { page, tabId: tab.id };
  }

  /** Opens a Float palette page (`palette.html?fallback...`) and returns a view of it. */
  async palettePage(query = 'fallback') {
    const { page } = await this.open(`${EXT}/palette.html?${query}`);
    const view = new View(page, false);
    await view.ready();
    return view;
  }

  /** A view of a page's overlay (what a command shows over it). */
  async overlay(page) {
    const view = new View(page, true);
    await view.attach();
    return view;
  }

  /** Runs a worker command exactly as the browser would for a key press, on this tab. */
  async command(name, tabId) {
    await this.evalSw(async (n, id) => runCommand(n, await chrome.tabs.get(id)), name, tabId);
  }

  async showPalette(tabId, { edit = false, scope } = {}) {
    await this.evalSw((id, e, s) => chrome.tabs.get(id).then((t) => showPalette(t, e, s)), tabId, edit, scope);
  }

  async stop() {
    await this.browser?.close().catch(() => {});
    this.server?.close();
    try {
      rmSync(this.dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // The browser may still hold files; the temp dir is disposable.
    }
  }
}

/** The palette inside a page: the palette page's open shadow root, or the overlay's closed one. */
export class View {
  constructor(page, overlay) {
    this.page = page;
    this.overlay = overlay;
  }

  async attach() {
    if (!this.overlay) return;
    this.cdp = await this.page.createCDPSession();
    this.ctx = null;
    this.cdp.on('Runtime.executionContextCreated', ({ context: c }) => {
      if (c.origin === EXT) this.ctx = c.id;
    });
    this.cdp.on('Runtime.executionContextDestroyed', ({ executionContextId: id }) => {
      if (this.ctx === id) this.ctx = null;
    });
    await this.cdp.send('Runtime.enable');
  }

  async ready() {
    await waitFor(() => this.page.evaluate(() => !!document.querySelector('float-root')?.shadowRoot), { what: 'palette page' });
  }

  /** Runs `fn(root, ...args)` where the palette's shadow root is reachable. */
  async eval(fn, ...args) {
    const root = '(el=>el&&(el.shadowRoot||chrome.dom.openOrClosedShadowRoot(el)))(document.querySelector("float-root"))';
    const expression = `(${fn.toString()})(${root}, ...${JSON.stringify(args)})`;
    if (!this.overlay) return this.page.evaluate(expression);
    const r = await this.cdp.send('Runtime.evaluate', { expression, contextId: this.ctx, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  /** Whether the overlay's panel is showing (the page's palette is always showing). */
  async isOpen() {
    if (!this.overlay) return true;
    return this.page.evaluate(() => {
      const h = document.querySelector('float-root');
      return !!h && h.matches(':popover-open');
    });
  }

  async rows() {
    return this.eval((root) =>
      [...root.querySelectorAll('.row')]
        .filter((r) => !r.hidden)
        .map((r) => {
          const subs = [...r.querySelectorAll('.text .sub')];
          const sub = subs.at(-1);
          const text = r.querySelector('.text');
          const pin = r.querySelector('.pin');
          const badge = r.querySelector('.badge');
          return {
            title: r.querySelector('.title').textContent,
            sub: sub && !sub.hidden ? sub.textContent : '',
            badge: badge && !badge.hidden ? badge.querySelector('.label').textContent : '',
            pinned: r.classList.contains('pinned') && getComputedStyle(pin).display !== 'none',
            selected: r.classList.contains('selected'),
            disabled: r.classList.contains('disabled'),
            value: r.querySelector('.vtext')?.textContent ?? '',
            overflows: text.scrollWidth > text.clientWidth + 1,
            textRight: text.getBoundingClientRect().right,
            badgeLeft: badge && !badge.hidden ? badge.getBoundingClientRect().left : null,
          };
        }),
    );
  }

  async titles() {
    return (await this.rows()).map((r) => r.title);
  }

  async chip() {
    return this.eval((root) => {
      const c = root.querySelector('.chip');
      return c.hidden ? null : c.textContent;
    });
  }

  async placeholder() {
    return this.eval((root) => root.querySelector('.input').placeholder);
  }

  async value() {
    return this.eval((root) => root.querySelector('.input').value);
  }

  async foot() {
    return this.eval((root) => {
      const f = root.querySelector('.foot');
      return f.hidden ? '' : f.textContent;
    });
  }

  /** Whether the palette's input has focus. */
  async focused() {
    return this.eval((root) => root.activeElement?.classList.contains('input') ?? false);
  }

  async type(text) {
    await this.page.keyboard.type(text);
  }

  async press(...keys) {
    for (const k of keys) await this.page.keyboard.press(k);
  }

  /** Waits for the rows to satisfy `pred(rows)`, returning them. */
  async waitRows(pred, what = 'rows') {
    return waitFor(async () => {
      const rows = await this.rows();
      return pred(rows) ? rows : null;
    }, { what });
  }

  async waitTitles(pred, what = 'titles') {
    return waitFor(async () => {
      const titles = await this.titles();
      return pred(titles) ? titles : null;
    }, { what });
  }
}

/** The assertions a test gets. They're counted, so a test that checks nothing fails. */
export function makeAsserts() {
  const t = { count: 0 };
  const wrap = (fn) => (...a) => {
    t.count++;
    return fn(...a);
  };
  Object.assign(t, {
    ok: wrap(assert.ok),
    equal: wrap(assert.equal),
    notEqual: wrap(assert.notEqual),
    deepEqual: wrap(assert.deepEqual),
    match: wrap(assert.match),
    doesNotMatch: wrap(assert.doesNotMatch),
    includes: wrap((arr, v, msg) => assert.ok(arr.includes(v), msg ?? `expected ${JSON.stringify(arr)} to include ${JSON.stringify(v)}`)),
    excludes: wrap((arr, v, msg) => assert.ok(!arr.includes(v), msg ?? `expected ${JSON.stringify(arr)} not to include ${JSON.stringify(v)}`)),
  });
  return t;
}
