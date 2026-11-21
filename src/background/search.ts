import { normalize, score } from '../shared/fuzzy';
import { SCOPES, type QueryResponse, type Result, type ResultKind, type ScopeKey } from '../shared/messages';
import { sourceListed, sourceOn, type Settings } from '../shared/settings';
import { findBang, type BangMatch } from './bangs';
import { CHROME_PAGES } from './chromePages';
import { favicon } from './favicons';
import { getHistory, peekHistory, type HistoryEntry } from './history';
import { knownSiteName } from './siteNames';
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
  added: number;
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
      if (n.url && !isOwnPage(n.url)) out.push({ title: n.title, url: n.url, added: n.dateAdded ?? 0, t: n.title.toLowerCase(), d: displayUrl(n.url).toLowerCase() });
      if (n.children) walk(n.children);
    }
  };
  walk(await chrome.bookmarks.getTree());
  return (bookmarkCache = out);
}

const unloaded = (t: chrome.tabs.Tab) => !!t.discarded || t.status === 'unloaded';
/** `title` if it's a real title, not empty or just the URL or its host. */
function realTitle(title: string | undefined, url: string): string {
  const t = displayUrl(title ?? '').toLowerCase();
  return t && t !== displayUrl(url).toLowerCase() && t !== hostOf(url).toLowerCase() && t !== hostOf(url).replace(/:\d+$/, '').toLowerCase() ? title! : '';
}

/**
 * A tab's title. Tabs that haven't loaded since the browser started (e.g. restored pinned
 * ones) may have none, or their URL, so for those (only) fall back to: the history index
 * (only if already in memory: the first frame can't wait; never for incognito), bookmarks,
 * a well-known site's name, then the URL.
 */
function tabTitle(t: chrome.tabs.Tab, s: Settings): string {
  const url = t.url ?? '';
  // A loaded tab's title is what the tab strip shows, even when it's just the domain.
  if (!unloaded(t)) return t.title || displayUrl(url);
  return (
    realTitle(t.title, url) ||
    (!t.incognito && sourceOn(s, 'history') && realTitle(peekHistory()?.get(url)?.title, url)) ||
    (sourceOn(s, 'bookmarks') && realTitle(bookmarkCache?.find((b) => b.url === url)?.title, url)) ||
    knownSiteName(url) ||
    displayUrl(url)
  );
}

const tabResult = (t: chrome.tabs.Tab, s: Settings, title = tabTitle(t, s)): Result => ({
  kind: 'tab',
  title,
  sub: displayUrl(t.url ?? ''),
  url: t.url ?? '',
  tabId: t.id,
  windowId: t.windowId,
  pinned: t.pinned,
});

const pageResult = (kind: ResultKind, title: string, url: string): Result => ({
  kind,
  title: title || displayUrl(url),
  sub: displayUrl(url),
  url,
});

/**
 * The tab the palette was opened from. Incognito and regular windows only see their own
 * tabs, and incognito doesn't search history.
 */
export type From = Pick<chrome.tabs.Tab, 'id' | 'incognito' | 'url'> | undefined;

/** Open tabs on the same side of the incognito boundary as `from`, except `from` itself. */
async function sameSideTabs(from: From): Promise<chrome.tabs.Tab[]> {
  const incognito = !!from?.incognito;
  return (await chrome.tabs.query({})).filter((t) => t.incognito === incognito && t.id !== from?.id);
}

/** Tabs of the kinds the settings leave on. */
async function shownTabs(from: From, settings: Settings): Promise<chrome.tabs.Tab[]> {
  return (await sameSideTabs(from)).filter((t) => sourceOn(settings, t.pinned ? 'pinned' : 'tabs'));
}

const newest = (a: chrome.tabs.Tab, b: chrome.tabs.Tab) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0);

/** The empty-query list: tabs whose source is listed, not only searched ('typed'). */
async function recentTabs(from: From, settings: Settings): Promise<Result[]> {
  return (await shownTabs(from, settings))
    .filter((t) => sourceListed(settings, t.pinned ? 'pinned' : 'tabs'))
    .sort(newest)
    .slice(0, MAX_RESULTS)
    .map((t) => tabResult(t, settings));
}

/** The default action for the typed text: open it as a URL, or search the web. */
function actionRow(q: string, settings: Settings): Result {
  const url = toUrl(q);
  if (url) return { kind: 'url', title: displayUrl(url), sub: 'Open', url };
  const sub = settings.searchUrl ? `Search ${hostOf(settings.searchUrl)}` : 'Search the web';
  return { kind: 'search', title: q, sub, url: q };
}

