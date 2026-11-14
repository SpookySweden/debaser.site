import { isShort, shortCandidate, youtubeIdOf } from './shorts';

/**
 * No YouTube Shorts in the rows the browser reads itself (Luke, 2026-11-14: "i want them exluded from the results
 * entirely"): the saved stream, FOR YOU and the picks, read straight from the database by the repository. Rows already
 * saved before Shorts were left out are cleaned here, as they are read; nothing in the database is changed.
 *
 * A row marked as a Short (a /shorts/ link, a #shorts tag) goes at once (never a music row by marks: shorts.ts). A YouTube
 * row three minutes or less, or of unknown length, is asked about through our own route (/api/web/shorts, which asks
 * YouTube's /shorts/ page), and goes only if YouTube confirms it. If the route can't be asked, every row stays.
 * Answers are kept in this page's memory, so each video is asked about once a visit.
 */

const known = new Map<string, boolean>();
const MAX_PER_ASK = 60;

async function ask(ids: readonly string[]): Promise<void> {
  for (let start = 0; start < ids.length; start += MAX_PER_ASK) {
    const batch = [...ids.slice(start, start + MAX_PER_ASK)].sort();
    try {
      const response = await fetch(`/api/web/shorts?ids=${batch.join(',')}`, { credentials: 'omit' });
      if (!response.ok) return;
      const body = (await response.json()) as { shorts?: unknown };
      const shorts = new Set(Array.isArray(body.shorts) ? body.shorts.filter((id): id is string => typeof id === 'string') : []);
      for (const id of batch) known.set(id, shorts.has(id));
      changed();
    } catch {
      return;
    }
  }
}

const listeners = new Set<() => void>();
let version = 0;
function changed(): void {
  version += 1;
  for (const listener of listeners) listener();
}
/** For use-hidden-short.ts: told whenever an answer arrives. */
export function subscribeShorts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** For use-hidden-short.ts: bumped by every answer. */
export function shortsVersion(): number {
  return version;
}

/** What YouTube said of a video this visit: true a Short, false not, undefined not asked yet (or unsure). */
export function knownShort(id: string): boolean | undefined {
  return known.get(id);
}

/** Ids rows have asked about in this tick, sent as one request on the next (so a list of rows is one ask, not many). */
let waiting = new Set<string>();
let flushing = false;
export function askSoon(id: string): void {
  if (known.has(id) || typeof window === 'undefined') return;
  waiting.add(id);
  if (flushing) return;
  flushing = true;
  window.setTimeout(() => {
    const ids = [...waiting].filter((one) => !known.has(one));
    waiting = new Set();
    flushing = false;
    if (ids.length > 0) void ask(ids);
  }, 0);
}


/** The rows, without the Shorts (marked, or confirmed by YouTube); every other row in its place. */
export async function withoutShorts<T extends { platform: string; externalId?: string; url?: string; canonicalUrl?: string; title?: string; description?: string; creator?: string; durationSeconds?: number }>(
  items: readonly T[],
): Promise<T[]> {
  const kept = items.filter((item) => !isShort(item));
  const unknown = kept
    .filter(shortCandidate)
    .map(youtubeIdOf)
    .filter((id): id is string => id !== null && !known.has(id));
  if (unknown.length > 0 && typeof window !== 'undefined') await ask([...new Set(unknown)]);
  return kept.filter((item) => {
    const id = youtubeIdOf(item);
    return id === null || known.get(id) !== true;
  });
}
