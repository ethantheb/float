import type { Message } from '../shared/messages';
import { DEFAULTS, SETTINGS_CACHE, applyAppearance, loadSettings, onSettingsChanged, type Settings } from '../shared/settings';
import { createHost } from '../ui/host';
import { Palette } from '../ui/palette';

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

function apply(s: Settings): void {
  applyAppearance(host, s);
  if (s.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = s.theme;
}

let cached: Settings = DEFAULTS;
try {
  const stored = localStorage.getItem(SETTINGS_CACHE);
  if (stored) apply((cached = { ...DEFAULTS, ...JSON.parse(stored) }));
} catch {
  // Ignore a corrupt cache; fresh settings follow.
}

/**
 * The browser focuses its address bar on new tab pages (extension ones included) and pages
 * can't take focus back. A tab the extension creates isn't a new tab page, so swap this one
 * for such a tab. Tabs we create carry a query string (`?tab`, `?fallback`), so a bare URL
 * means this is the browser's new tab page.
 */
async function replaceNewTab(): Promise<void> {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id == null) return;
  const created = await chrome.tabs.create({
    url: chrome.runtime.getURL('palette.html?tab'),
    index: tab.index,
    windowId: tab.windowId,
    openerTabId: tab.openerTabId,
  });
  if (tab.groupId !== -1 && created.id != null) await chrome.tabs.group({ groupId: tab.groupId, tabIds: created.id }).catch(() => {});
  await chrome.tabs.remove(tab.id);
}
if (!location.search && cached.focusNewTab) void replaceNewTab().catch(() => {});

function refresh(): void {
  void loadSettings().then((s) => {
    apply(s);
    localStorage.setItem(SETTINGS_CACHE, JSON.stringify(s));
  });
}
refresh();
onSettingsChanged(refresh);

palette.open();

// The shortcut pressed while this page is active refocuses it instead of opening another tab.
let tabId: number | undefined;
void chrome.tabs.getCurrent().then((t) => (tabId = t?.id));
chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  if (msg.type !== 'focus' || msg.tabId !== tabId) return;
  palette.open(msg.results);
  sendResponse(true);
});
