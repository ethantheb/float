import { toUrl } from '../background/url';
import type { Message } from '../shared/messages';
import { DEFAULTS, SETTINGS_CACHE, applyAppearance, loadSettings, onSettingsChanged, type Settings } from '../shared/settings';
import { createHost, unzoom } from '../ui/host';
import { Palette } from '../ui/palette';
import { showWelcome } from './welcome';

/** localStorage key for `devicePixelRatio` at 100% zoom. */
const SCREEN_DPR = 'float-screen-dpr';

/** The browser's own new tab page; `chrome://newtab` loads this one. */
const BROWSER_NEW_TAB = 'chrome://new-tab-page/';

let cached: Settings = DEFAULTS;
try {
  const stored = localStorage.getItem(SETTINGS_CACHE);
  if (stored) cached = { ...DEFAULTS, ...JSON.parse(stored) };
} catch {
  // Ignore a corrupt cache; fresh settings follow.
}

/** Where a new tab goes instead of this page, or null to stay. */
function newTabTarget(s: Settings): string | null {
  if (s.newTab === 'browser') return BROWSER_NEW_TAB;
  if (s.newTab === 'url') return toUrl(s.newTabUrl);
  return s.focusNewTab ? chrome.runtime.getURL('palette.html?tab') : null;
}

/** Swaps this tab for an extension-created one, where the browser doesn't focus the address bar. */
async function replaceTab(url: string): Promise<void> {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id == null) throw new Error('no tab');
  const created = await chrome.tabs.create({ url, index: tab.index, windowId: tab.windowId, openerTabId: tab.openerTabId });
  if (tab.groupId !== -1 && created.id != null) await chrome.tabs.group({ groupId: tab.groupId, tabIds: created.id }).catch(() => {});
  await chrome.tabs.remove(tab.id);
}

/** Navigates in place so the address bar keeps focus (pages can't load chrome:// URLs). */
async function navigate(url: string): Promise<void> {
  if (/^https?:/i.test(url)) return location.replace(url);
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id == null) throw new Error('no tab');
  await chrome.tabs.update(tab.id, { url });
}

/** options.html is this page in options mode. */
const optionsPage = location.pathname.endsWith('/options.html');
// Back from a chrome:// page `navigate` opened: show the palette.
const back = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'back_forward';
// Tabs we create have a query string, so a bare URL is the browser's new tab page.
const target = optionsPage || location.search || back ? null : newTabTarget(cached);
// Leaving: don't mount, and recheck settings since only a mounted palette refreshes the cache.
if (target && cached.newTab !== 'float') void leave().catch(mount);
else {
  if (target) void replaceTab(target).catch(() => {});
  mount();
}

async function leave(): Promise<void> {
  cached = await loadSettings();
  localStorage.setItem(SETTINGS_CACHE, JSON.stringify(cached));
  const fresh = newTabTarget(cached);
  if (!fresh) return mount();
  if (cached.newTab !== 'float') return navigate(fresh);
  void replaceTab(fresh).catch(() => {});
  mount();
}

function mount(): void {
  const { host, root } = createHost('open');
  const palette = new Palette(root, {
    page: true,
    // Esc closes this tab like the overlay closes, unless it's the window's last tab.
    onClose() {
      void chrome.runtime
        .sendMessage<Message, boolean>({ type: 'close' })
        .catch(() => false)
        .then((closed) => closed || palette.open());
    },
  });
  document.body.append(host);

  // Cached so the first frame is the right size; corrected by the tab's zoom below.
  let screenDpr = Number(localStorage.getItem(SCREEN_DPR)) || devicePixelRatio;
  unzoom(host, screenDpr);
  addEventListener('resize', () => unzoom(host, screenDpr));

  function apply(s: Settings): void {
    applyAppearance(host, s);
    if (s.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.dataset.theme = s.theme;
  }
  apply(cached);

  function refresh(): void {
    void loadSettings().then((s) => {
      apply(s);
      localStorage.setItem(SETTINGS_CACHE, JSON.stringify(s));
    });
  }
  refresh();
  onSettingsChanged(refresh);

  if (optionsPage) {
    palette.openOptions();
    if (location.search === '?welcome') showWelcome(host, root);
  } else palette.open();

  // The shortcut pressed while this page is active refocuses it instead of opening another tab.
  let tabId: number | undefined;
  void chrome.tabs.getCurrent().then(async (t) => {
    tabId = t?.id;
    if (tabId == null) return;
    screenDpr = devicePixelRatio / (await chrome.tabs.getZoom(tabId));
    localStorage.setItem(SCREEN_DPR, String(screenDpr));
    unzoom(host, screenDpr);
  });
  chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
    if (msg.type !== 'focus' || msg.tabId !== tabId) return;
    palette.open(msg.results);
    sendResponse(true);
  });
}