/** A bang's search, e.g. `rust !g` → "rust · Search Google". With no terms it opens the site. */
const bangRow = (b: BangMatch, q: string): Result => ({
  kind: 'search',
  title: b.terms || b.name,
  sub: b.terms ? `Search ${b.name}` : displayUrl(b.url),
  url: q,
  target: b.url,
});

/** Incognito's pages aren't cached (bookmarks are shared), so they don't outlive the window. */
async function withIcons(results: Result[], from: From): Promise<Result[]> {
  await Promise.all(
    results.map(async (r) => {
      const keep = !from?.incognito || r.kind === 'bookmark';
      if (r.kind !== 'search' && r.kind !== 'chrome' && r.kind !== 'options' && r.kind !== 'scope' && r.kind !== 'note') r.icon = await favicon(r.url, keep);
    }),
  );
  return results;
}

/** The newest history, straight from the browser: cheap with no text, and not waiting on (or stale from) the index. */
async function newestHistory(from: From): Promise<Result[]> {
  const found = await chrome.history.search({ text: '', startTime: 0, maxResults: MAX_RESULTS * 2 });
  return found
    .filter((h): h is chrome.history.HistoryItem & { url: string } => !!h.url && !isOwnPage(h.url) && h.url !== from?.url)
    .slice(0, MAX_RESULTS)
    .map((h) => pageResult('history', h.title ?? '', h.url));
}

/** Results for an empty query: the most recently used tabs. */
export async function recent(from: From, settings: Settings): Promise<Result[]> {
  return withIcons(await recentTabs(from, settings), from);
}

/** `withTabs: false` leaves open tabs out, for editing the page's URL: Enter changes the page there. */
export async function search(text: string, settings: Settings, from: From, withTabs = true, scope?: ScopeKey): Promise<Omit<QueryResponse, 'id'>> {
  const ranked = await rank(text, settings, from, withTabs, scope);
  return { ...ranked, results: await withIcons(ranked.results, from) };
}

/**
 * History older than the in-memory index, via the browser's own search. That scans
 * all history (tens of ms on large profiles), so the palette asks for it separately
 * and appends the results below the ones already shown.
 */
