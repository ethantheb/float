import { displayUrl, isOwnPage } from './url';

/** Hard cap on indexed URLs; the least recently visited are evicted first. */
export const MAX_HISTORY = 5000;
/** Catch-up syncs re-read this far back, picking up page titles that arrived after their visit. */
const SYNC_OVERLAP_MS = 5 * 60_000;

export interface HistoryEntry {
  url: string;
  title: string;
  visits: number;
  typed: number;
  /** Lowercased title and display URL, precomputed for matching. */
  t: string;
  d: string;
}

/**
 * In-memory index of recent history, because chrome.history.search takes ~100ms
 * when many entries match. Lives only as long as the service worker, and is
 * caught up on palette open rather than via onVisited (which would wake the
 * worker on every navigation). Map order = visit recency, oldest first.
 */
let index: Map<string, HistoryEntry> | null = null;
let lastSync = 0;
let syncing: Promise<Map<string, HistoryEntry>> | null = null;
/** Bumped when history is deleted, so an in-flight sync doesn't resurrect removed entries. */
let generation = 0;

chrome.history.onVisitRemoved.addListener(() => {
  index = null;
  generation++;
});

/**
 * Loads the index, or catches it up with visits since the last sync. Queued behind
 * any sync in flight (rather than sharing it) so visits made meanwhile aren't missed.
 */
export function syncHistory(): Promise<Map<string, HistoryEntry>> {
  const next = (syncing ?? Promise.resolve())
    .catch(() => {})
    .then(sync);
  const clear = () => {
    if (syncing === next) syncing = null;
  };
  next.then(clear, clear);
  return (syncing = next);
}

/** The index as it stands, waiting for a load in flight or starting one if needed. */
export function getHistory(): Promise<Map<string, HistoryEntry>> {
  return index ? Promise.resolve(index) : (syncing ?? syncHistory());
}

async function sync(): Promise<Map<string, HistoryEntry>> {
  const gen = generation;
  const now = Date.now();
  const startTime = index ? lastSync - SYNC_OVERLAP_MS : 0;
  const items = await chrome.history.search({ text: '', startTime, maxResults: MAX_HISTORY });
  if (gen !== generation) return sync();

  const map = index ?? new Map<string, HistoryEntry>();
  // Results are newest first; insert oldest first so recency order is kept.
  for (let i = items.length - 1; i >= 0; i--) {
    const { url, title = '', visitCount = 0, typedCount = 0 } = items[i];
    if (!url || isOwnPage(url)) continue;
    map.delete(url);
    map.set(url, { url, title, visits: visitCount, typed: typedCount, t: title.toLowerCase(), d: displayUrl(url).toLowerCase() });
  }
  while (map.size > MAX_HISTORY) map.delete(map.keys().next().value!);

  index = map;
  lastSync = now;
  return map;
}
