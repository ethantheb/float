const MAX_CACHED = 300;

/** Page URL -> base64 PNG. Promises, so concurrent lookups share one fetch. */
const cache = new Map<string, Promise<string | undefined>>();

/**
 * Fetches a page's favicon from the browser's favicon cache as base64 PNG.
 * Done here because pages may refuse to load extension URLs (e.g. YouTube), so
 * the palette receives bytes and draws them itself.
 */
export function favicon(pageUrl: string): Promise<string | undefined> {
  let icon = cache.get(pageUrl);
  if (!icon) {
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
    icon = load(pageUrl);
    cache.set(pageUrl, icon);
  }
  return icon;
}

async function load(pageUrl: string): Promise<string | undefined> {
  try {
    const res = await fetch(chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=32`));
    const bytes = new Uint8Array(await res.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  } catch {
    cache.delete(pageUrl);
    return undefined;
  }
}
