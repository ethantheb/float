import css from './palette.css';

/** Creates the `<float-root>` element with a styled shadow root to mount the palette into. */
export function createHost(mode: ShadowRootMode): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement('float-root');
  const root = host.attachShadow({ mode });
  try {
    // Constructed sheets aren't subject to the page's style-src CSP.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement('style');
    style.textContent = css;
    root.append(style);
  }
  return { host, root };
}

/** Undoes the browser's zoom, given `devicePixelRatio` at 100%, so the palette stays one size. */
export function unzoom(host: HTMLElement, screenDpr: number): void {
  host.style.setProperty('--float-zoom', String(screenDpr / devicePixelRatio));
}
