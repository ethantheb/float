// Small helpers shared by the sources, options and appearance cases.
import { createServer } from 'node:http';
import { View } from './harness.mjs';

/** The options page (`options.html`) as a view, once its rows are listed. */
export async function optionsPage(t) {
  const { page } = await t.open(`${t.EXT}/options.html`);
  const view = new View(page, false);
  await view.ready();
  await view.waitRows((r) => r.length > 0, 'options rows');
  return view;
}

/** Moves the selection to the row titled `title` with the arrow keys, like a user would. */
export async function selectRow(view, title) {
  const rows = await view.rows();
  const to = rows.findIndex((r) => r.title === title);
  if (to < 0) throw new Error(`no row "${title}" in ${JSON.stringify(rows.map((r) => r.title))}`);
  const from = Math.max(0, rows.findIndex((r) => r.selected));
  for (let i = (to - from + rows.length) % rows.length; i > 0; i--) await view.press('ArrowDown');
  await view.waitRows((r) => r[to]?.selected, `"${title}" selected`);
}

/** Replaces the input's text with `text`, and waits for the results for exactly that text (its web search row). */
export async function ask(view, text) {
  await view.eval((root) => {
    const input = root.querySelector('.input');
    input.focus();
    input.select();
  });
  await view.type(text);
  return view.waitRows((r) => r.some((x) => x.title === text && x.sub === 'Search the web'), `results for "${text}"`);
}

/** Searching "Float options" and pressing Enter on that row, from the normal palette. */
export async function enterOptions(view) {
  await view.type('float options');
  // The web search row is titled with the typed (lowercase) text; the options row is "Float options".
  await view.waitRows((r) => r.some((x) => x.title === 'float options') && r.some((x) => x.title === 'Float options'), 'options row');
  await selectRow(view, 'Float options');
  await view.press('Enter');
  await view.waitRows((r) => r.some((x) => x.title === 'Shortcut'), 'options mode rows');
}

/** Records the worker's `set` and `open` messages from now on. */
export async function watch(t) {
  await t.evalSw(() => {
    globalThis.__seen = [];
    if (globalThis.__watching) return;
    globalThis.__watching = true;
    chrome.runtime.onMessage.addListener((m) => {
      if (m?.type === 'set' || m?.type === 'open') globalThis.__seen.push(m);
    });
  });
}

export const seen = (t) => t.evalSw(() => globalThis.__seen);

/**
 * A round trip to the worker from the same page: messages arrive in order, so once it returns the worker
 * has already seen everything the page sent before it.
 */
export const flush = (view) => view.page.evaluate(() => chrome.runtime.sendMessage({ type: 'query', id: 0, text: 'zzz' }));

/** How many tabs are at (or loading) `url`. */
export const tabsAt = (t, url) => t.evalSw(async (u) => (await chrome.tabs.query({})).filter((x) => (x.url || x.pendingUrl) === u).length, url);

/** The stored value of a chrome.storage.sync key. */
export const stored = (t, key) => t.evalSw(async (k) => (await chrome.storage.sync.get(k))[k], key);

/** Discards a background tab (as the browser does to save memory), returning it: its id may change. */
export const discard = (t, tabId) => t.evalSw(async (id) => chrome.tabs.discard(id), tabId);

/** A URL as the palette shows it: no scheme, `www.` or trailing slash. */
export const bare = (url) => url.replace(/^(https?|ftp):\/\//, '').replace(/^www\./, '').replace(/\/$/, '');

/** A server whose pages have a title the first time they are fetched, and none after. */
export function titleOnce() {
  const hits = new Map();
  const server = createServer((request, res) => {
    const n = (hits.get(request.url) ?? 0) + 1;
    hits.set(request.url, n);
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><html><head>${n === 1 ? '<title>Remembered</title>' : ''}</head><body>x</body></html>`);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })));
}
