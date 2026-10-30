import { isWebUrl } from './url';

/**
 * Helium's bang list, bundled as bangs.json (updated with `npm run bangs`). On install and
 * update it's copied into chrome.storage.local as one key per trigger (`b:g` → [name,
 * template]), so a lookup reads one small value instead of parsing the list into worker memory.
 */
const PREFIX = 'b:';
const KEYS = 'bangs:keys';
/** The extension version whose list is stored. */
const VERSION = 'bangs:version';
/** Keys per write: one write of the whole list blocks the worker for ~200 ms, batches ~10 ms. */
const BATCH = 1000;

type Bang = [name: string, template: string];

export interface BangMatch {
  name: string;
  trigger: string;
  /** The bang is the first word. */
  leading: boolean;
  /** The query without the bang. */
  terms: string;
  url: string;
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install' || reason === 'update') void installBangs().catch(() => {});
});
// Finishes an install the worker was stopped in the middle of.
chrome.runtime.onStartup.addListener(async () => {
  const stored = (await chrome.storage.local.get(VERSION))[VERSION];
  if (stored !== chrome.runtime.getManifest().version) await installBangs().catch(() => {});
});

let installing: Promise<void> | null = null;

function installBangs(): Promise<void> {
  return (installing ??= (async () => {
    const { bangs } = (await (await fetch(chrome.runtime.getURL('bangs.json'))).json()) as { bangs: [string, string, ...string[]][] };
    const entries: [string, Bang][] = [];
    for (const [name, template, ...triggers] of bangs) for (const t of triggers) entries.push([PREFIX + t, [name, template]]);

    const old = ((await chrome.storage.local.get(KEYS))[KEYS] as string[] | undefined) ?? [];
    for (let i = 0; i < entries.length; i += BATCH) await chrome.storage.local.set(Object.fromEntries(entries.slice(i, i + BATCH)));
    const keys = entries.map(([key]) => key);
    await chrome.storage.local.set({ [KEYS]: keys, [VERSION]: chrome.runtime.getManifest().version });
    const current = new Set(keys);
    const gone = old.filter((key) => !current.has(key));
    if (gone.length) await chrome.storage.local.remove(gone);
  })().finally(() => {
    installing = null;
  }));
}

/** The search URL for a bang, or the site itself when there are no terms (like DuckDuckGo). */
function bangUrl(template: string, terms: string): string | null {
  try {
    const url = new URL(template.replaceAll('{searchTerms}', encodeURIComponent(terms)));
    if (!isWebUrl(url.href)) return null;
    return terms ? url.href : url.origin + '/';
  } catch {
    return null;
  }
}

/** Finds a bang at the start or end of the query (as in Helium), e.g. `!g rust` or `rust !g`. */
export async function findBang(text: string): Promise<BangMatch | null> {
  const words = text.trim().split(/\s+/);
  const at = [...new Set([0, words.length - 1])].filter((i) => words[i].length > 1 && words[i][0] === '!');
  if (!at.length) return null;
  const keys = at.map((i) => PREFIX + words[i].slice(1).toLowerCase());
  const found = await chrome.storage.local.get(keys);
  for (const [n, i] of at.entries()) {
    const bang = found[keys[n]] as Bang | undefined;
    if (!bang) continue;
    const terms = words.filter((_, j) => j !== i).join(' ');
    const url = bangUrl(bang[1], terms);
    if (url) return { name: bang[0], trigger: keys[n].slice(PREFIX.length), leading: i === 0, terms, url };
  }
  return null;
}