export async function searchOlder(text: string, exclude: string[], from: From, settings: Settings): Promise<Result[]> {
  const q = normalize(text);
  const slots = MAX_RESULTS - exclude.length;
  if (!q || slots <= 0 || from?.incognito || !sourceOn(settings, 'history')) return [];
  const shown = new Set(exclude);
  const found = (await chrome.history.search({ text: q, startTime: 0, maxResults: 20 }))
    .filter((h): h is chrome.history.HistoryItem & { url: string } => !!h.url && !shown.has(h.url) && !isOwnPage(h.url))
    .map((h) => ({ h, s: Math.max(score(q, (h.title ?? '').toLowerCase()), score(q, displayUrl(h.url).toLowerCase())) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, slots);
  return withIcons(found.map(({ h }) => pageResult('history', h.title ?? '', h.url)), from);
}

/** `scope` narrows the search to one source: nothing else is searched, and there's no search or options row. */
async function rank(text: string, settings: Settings, from: From, withTabs = true, scope?: ScopeKey): Promise<Omit<QueryResponse, 'id'>> {
  const q = normalize(text);
  // A shortcut can open a scope whose source is turned off: say so, instead of an empty list.
  // (Incognito never shows history, but a shortcut can still ask for it.)
  if (scope === 'history' && from?.incognito) return { results: [{ kind: 'note', title: 'History is not searched in incognito', sub: '', url: '' }] };
  if (scope && !(scope === 'tabs' ? sourceOn(settings, 'tabs') || sourceOn(settings, 'pinned') : sourceOn(settings, scope))) {
    return { results: [{ kind: 'note', title: `${SCOPES[scope]} is disabled in Float options`, sub: '', url: '' }] };
  }
  if (!q && !scope) return { results: withTabs ? await recentTabs(from, settings) : [], more: false };

  const incognito = !!from?.incognito;
  const inScope = (key: ScopeKey) => !scope || scope === key;
  const showHistory = !incognito && sourceOn(settings, 'history') && inScope('history');
  const [tabs, bookmarks, history, bang] = await Promise.all([
    withTabs && inScope('tabs') ? shownTabs(from, settings) : [],
    sourceOn(settings, 'bookmarks') && inScope('bookmarks') ? getBookmarks() : [],
    showHistory && q ? getHistory() : new Map<string, HistoryEntry>(),
    !scope && settings.bangs ? findBang(text).catch(() => null) : null,
  ]);
  // Nothing typed yet: the newest of the source.
  if (!q) {
    const results =
      scope === 'tabs'
        ? tabs.sort(newest).slice(0, MAX_RESULTS).map((t) => tabResult(t, settings))
        : scope === 'bookmarks'
          ? [...bookmarks].sort((a, b) => b.added - a.added).slice(0, MAX_RESULTS).map((b) => pageResult('bookmark', b.title, b.url))
          : await newestHistory(from);
    return { results, more: false };
  }
  // A leading bang is a mode (the palette shows it as a chip): its search is the only row.
  if (bang?.leading) return { results: [bangRow(bang, text.trim())], bang: { trigger: bang.trigger, name: bang.name } };

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
    if (!tab.url) continue;
    const title = tabTitle(tab, settings);
    add(tab.url, title.toLowerCase(), displayUrl(tab.url).toLowerCase(), 1.1, () => tabResult(tab, settings, title));
  }

  const page = q.replace(/^(chrome:\/\/|about:)/, '');
  const explicit = page !== q;
  for (const name of !scope && sourceOn(settings, 'chrome') ? CHROME_PAGES : []) {
    const url = `chrome://${name}`;
    // Only an exact name (or an explicit chrome:// prefix) outranks a web search.
    add(url, name, url, 1.05, () => ({ kind: 'chrome', title: name, sub: url, url }), { promotable: false });
    const c = byUrl.get(url);
    if (c && (name === page || explicit)) c.promote = true;
  }

  // Just below the best matching chrome page, so `settings` finds chrome://settings first.
  const options = scope ? 0 : Math.max(...OPTIONS_NAMES.map((n) => score(q, n)));
  if (options) {
    let best = 0;
    for (const name of CHROME_PAGES) best = Math.max(best, byUrl.get(`chrome://${name}`)?.score ?? 0);
    const result: Result = { kind: 'options', title: 'Float options', sub: '', url: '' };
    byUrl.set(OPTIONS_KEY, { result, score: best ? Math.min(options, best - 0.001) : options, promote: false });
  }

  // Rows that enter a scope ("Search history"), for the sources that are on.
  const offered = { tabs: withTabs && (sourceOn(settings, 'tabs') || sourceOn(settings, 'pinned')), bookmarks: sourceOn(settings, 'bookmarks'), history: !incognito && sourceOn(settings, 'history') };
  for (const key of scope ? [] : (Object.keys(SCOPES) as ScopeKey[])) {
    const name = SCOPES[key].toLowerCase();
    const s = offered[key] ? Math.max(score(q, `search ${name}`), score(q, name)) : 0;
    if (s) byUrl.set(`float:scope:${key}`, { result: { kind: 'scope', title: `Search ${name}`, sub: '', url: key }, score: s * 0.9, promote: false });
  }

  for (const b of bookmarks) add(b.url, b.t, b.d, 1.05, () => pageResult('bookmark', b.title, b.url));

  // A history title alone doesn't outrank a web search; a URL prefix does (like omnibox autocomplete).
  // Pages titled only with their site's name ("YouTube") say nothing about the page: they go last.
  for (const h of history.values()) {
    const frecency = Math.min(0.15, Math.log2(1 + h.visits + 3 * h.typed) * 0.02);
    const make = () => pageResult('history', h.title, h.url);
    if (h.generic) add(h.url, h.t, h.d, 0.5, make, { promotable: false });
    else add(h.url, h.t, h.d, 1, make, { bonus: frecency, promotable: 'url' });
  }

  // The search or open row takes one slot, except in a scope.
  const limit = scope ? MAX_RESULTS : MAX_RESULTS - 1;
  const ranked = [...byUrl.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  const results = ranked.map((c) => c.result);
  // A bang is an explicit choice of action, so nothing outranks it.
  if (scope) return { results, more: showHistory && ranked.length < limit };
  if (bang) results.unshift(bangRow(bang, text.trim()));
  else results.splice(ranked[0]?.promote ? 1 : 0, 0, actionRow(text.trim(), settings));
  // `more` asks for older history, which incognito (and turning history off) doesn't search.
  return { results, more: showHistory && ranked.length < limit };
}
