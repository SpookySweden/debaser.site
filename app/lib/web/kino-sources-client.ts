import { kinoTitleKey, KINO_SOURCES_MAX, type KinoSources, type KinoTitle } from './kino';
import { webSessionHeaders } from './web-session';

/**
 * The page's side of /api/web/kino/sources: rows ask one by one as they are drawn, and all the rows drawn together go
 * as one request (one question to Wikidata for the page, rather than twenty). Each answer is kept for the visit, so a
 * row that comes back asks nothing. A failed request is forgotten, so the next drawing of the row tries again.
 */

const GATHER_MS = 30;

const known = new Map<string, Promise<KinoSources | null>>();
let waiting: { key: string; answer: (sources: KinoSources | null) => void }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

async function send(batch: readonly { key: string; answer: (sources: KinoSources | null) => void }[]): Promise<void> {
  let sources: Record<string, KinoSources> | null = null;
  try {
    const headers = await webSessionHeaders();
    if (headers !== null) {
      // In a fixed order, so the same page of rows is the same question, whichever row was drawn first.
      const titles = batch.map((entry) => entry.key).sort().join(',');
      const response = await fetch(`/api/web/kino/sources?titles=${encodeURIComponent(titles)}`, { credentials: 'omit', headers });
      if (response.ok) sources = ((await response.json()) as { sources?: Record<string, KinoSources> }).sources ?? null;
    }
  } catch {
    sources = null;
  }
  for (const entry of batch) {
    const found = sources?.[entry.key] ?? null;
    if (found === null) known.delete(entry.key);
    entry.answer(found);
  }
}

function flush(): void {
  timer = null;
  const all = waiting;
  waiting = [];
  for (let at = 0; at < all.length; at += KINO_SOURCES_MAX) void send(all.slice(at, at + KINO_SOURCES_MAX));
}

/** A title's sources, or null when they could not be read this time. */
export function askKinoSources(title: KinoTitle): Promise<KinoSources | null> {
  const key = kinoTitleKey(title);
  const already = known.get(key);
  if (already !== undefined) return already;
  const promise = new Promise<KinoSources | null>((answer) => {
    waiting.push({ key, answer });
    timer ??= setTimeout(flush, GATHER_MS);
  });
  known.set(key, promise);
  return promise;
}
