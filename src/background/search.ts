import { normalize, score } from '../shared/fuzzy';
import type { Result, ResultKind } from '../shared/messages';
import type { Settings } from '../shared/settings';
import { CHROME_PAGES } from './chromePages';
import { favicon } from './favicons';
import { getHistory } from './history';
import { displayUrl, hostOf, isOwnPage, toUrl } from './url';

const MAX_RESULTS = 8;
const OPTIONS_KEY = 'float:options';
const OPTIONS_NAMES = ['float options', 'float settings', 'settings', 'preferences', 'options'];

interface Candidate {
  result: Result;
  score: number;
  /** Strong enough to rank above the search/open row. */
  promote: boolean;
}

interface Bookmark {
  title: string;
  url: string;
  /** Lowercased title and display URL, precomputed for matching. */
  t: string;
  d: string;
}

let bookmarkCache: Bookmark[] | null = null;
const dropBookmarks = () => {
  bookmarkCache = null;
};
chrome.bookmarks.onCreated.addListener(dropBookmarks);
chrome.bookmarks.onRemoved.addListener(dropBookmarks);
chrome.bookmarks.onChanged.addListener(dropBookmarks);
chrome.bookmarks.onMoved.addListener(dropBookmarks);
chrome.bookmarks.onImportEnded.addListener(dropBookmarks);

async function getBookmarks(): Promise<Bookmark[]> {
  if (bookmarkCache) return bookmarkCache;
  const out: Bookmark[] = [];
  const walk = (nodes: chrome.bookmarks.BookmarkTreeNode[]) => {
    for (const n of nodes) {
      if (n.url && !isOwnPage(n.url)) out.push({ title: n.title, url: n.url, t: n.title.toLowerCase(), d: displayUrl(n.url).toLowerCase() });
      if (n.children) walk(n.children);
    }
  };
  walk(await chrome.bookmarks.getTree());
  return (bookmarkCache = out);
}

const tabResult = (t: chrome.tabs.Tab): Result => ({
  kind: 'tab',
  title: t.title || displayUrl(t.url ?? ''),
  sub: displayUrl(t.url ?? ''),
  url: t.url ?? '',
  tabId: t.id,
  windowId: t.windowId,
});

const pageResult = (kind: ResultKind, title: string, url: string): Result => ({
  kind,
  title: title || displayUrl(url),
  sub: displayUrl(url),
  url,
});

async function recentTabs(excludeTabId?: number): Promise<Result[]> {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter((t) => t.id !== excludeTabId)
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))
    .slice(0, MAX_RESULTS)
    .map(tabResult);
}

/** The default action for the typed text: open it as a URL, or search the web. */
function actionRow(q: string, settings: Settings): Result {
  const url = toUrl(q);
  if (url) return { kind: 'url', title: displayUrl(url), sub: 'Open', url };
  const sub = settings.searchUrl ? `Search ${hostOf(settings.searchUrl)}` : 'Search the web';
  return { kind: 'search', title: q, sub, url: q };
}

async function withIcons(results: Result[]): Promise<Result[]> {
  await Promise.all(
    results.map(async (r) => {
      if (r.kind !== 'search' && r.kind !== 'chrome' && r.kind !== 'options') r.icon = await favicon(r.url);
    }),
  );
  return results;
}

/** Results for an empty query: the most recently used tabs. */
export async function recent(excludeTabId?: number): Promise<Result[]> {
  return withIcons(await recentTabs(excludeTabId));
}

export async function search(text: string, settings: Settings, excludeTabId?: number): Promise<{ results: Result[]; more: boolean }> {
  const { results, more } = await rank(text, settings, excludeTabId);
  return { results: await withIcons(results), more };
}

/**
 * History older than the in-memory index, via the browser's own search. That scans
 * all history (tens of ms on large profiles), so the palette asks for it separately
 * and appends the results below the ones already shown.
 */
