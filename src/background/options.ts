import { normalize, score } from '../shared/fuzzy';
import type { Result, Setting } from '../shared/messages';
import { COLOR_KEYS, type ColorKey, type Settings } from '../shared/settings';
import { EDIT_URL, SHORTCUTS_URL, currentShortcut } from '../shared/shortcut';
import { displayUrl, hostOf } from './url';

type Choices<T extends string> = readonly (readonly [T, string])[];
const THEMES: Choices<Settings['theme']> = [['auto', 'Follow browser'], ['dark', 'Dark'], ['light', 'Light']];
const NEW_TABS: Choices<Settings['newTab']> = [['float', 'Float'], ['browser', 'Browser default'], ['url', 'Custom URL']];

const nameOf = <T extends string>(list: Choices<T>, v: T) => list.find(([k]) => k === v)?.[1] ?? v;
const step = <T extends string>(list: Choices<T>, v: T, by: number) =>
  list[(list.findIndex(([k]) => k === v) + by + list.length) % list.length][0];

const COLORS: Record<ColorKey, [name: string, help: string]> = {
  bg: ['Background', "The palette's background."],
  fg: ['Text', 'Titles and typed text.'],
  muted: ['Muted text', 'URLs, icons, placeholders, and descriptions like this one.'],
  border: ['Border', 'The outline and dividers.'],
  selected: ['Selection', 'The highlighted row.'],
  accent: ['Accent', 'The text cursor.'],
};

const row = (title: string, keywords: string, setting: Setting, url = ''): Result & { keywords: string } => ({
  kind: 'setting',
  title,
  sub: '',
  url,
  setting,
  keywords: `${title} ${keywords}`.toLowerCase(),
});

function colorRows(s: Settings) {
  return COLOR_KEYS.map((key) => {
    const [name, help] = COLORS[key];
    const value = s.colors[key] ?? '';
    return row(name, 'color colour', {
      key: `colors.${key}`,
      control: 'text',
      value: value || 'Default',
      swatch: value || undefined,
      help: `${help} Any CSS color, e.g. #1c1c1c or tomato; click the swatch for a picker. Leave empty for the theme default.`,
      edit: { key: `colors.${key}`, label: name, raw: value, placeholder: 'Default', color: key },
    });
  });
}

/** The settings rows (or a submenu's), in fixed order, filtered by `text`. */
export async function optionRows(text: string, s: Settings, menu?: string): Promise<Result[]> {
  const [shortcut, editShortcut] = await Promise.all([currentShortcut(), currentShortcut(EDIT_URL)]);
  const custom = COLOR_KEYS.filter((k) => s.colors[k]).length;
  const rows = menu === 'colors' ? colorRows(s) : [
    row('Shortcut', 'keyboard key binding hotkey ctrl', {
      key: 'shortcut',
      control: 'link',
      value: shortcut || 'Not set',
      help: "Opens Float over the current page. Enter opens the browser's shortcut settings. In supported browsers you can bind it to Ctrl+T.",
    }, SHORTCUTS_URL),
    row('Edit URL shortcut', 'keyboard key binding hotkey address location ctrl+l', {
      key: 'editShortcut',
      control: 'link',
      value: editShortcut || 'Not set',
      help: "Opens Float on the current page's URL, to change the page in place. Enter opens the browser's shortcut settings.",
    }, SHORTCUTS_URL),
    row('Theme', 'dark light mode appearance', {
      key: 'theme',
      control: 'choice',
      value: nameOf(THEMES, s.theme),
      help: 'Light, dark, or follow the browser.',
    }),
    row('Edit colors', 'color colour appearance background text muted border selection accent', {
      key: 'colors',
      control: 'menu',
      label: 'Colors',
      value: custom ? `${custom} custom` : 'Default',
      help: "Override the theme's colors, one at a time.",
    }),
    row('New tab page', 'newtab', {
      key: 'newTab',
      control: 'choice',
      value: s.newTab === 'url' ? (s.newTabUrl ? displayUrl(s.newTabUrl) : 'Custom URL') : nameOf(NEW_TABS, s.newTab),
      help: s.newTab !== 'url'
        ? "What new tabs show: Float, the browser's own new tab page, or a URL of your choice."
        : s.newTabUrl
          ? 'New tabs open this URL. Enter edits it; ←/→ choose another page.'
          : 'Press Enter to set the URL. ←/→ choose another page.',
      edit: s.newTab === 'url' ? { key: 'newTabUrl', label: 'New tab URL', raw: s.newTabUrl, placeholder: 'example.com' } : undefined,
    }),
    row('Focus palette on new tabs', 'newtab address bar', {
      key: 'focusNewTab',
      control: 'toggle',
      value: s.newTab !== 'float' ? 'Not used' : s.focusNewTab ? 'On' : 'Off',
      disabled: s.newTab !== 'float',
      help: s.newTab !== 'float'
        ? 'Only applies when Float is the new tab page (see New tab page above).'
        : 'Browsers focus the address bar on new tab pages. When on, Float swaps the new tab for an identical one so you can type straight away.',
    }),
    row('Search URL', 'engine web kagi google', {
      key: 'searchUrl',
      control: 'text',
      value: s.searchUrl ? hostOf(s.searchUrl) : 'Browser default',
      help: "Where web searches go. Use %s for the query. Leave empty for the browser's default search engine.",
      edit: { key: 'searchUrl', label: 'Search URL', raw: s.searchUrl, placeholder: 'https://kagi.com/search?q=%s' },
    }),
    row('Bangs', 'bang ! shortcut keyword helium duckduckgo kagi', {
      key: 'bangs',
      control: 'toggle',
      value: s.bangs ? 'On' : 'Off',
      help: "Start or end a search with a bang to search that site directly, e.g. !yt lofi or rust !g. Uses Helium's bang list, bundled with Float.",
    }),
    row('Fallback URL', 'restricted', {
      key: 'fallbackUrl',
      control: 'text',
      value: s.fallbackUrl ? displayUrl(s.fallbackUrl) : 'Palette page',
      help: "Opened in a new tab when Float can't appear on the current page (browser pages, the Web Store, some Google sites). Leave empty for Float's palette page.",
      edit: { key: 'fallbackUrl', label: 'Fallback URL', raw: s.fallbackUrl, placeholder: "Float's palette page" },
    }),
  ];

  const q = normalize(text);
  const results: Result[] = q ? rows.filter((r) => score(q, r.keywords)) : rows;
  // The keywords stay in the worker.
  return results.map(({ keywords: _, ...r }: Result & { keywords?: string }) => r);
}

/** `by` steps a choice, `value` sets text, and toggles flip. */
export function applySetting(s: Settings, key: string, by = 1, value = ''): Settings {
  const next: Settings = { ...s, colors: { ...s.colors } };
  if (key === 'theme') next.theme = step(THEMES, s.theme, by);
  else if (key === 'newTab') next.newTab = step(NEW_TABS, s.newTab, by);
  else if (key === 'focusNewTab') next.focusNewTab = !s.focusNewTab;
  else if (key === 'bangs') next.bangs = !s.bangs;
  else if (key === 'newTabUrl' || key === 'searchUrl' || key === 'fallbackUrl') next[key] = value.trim();
  else if (key.startsWith('colors.')) {
    const color = key.slice(7) as ColorKey;
    if (value.trim()) next.colors[color] = value.trim();
    else delete next.colors[color];
  }
  return next;
}
