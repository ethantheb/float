const EXPLICIT_SCHEME = /^(https?|ftp|file|chrome|chrome-extension|about|view-source|data):/i;
const LOCAL = /^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?([/?#]|$)/i;
const DOMAIN = /^[\w-]+(\.[\w-]+)*\.[a-z]{2,24}(:\d+)?([/?#]|$)/i;

const OWN_ORIGIN = chrome.runtime.getURL('');

/** Float's own pages, left out of history and bookmark results. */
export const isOwnPage = (url: string) => url.startsWith(OWN_ORIGIN);

/** Returns a navigable URL if the input looks like one, otherwise null. */
export function toUrl(input: string): string | null {
  const s = input.trim();
  if (!s || /\s/.test(s)) return null;
  if (EXPLICIT_SCHEME.test(s)) return s;
  if (LOCAL.test(s)) return 'http://' + s;
  if (DOMAIN.test(s)) return 'https://' + s;
  return null;
}

/** Compact URL for display and matching: no scheme, `www.`, or trailing slash. */
export function displayUrl(url: string): string {
  return url.replace(/^(https?|ftp):\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
}

export function hostOf(url: string): string {
  try {
    return new URL(url.replace('%s', '')).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Whether a URL is http(s), so opening it can't run script or reach a privileged page. */
export function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac']);

/** A readable name for a site, e.g. https://mail.google.com/ → "Google". The URL itself if there's no host to name. */
export function siteName(url: string): string {
  const host = isWebUrl(url) ? hostOf(url).replace(/:\d+$/, '') : '';
  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2 || /^[\d.]+$/.test(host) || host.includes(':')) return displayUrl(url);
  labels.pop();
  if (labels.length > 1 && SECOND_LEVEL.has(labels[labels.length - 1])) labels.pop();
  const name = labels[labels.length - 1];
  if (!name) return displayUrl(url);
  return name[0].toUpperCase() + name.slice(1);
}