export async function searchOlder(text: string, exclude: string[]): Promise<Result[]> {
  const q = normalize(text);
  const slots = MAX_RESULTS - exclude.length;
  if (!q || slots <= 0) return [];
  const shown = new Set(exclude);
  const found = (await chrome.history.search({ text: q, startTime: 0, maxResults: 20 }))
    .filter((h): h is chrome.history.HistoryItem & { url: string } => !!h.url && !shown.has(h.url) && !isOwnPage(h.url))
    .map((h) => ({ h, s: Math.max(score(q, (h.title ?? '').toLowerCase()), score(q, displayUrl(h.url).toLowerCase())) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, slots);
  return withIcons(found.map(({ h }) => pageResult('history', h.title ?? '', h.url)));
}

async function rank(text: string, settings: Settings, excludeTabId?: number): Promise<{ results: Result[]; more: boolean }> {
  const q = normalize(text);
  if (!q) return { results: await recentTabs(excludeTabId), more: false };

  const [tabs, bookmarks, history] = await Promise.all([chrome.tabs.query({}), getBookmarks(), getHistory()]);

  // Keyed by URL so each page appears once; earlier (higher-priority) kinds win.
  // Results are only built for matches: history alone is thousands of entries per keystroke.
  const byUrl = new Map<string, Candidate>();
  /** `t`/`d` are the lowercased title and display URL. */
  const add = (url: string, t: string, d: string, weight: number, make: () => Result, opts: { bonus?: number; promotable?: 'title' | 'url' | false } = {}) => {
    const s = Math.max(score(q, t), score(q, d) * 0.95);
    if (!s) return;
    const total = s * weight + (opts.bonus ?? 0);
    const promotable = opts.promotable ?? 'title';
    const promote = promotable !== false && q.length >= 2 && (d.startsWith(q) || (promotable === 'title' && t.startsWith(q)));
    const prev = byUrl.get(url);
    if (!prev) byUrl.set(url, { result: make(), score: total, promote });
    else {
      prev.score = Math.max(prev.score, total);
      prev.promote ||= promote;
    }
  };

  for (const tab of tabs) {
    if (tab.id === excludeTabId || !tab.url) continue;
    add(tab.url, (tab.title ?? '').toLowerCase(), displayUrl(tab.url).toLowerCase(), 1.1, () => tabResult(tab));
  }

  const page = q.replace(/^(chrome:\/\/|about:)/, '');
  const explicit = page !== q;
  for (const name of CHROME_PAGES) {
    const url = `chrome://${name}`;
    // Only an exact name (or an explicit chrome:// prefix) outranks a web search.
    add(url, name, url, 1.05, () => ({ kind: 'chrome', title: name, sub: url, url }), { promotable: false });
    const c = byUrl.get(url);
    if (c && (name === page || explicit)) c.promote = true;
  }

  // Just below the best matching chrome page, so `settings` finds chrome://settings first.
  const options = Math.max(...OPTIONS_NAMES.map((n) => score(q, n)));
  if (options) {
    let best = 0;
    for (const name of CHROME_PAGES) best = Math.max(best, byUrl.get(`chrome://${name}`)?.score ?? 0);
    const result: Result = { kind: 'options', title: 'Float options', sub: 'Settings', url: '' };
    byUrl.set(OPTIONS_KEY, { result, score: best ? Math.min(options, best - 0.001) : options, promote: false });
  }

  for (const b of bookmarks) add(b.url, b.t, b.d, 1.05, () => pageResult('bookmark', b.title, b.url));

  // A history title alone doesn't outrank a web search; a URL prefix does (like omnibox autocomplete).
  for (const h of history.values()) {
    const frecency = Math.min(0.15, Math.log2(1 + h.visits + 3 * h.typed) * 0.02);
    add(h.url, h.t, h.d, 1, () => pageResult('history', h.title, h.url), { bonus: frecency, promotable: 'url' });
  }

  const ranked = [...byUrl.values()].sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS - 1);
  const results = ranked.map((c) => c.result);
  results.splice(ranked[0]?.promote ? 1 : 0, 0, actionRow(text.trim(), settings));
  return { results, more: ranked.length < MAX_RESULTS - 1 };
}
