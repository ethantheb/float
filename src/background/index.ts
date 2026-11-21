import { SCOPES, type Message, type QueryResponse, type Result, type ScopeKey, type Where } from '../shared/messages';
import { DEFAULTS, loadSettings, onSettingsChanged, saveSettings, sourceOn, type Settings } from '../shared/settings';
import { EDIT_URL, OPEN_PALETTE } from '../shared/shortcut';
import { syncHistory } from './history';
import { applySetting, optionRows } from './options';
import { recent, search, searchOlder } from './search';
import { isOwnPage, isWebUrl, toUrl } from './url';

const PALETTE_URL = chrome.runtime.getURL('palette.html');
/** Pages where extensions can't run content scripts. */
const RESTRICTED =
  /^(chrome|chrome-extension|chrome-untrusted|chrome-search|edge|devtools|view-source|about):|^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/;

let settings: Promise<Settings> | null = null;
const getSettings = () => (settings ??= loadSettings().catch(() => DEFAULTS));
/** Catches the history index up, unless history is off (then nothing reads it). */
const syncHistoryIfUsed = () =>
  void getSettings()
    .then((s) => {
      if (sourceOn(s, 'history')) return syncHistory();
    })
    .catch(() => {});
/** The palette just opened: catch up history while the user starts typing. */
const catchUp = syncHistoryIfUsed;
onSettingsChanged(() => {
  settings = null;
});

function runCommand(command: string, tab?: chrome.tabs.Tab): void {
  if (command === OPEN_PALETTE) void showPalette(tab);
  if (command === EDIT_URL) void showPalette(tab, true);
  // `search-tabs` etc.: the palette narrowed to that source.
  const scope = command.slice(7) as ScopeKey;
  if (command.startsWith('search-') && Object.hasOwn(SCOPES, scope)) void showPalette(tab, false, scope);
}
chrome.commands.onCommand.addListener(runCommand);
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') void chrome.tabs.create({ url: 'options.html?welcome' });
});
// Tests call these from the worker: puppeteer can't press browser shortcuts.
Object.assign(globalThis, { showPalette, runCommand });

/** `editUrl`: open on this page's URL, so Enter changes the page. `scope`: open narrowed to one source. Our own pages just open the palette. */
async function showPalette(tab?: chrome.tabs.Tab, editUrl = false, scope?: ScopeKey): Promise<void> {
  tab ??= (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  const tabId = tab?.id;
  // What the fallback page needs to do what was asked: the scope, or the URL to edit.
  const asked = new URLSearchParams(scope ? { scope } : {});
  if (tabId == null) return openFallback(tab, asked);
  const url = tab.url || tab.pendingUrl || '';
  // Incognito's new tab page is the browser's own: overrides don't apply there.
  const ownPage = isOwnPage(url) || (url.startsWith('chrome://newtab') && !tab.incognito);
  // `tab`: the fallback page then changes this tab, not itself.
  if (editUrl && url && !ownPage) {
    asked.set('edit', url);
    asked.set('tab', String(tabId));
  }
  if (!ownPage && RESTRICTED.test(url)) return openFallback(tab, asked);
  const edit = editUrl && !ownPage ? url : undefined;

  // Sent along so the palette renders them before it becomes visible.
  const firstResults = edit
    ? getSettings().then((s) => search(edit, s, tab, false)).then((r) => r.results)
    : scope
      ? getSettings().then((s) => search('', s, tab, true, scope)).then((r) => r.results)
      : getSettings().then((s) => recent(tab, s));
  const [results, zoom] = await Promise.all([firstResults, chrome.tabs.getZoom(tabId).catch(() => 1)]);

  // Our own new tab / fallback page: just refocus its palette.
  if (ownPage) {
    const focused = chrome.runtime.sendMessage<Message>({ type: 'focus', tabId, results, scope }).catch(() => false);
    catchUp();
    if (await focused) return;
    if (RESTRICTED.test(url)) return openFallback(tab, asked);
  }

  const toggle: Message = { type: 'toggle', results, zoom, edit, scope };
  try {
    const sent = chrome.tabs.sendMessage(tabId, toggle, { frameId: 0 });
    if (!ownPage) catchUp();
    await sent;
  } catch {
    // No content script yet (tab loaded before install/reload): inject and retry.
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'], injectImmediately: true });
      await chrome.tabs.sendMessage(tabId, toggle, { frameId: 0 });
    } catch {
      await openFallback(tab, asked);
    }
  }
}

/** `asked`: passed to the built-in palette page (not to a custom fallback URL). */
async function openFallback(tab?: chrome.tabs.Tab, asked?: URLSearchParams): Promise<void> {
  const { fallbackUrl } = await getSettings();
  const custom = fallbackUrl ? toUrl(fallbackUrl) : null;
  const windowId = tab?.windowId;
  // Extension pages can't load in incognito (they'd open in a regular window), so incognito
  // only uses a website fallback, else the browser's own new tab: Ctrl-T still opens a tab.
  if (tab?.incognito) {
    await chrome.tabs.create(custom && isWebUrl(custom) ? { url: custom, windowId } : { windowId });
    return;
  }
  await chrome.tabs.create({ url: custom || `${PALETTE_URL}?fallback${asked?.size ? `&${asked}` : ''}`, windowId });
}

chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
  if (msg.type === 'query' && msg.options) {
    getSettings()
      .then((s) => optionRows(msg.text, s, msg.menu))
      .then((results) => sendResponse({ id: msg.id, results } satisfies QueryResponse))
      .catch(() => sendResponse({ id: msg.id, results: [] } satisfies QueryResponse));
    return true;
  }
  if (msg.type === 'set') {
    // Serialized so rapid changes build on each other.
    saving = saving.then(() => set(msg.key, msg.step, msg.value)).then(sendResponse, () => sendResponse(false));
    return true;
  }
  if (msg.type === 'query') {
    // An empty query means the palette just opened.
    if (!msg.text.trim()) catchUp();
    getSettings()
      .then((s) => search(msg.text, s, sender.tab, !msg.replace, msg.scope))
      .then((res) => sendResponse({ id: msg.id, ...res } satisfies QueryResponse))
      .catch(() => sendResponse({ id: msg.id, results: [] } satisfies QueryResponse));
    return true;
  }
  if (msg.type === 'older') {
    getSettings()
      .then((s) => searchOlder(msg.text, msg.exclude, sender.tab, s))
      .then((results) => sendResponse({ id: msg.id, results } satisfies QueryResponse))
      .catch(() => sendResponse({ id: msg.id, results: [] } satisfies QueryResponse));
    return true;
  }
  if (msg.type === 'close') {
    closePalettePage(sender.tab).then(sendResponse, () => sendResponse(false));
    return true;
  }
  if (msg.type === 'open') {
    void open(msg.result, msg.where, sender, msg.tabId);
    sendResponse(true);
  }
  return false;
});

let saving: Promise<unknown> = Promise.resolve();

async function set(key: string, step?: number, value?: string): Promise<boolean> {
  const next = applySetting(await getSettings(), key, step, value);
  // Cached only once saved: sync storage writes can fail (quotas).
  await saveSettings(next);
  settings = Promise.resolve(next);
  return true;
}

/** Closes a palette page and returns to the tab used before it. Keeps a window's last tab open. */
async function closePalettePage(tab?: chrome.tabs.Tab): Promise<boolean> {
  if (tab?.id == null) return false;
  const others = (await chrome.tabs.query({ windowId: tab.windowId })).filter((t) => t.id !== tab.id);
  if (!others.length) return false;
  const previous = others.reduce((a, b) => ((b.lastAccessed ?? 0) > (a.lastAccessed ?? 0) ? b : a));
  if (previous.id != null) await chrome.tabs.update(previous.id, { active: true });
  await chrome.tabs.remove(tab.id);
  return true;
}

/** `editTab`: the tab the fallback page is editing, changed instead of the page; then the page closes. */
async function open(result: Result, where: Where, sender: chrome.runtime.MessageSender, editTab?: number): Promise<void> {
  const from = sender.tab;
  const fromPalettePage = !!sender.url?.startsWith(PALETTE_URL);

  if (result.kind === 'tab' && result.tabId != null) {
    await chrome.tabs.update(result.tabId, { active: true });
    if (result.windowId != null) await chrome.windows.update(result.windowId, { focused: true });
    // A palette page that was only used to switch tabs has served its purpose.
    if (fromPalettePage && from?.id != null && from.id !== result.tabId) await chrome.tabs.remove(from.id);
    return;
  }

  // It may have been closed since: then the page changes itself.
  const edited = where === 'current' && editTab != null ? await chrome.tabs.get(editTab).catch(() => null) : null;
  const current = edited?.id ?? (where === 'current' && from?.id != null ? from.id : undefined);
  await go(result, current, from?.windowId);
  if (edited?.id != null) {
    await chrome.tabs.update(edited.id, { active: true });
    if (fromPalettePage && from?.id != null) await chrome.tabs.remove(from.id);
  }
}

async function go(result: Result, current: number | undefined, windowId: number | undefined): Promise<void> {
  if (result.kind === 'search') {
    if (result.target && isWebUrl(result.target)) return navigate(result.target, current, windowId);
    const { searchUrl } = await getSettings();
    if (!searchUrl) {
      await chrome.search.query(current != null ? { text: result.url, tabId: current } : { text: result.url, disposition: 'NEW_TAB' });
      return;
    }
    return navigate(searchUrl.replace('%s', encodeURIComponent(result.url)), current, windowId);
  }
  return navigate(result.url, current, windowId);
}

async function navigate(url: string, tabId: number | undefined, windowId: number | undefined): Promise<void> {
  if (tabId != null) await chrome.tabs.update(tabId, { url });
  else await chrome.tabs.create({ url, windowId });
}
