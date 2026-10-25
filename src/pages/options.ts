import { COLOR_KEYS, loadSettings, saveSettings, type Settings } from '../shared/settings';

const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const fallbackUrl = $<HTMLInputElement>('[name=fallbackUrl]');
const searchUrl = $<HTMLInputElement>('[name=searchUrl]');
const theme = $<HTMLSelectElement>('[name=theme]');
const focusNewTab = $<HTMLInputElement>('[name=focusNewTab]');

const colorInputs = COLOR_KEYS.map((key) => {
  const input = document.createElement('input');
  input.placeholder = 'Default';
  input.spellcheck = false;
  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  const name = document.createElement('span');
  name.append(swatch, key[0].toUpperCase() + key.slice(1));
  const label = document.createElement('label');
  label.append(name, input);
  $('#colors').append(label);
  return { key, input, swatch };
});

function updateSwatches(): void {
  for (const { input, swatch } of colorInputs) swatch.style.background = input.value.trim() || 'transparent';
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function save(): void {
  updateSwatches();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const colors: Settings['colors'] = {};
    for (const { key, input } of colorInputs) if (input.value.trim()) colors[key] = input.value.trim();
    void saveSettings({
      fallbackUrl: fallbackUrl.value.trim(),
      searchUrl: searchUrl.value.trim(),
      focusNewTab: focusNewTab.checked,
      theme: theme.value as Settings['theme'],
      colors,
    });
  }, 250);
}

void loadSettings().then((s) => {
  fallbackUrl.value = s.fallbackUrl;
  searchUrl.value = s.searchUrl;
  theme.value = s.theme;
  focusNewTab.checked = s.focusNewTab;
  for (const { key, input } of colorInputs) input.value = s.colors[key] ?? '';
  updateSwatches();
  document.addEventListener('input', save);
  document.addEventListener('change', save);
});

void chrome.commands.getAll().then((commands) => {
  const shortcut = commands.find((c) => c.name === 'open-palette')?.shortcut;
  if (shortcut) $('#shortcut').textContent = shortcut;
});
$('#shortcuts').addEventListener('click', () => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
