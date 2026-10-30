import type { Message, QueryResponse, Result, Where } from '../shared/messages';
import { DEFAULTS, loadSettings, onSettingsChanged, saveSettings, type Settings } from '../shared/settings';
import { OPEN_PALETTE } from '../shared/shortcut';
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
onSettingsChanged(() => {
  settings = null;
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === OPEN_PALETTE) void showPalette(tab);
});
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') void chrome.tabs.create({ url: 'options.html?welcome' });
});
// Tests call this from the worker: puppeteer can't press browser shortcuts.
Object.assign(globalThis, { showPalette });

async function showPalette(tab?: chrome.tabs.Tab): Promise<void> {
  tab ??= (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  const tabId = tab?.id;
  if (tabId == null) return openFallback(tab);
  const url = tab.url || tab.pendingUrl || '';
  const ownPage = isOwnPage(url) || url.startsWith('chrome://newtab');
  if (!ownPage && RESTRICTED.test(url)) return openFallback(tab);

  // Sent along so the palette renders them before it becomes visible.
  const [results, zoom] = await Promise.all([recent(tabId), chrome.tabs.getZoom(tabId).catch(() => 1)]);
  // Catch up history while the user starts typing (queued behind the message).
  const catchUp = () => void syncHistory().catch(() => {});

  // Our own new tab / fallback page: just refocus its palette.
  if (ownPage) {
    const focused = chrome.runtime.sendMessage<Message>({ type: 'focus', tabId, results }).catch(() => false);
    catchUp();
    if (await focused) return;
    if (RESTRICTED.test(url)) return openFallback(tab);
  }

  const toggle: Message = { type: 'toggle', results, zoom };
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
      await openFallback(tab);
    }
  }
}

async function openFallback(tab?: chrome.tabs.Tab): Promise<void> {
  const { fallbackUrl } = await getSettings();
  const url = (fallbackUrl && toUrl(fallbackUrl)) || `${PALETTE_URL}?fallback`;
  await chrome.tabs.create({ url, windowId: tab?.windowId });
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
    // An empty query means the palette just opened: catch up history while the user starts typing.
    if (!msg.text.trim()) void syncHistory().catch(() => {});
    getSettings()
      .then((s) => search(msg.text, s, sender.tab?.id))
      .then(({ results, more }) => sendResponse({ id: msg.id, results, more } satisfies QueryResponse))
      .catch(() => sendResponse({ id: msg.id, results: [] } satisfies QueryResponse));
    return true;
  }
  if (msg.type === 'older') {
    searchOlder(msg.text, msg.exclude)
      .then((results) => sendResponse({ id: msg.id, results } satisfies QueryResponse))
      .catch(() => sendResponse({ id: msg.id, results: [] } satisfies QueryResponse));
    return true;
  }
  if (msg.type === 'close') {
    closePalettePage(sender.tab).then(sendResponse, () => sendResponse(false));
    return true;
  }
  if (msg.type === 'open') {
    void open(msg.result, msg.where, sender);
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

async function open(result: Result, where: Where, sender: chrome.runtime.MessageSender): Promise<void> {
  const from = sender.tab;
  const fromPalettePage = !!sender.url?.startsWith(PALETTE_URL);

  if (result.kind === 'tab' && result.tabId != null) {
    await chrome.tabs.update(result.tabId, { active: true });
    if (result.windowId != null) await chrome.windows.update(result.windowId, { focused: true });
    // A palette page that was only used to switch tabs has served its purpose.
    if (fromPalettePage && from?.id != null && from.id !== result.tabId) await chrome.tabs.remove(from.id);
    return;
  }

  const current = where === 'current' && from?.id != null ? from.id : undefined;
  if (result.kind === 'search') {
    if (result.target && isWebUrl(result.target)) return navigate(result.target, current, from?.windowId);
    const { searchUrl } = await getSettings();
    if (!searchUrl) {
      await chrome.search.query(current != null ? { text: result.url, tabId: current } : { text: result.url, disposition: 'NEW_TAB' });
      return;
    }
    return navigate(searchUrl.replace('%s', encodeURIComponent(result.url)), current, from?.windowId);
  }
  return navigate(result.url, current, from?.windowId);
}

async function navigate(url: string, tabId: number | undefined, windowId: number | undefined): Promise<void> {
  if (tabId != null) await chrome.tabs.update(tabId, { url });
  else await chrome.tabs.create({ url, windowId });
}
