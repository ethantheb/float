export const COLOR_KEYS = ['bg', 'fg', 'muted', 'border', 'selected', 'accent'] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

/** The kinds of results the palette can show. Pinned tabs are separate from other tabs. */
export const SOURCE_KEYS = ['tabs', 'pinned', 'bookmarks', 'history', 'chrome'] as const;
export type SourceKey = (typeof SOURCE_KEYS)[number];

export interface Settings {
  /** Opened when the palette can't be shown on the current page. Empty = built-in palette page. */
  fallbackUrl: string;
  /** Search URL template with `%s`. Empty = the browser's default search engine. */
  searchUrl: string;
  /** Resolve `!bangs` (Helium's list) to the site's own search. */
  bangs: boolean;
  /** What new tabs show; 'url' opens `newTabUrl`. */
  newTab: 'float' | 'browser' | 'url';
  newTabUrl: string;
  /** Swap the browser's new tab page for a tab of our own so the palette gets focus, not the address bar. */
  focusNewTab: boolean;
  theme: 'auto' | 'dark' | 'light';
  /** CSS color overrides. Empty values use the theme default. */
  colors: Partial<Record<ColorKey, string>>;
  /** Which kinds of results appear. A source that isn't listed is on. 'typed' (tabs only): searched, but not listed while nothing is typed. */
  sources: Partial<Record<SourceKey, boolean | 'typed'>>;
}

export const sourceOn = (s: Settings, key: SourceKey): boolean => s.sources?.[key] !== false;
/** On, and also listed while nothing is typed (not 'typed'). */
export const sourceListed = (s: Settings, key: SourceKey): boolean => sourceOn(s, key) && s.sources?.[key] !== 'typed';

/** localStorage key mirroring settings, so extension pages apply the theme before first paint. */
export const SETTINGS_CACHE = 'float-settings';

export const DEFAULTS: Settings = { fallbackUrl: '', searchUrl: '', bangs: true, newTab: 'float', newTabUrl: '', focusNewTab: true, theme: 'auto', colors: {}, sources: {} };

export async function loadSettings(): Promise<Settings> {
  return (await chrome.storage.sync.get(DEFAULTS)) as Settings;
}

export function saveSettings(s: Partial<Settings>): Promise<void> {
  return chrome.storage.sync.set(s);
}

/** Sync area only: the content script must not receive local-storage writes (the bang list). */
export function onSettingsChanged(cb: () => void): void {
  chrome.storage.sync.onChanged.addListener(() => cb());
}

/** Applies theme and color overrides to a palette host element. */
export function applyAppearance(host: HTMLElement, s: Settings): void {
  if (s.theme === 'auto') host.removeAttribute('data-theme');
  else host.setAttribute('data-theme', s.theme);
  for (const key of COLOR_KEYS) {
    const value = s.colors[key]?.trim();
    if (value) host.style.setProperty(`--float-${key}`, value);
    else host.style.removeProperty(`--float-${key}`);
  }
}
