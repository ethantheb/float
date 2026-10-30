import { OPEN_PALETTE, SHORTCUTS_URL, currentShortcut } from '../shared/shortcut';
import { el, icon } from '../ui/palette';
import css from './welcome.css';

function button(cls: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** The first-run box above the options palette, in its shadow root to share its colors. */
export function showWelcome(host: HTMLElement, root: ShadowRoot): void {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];

  // The manifest default, until the actual binding loads.
  const suggested = (chrome.runtime.getManifest().commands?.[OPEN_PALETTE] as { suggested_key?: { default?: string } } | undefined)
    ?.suggested_key?.default;
  const key = el('kbd', '', suggested ?? '');
  const shortcutText = el('span', '', 'Press ', key, ' on any page to open Float over it.', el('br', ''), el('span', 'muted', 'In supported browsers you can bind it to Ctrl+T.'));
  const change = button('', 'Change shortcut', () => void chrome.tabs.create({ url: SHORTCUTS_URL }));
  const dismiss = button('close', '', close);
  dismiss.title = 'Close';
  dismiss.setAttribute('aria-label', 'Close');
  dismiss.append(icon(['M7 7l10 10M17 7 7 17'], 'cross'));

  const box = el(
    'section',
    'welcome',
    el('h1', '', 'Welcome to Float'),
    el('p', '', shortcutText, change),
    el('p', '', el('span', '', 'Float is also your ', el('strong', '', 'new tab page'), '. You can change that in the options below.')),
    el('p', '', el('span', '', icon(['M12 5v14m-6-6 6 6 6-6'], 'down'), "These are Float's options. To get back here from any page, open Float and search ", el('strong', '', 'Float options'), '.')),
    dismiss,
  );
  // Keep the palette's input focused on click.
  box.addEventListener('mousedown', (e) => e.preventDefault());
  root.append(box);

  // Measured now, so the palette is offset in the first frame.
  const measure = () => host.style.setProperty('--welcome-h', `${box.offsetHeight}px`);
  host.classList.add('welcoming');
  measure();
  const resize = new ResizeObserver(measure);
  resize.observe(box);

  void currentShortcut().then((shortcut) => {
    if (shortcut) key.textContent = shortcut;
    else {
      shortcutText.replaceChildren("Float doesn't have a shortcut yet. Set one to open Float over any page.");
      change.textContent = 'Set shortcut';
    }
  });

  function close(): void {
    resize.disconnect();
    box.remove();
    host.classList.remove('welcoming');
    host.style.removeProperty('--welcome-h');
    // A reload shows the plain options page.
    history.replaceState(null, '', location.pathname);
  }
}
