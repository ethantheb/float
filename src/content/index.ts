import type { Message } from '../shared/messages';
import { applyAppearance, loadSettings, onSettingsChanged } from '../shared/settings';
import { createHost, unzoom } from '../ui/host';
import { Palette } from '../ui/palette';

// A newer copy of this script (re-injection, or the extension was reloaded) replaces older ones.
document.dispatchEvent(new CustomEvent('float:takeover'));

/** Events that must not reach the page while the palette has them (e.g. YouTube's `k` hotkey). */
const ISOLATED = [
  'keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'paste', 'copy', 'cut',
  'compositionstart', 'compositionupdate', 'compositionend', 'focusin', 'focusout',
  'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu',
];
const stop = (e: Event) => e.stopPropagation();

type Toggle = Extract<Message, { type: 'toggle' }>;

let host: HTMLElement | undefined;
let palette: Palette | undefined;
let previousFocus: HTMLElement | null = null;
let open = false;
/** `devicePixelRatio` at 100% zoom, from the zoom sent at open. */
let screenDpr = 1;

function build(): void {
  if (host) return;
  const created = createHost('closed');
  host = created.host;
  host.popover = 'manual'; // Top layer: above any page z-index, dialogs, and fullscreen elements.
  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  backdrop.addEventListener('mousedown', () => hide(false));
  created.root.append(backdrop);
  palette = new Palette(created.root, { page: false, onClose: hide });
  for (const type of ISOLATED) host.addEventListener(type, stop);
  document.documentElement.append(host);
  void loadSettings().then((s) => host && applyAppearance(host, s));
}

function deepActiveElement(): HTMLElement | null {
  let a = document.activeElement;
  while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
  return a as HTMLElement | null;
}

function show({ results, zoom, edit }: Toggle): void {
  build();
  if (!host!.isConnected) document.documentElement.append(host!);
  previousFocus = deepActiveElement();
  open = true;
  screenDpr = devicePixelRatio / zoom;
  unzoom(host!, screenDpr);
  // One task: results render and the panel shows in the same frame.
  host!.showPopover();
  palette!.open(results, edit);
}

function hide(restoreFocus: boolean): void {
  // Hiding blurs the input, which re-enters here.
  if (!open) return;
  open = false;
  host!.hidePopover();
  palette!.reset();
  if (restoreFocus) previousFocus?.focus?.({ preventScroll: true });
  previousFocus = null;
}

const onMessage = (msg: Message, _sender: chrome.runtime.MessageSender, sendResponse: (r: boolean) => void) => {
  if (msg.type !== 'toggle') return;
  if (open) hide(true);
  else show(msg);
  sendResponse(true);
};
chrome.runtime.onMessage.addListener(onMessage);

// Zooming while open resizes the viewport.
addEventListener('resize', () => open && unzoom(host!, screenDpr));

onSettingsChanged(() => void loadSettings().then((s) => host && applyAppearance(host, s)));

document.addEventListener(
  'float:takeover',
  () => {
    host?.remove();
    host = undefined;
    open = false;
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch {
      // Context already invalidated.
    }
  },
  { once: true },
);

/** Lays the palette out once, unpainted (show, layout, hide in one task), to set up fonts ahead of the first open. */
function warm(): void {
  if (!host?.isConnected || open) return;
  host.showPopover();
  palette!.warm();
  host.hidePopover();
}

// Build the hidden palette while the page is idle so opening is just a visibility toggle,
// then warm it up only when the page is idle again (no timeout: an open does this anyway).
requestIdleCallback(
  () => {
    build();
    requestIdleCallback(warm);
  },
  { timeout: 3000 },
);
