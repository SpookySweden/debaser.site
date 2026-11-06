import { kinoTitleKey, KINO_SOURCES_MAX, type KinoSources, type KinoTitle } from './kino';
import { MEDIA_SERVERS } from './media-servers';
import { MEDIA_ID_PREFIX } from './media-titles';
import { getWebRepository } from './repository';
import type { WebItem } from './types';
import { webSessionHeaders } from './web-session';

/**
 * The page's side of /api/web/kino/sources: rows ask one by one as they are drawn, and all the rows drawn together go
 * as one request (one question to Wikidata for the page, rather than twenty). Each answer is kept for the visit, so a
 * row that comes back asks nothing. A failed request is forgotten, so the next drawing of the row tries again.
 *
 * `held`: the same title on friends' servers, matched by its TMDB number (a title's id holds it), so a KINO search lists
 * their copies too (Luke, 2026-11-06). No servers listed, nothing is asked.
 */

export type KinoWatch = KinoSources & { held: WebItem | null };

const GATHER_MS = 30;

const known = new Map<string, Promise<KinoWatch | null>>();
let waiting: { key: string; answer: (sources: KinoWatch | null) => void }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

const titleId = (key: string) => `${MEDIA_ID_PREFIX}tmdb-${key}`;

/** The friends' servers' rows for these titles. A failed read says nothing: the row just has fewer choices. */
async function readHeld(keys: readonly string[]): Promise<Map<string, WebItem>> {
  if (MEDIA_SERVERS.length === 0) return new Map();
  try {
    const items = await getWebRepository().mediaTitles(keys.map(titleId));
    return new Map(items.map((item) => [item.id, item]));
  } catch {
    return new Map();
  }
}

async function send(batch: readonly { key: string; answer: (sources: KinoWatch | null) => void }[]): Promise<void> {
  const heldBy = readHeld(batch.map((entry) => entry.key));
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
  const held = await heldBy;
  for (const entry of batch) {
    const read = sources?.[entry.key] ?? null;
    const title = held.get(titleId(entry.key)) ?? null;
    if (read === null) known.delete(entry.key);
    entry.answer(read === null && title === null ? null : { watch: read?.watch ?? null, free: read?.free ?? [], held: title });
  }
}

function flush(): void {
  timer = null;
  const all = waiting;
  waiting = [];
  for (let at = 0; at < all.length; at += KINO_SOURCES_MAX) void send(all.slice(at, at + KINO_SOURCES_MAX));
}

/** A title's sources, or null when they could not be read this time. */
export function askKinoSources(title: KinoTitle): Promise<KinoWatch | null> {
  const key = kinoTitleKey(title);
  const already = known.get(key);
  if (already !== undefined) return already;
  const promise = new Promise<KinoWatch | null>((answer) => {
    waiting.push({ key, answer });
    timer ??= setTimeout(flush, GATHER_MS);
  });
  known.set(key, promise);
  return promise;
}
