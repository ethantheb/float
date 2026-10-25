import { ICON_PX } from '../shared/messages';

const MAX_CACHED = 300;

/** Page URL -> base64 RGBA pixels. Promises, so concurrent lookups share one fetch. */
const cache = new Map<string, Promise<string | undefined>>();

let canvas: OffscreenCanvasRenderingContext2D | undefined;

/**
 * Fetches a page's favicon from the browser's favicon cache as base64 RGBA pixels.
 * Done here because pages may refuse to load extension URLs (e.g. YouTube), so the
 * palette receives pixels and draws them itself. Decoded here, once, because decoding
 * in the page is async and the first decode in a tab takes tens of ms.
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

/** Native where available (Chrome 140+), which matters right after the worker starts. */
function toBase64(data: Uint8ClampedArray): string {
  const bytes = new Uint8Array(data.buffer);
  const native = (bytes as { toBase64?: () => string }).toBase64;
  if (native) return native.call(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function load(pageUrl: string): Promise<string | undefined> {
  try {
    const res = await fetch(chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=${ICON_PX}`));
    const bitmap = await createImageBitmap(await res.blob(), { resizeWidth: ICON_PX, resizeHeight: ICON_PX, resizeQuality: 'high' });
    canvas ??= new OffscreenCanvas(ICON_PX, ICON_PX).getContext('2d', { willReadFrequently: true })!;
    canvas.clearRect(0, 0, ICON_PX, ICON_PX);
    canvas.drawImage(bitmap, 0, 0);
    bitmap.close();
    return toBase64(canvas.getImageData(0, 0, ICON_PX, ICON_PX).data);
  } catch {
    cache.delete(pageUrl);
    return undefined;
  }
}
