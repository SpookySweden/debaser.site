import type { WebStreamItem, WebStreamPage } from './dedupe';
import { clampLimit, compareFor, decodeCursor, encodeCursor, type StreamDirection } from './paging';
import type { WebItem } from './types';

/**
 * The /web stream with the media servers' titles in it (SPEC-media-servers.md): one list, newest first, from
 * two reads after the same cursor - the stream's page (deduped, dedupe.ts) and the media titles' page (film series
 * collapsed, media-collections.ts). Pure, so the mock and the Supabase repository merge the same way;
 * `scripts/check-web-media.cjs` holds it.
 *
 * The cursor is a position in the one shared order (`publishedAt`, then `id`), so both reads can start from it.
 * Each read has looked at everything down to its own next cursor (its "frontier"), but may hand back fewer rows
 * than that, because rows riding on an earlier row are left off. So a row older than the frontier of a source that
 * has more is NOT shown yet: that source may hold newer rows it has not read. The page keeps the first `limit` rows
 * no older than the newest such frontier; the next cursor is the last row kept (or that frontier, if none is).
 * Re-reading from there is safe: a row riding on an earlier one is left off again.
 *
 * A media title is never deduped against the stream's items (it has its own SERVER buttons, not ALSO ON).
 * Oldest first (`direction` 'asc', SPEC-web-sort.md) is the same with the order reversed: the "newest frontier" is
 * then the frontier that comes first in that order.
 */
export function mergeStreamPages(
  stream: WebStreamPage,
  media: { items: readonly WebItem[]; nextCursor: string | null },
  limit: unknown,
  direction: StreamDirection = 'desc',
): WebStreamPage {
  const compareItems = compareFor(direction);
  const size = clampLimit(limit);
  const all: WebStreamItem[] = [...stream.items, ...media.items.map((item) => ({ ...item, alsoOn: [] }))].sort(compareItems);
  const frontiers = [stream.nextCursor, media.nextCursor].flatMap((cursor) => {
    const at = cursor === null ? null : decodeCursor(cursor);
    return at === null ? [] : [{ ...at, cursor: cursor as string }];
  });
  // The newest frontier: nothing older than it is known to be complete.
  const frontier = frontiers.sort((a, b) => compareItems(a as unknown as WebItem, b as unknown as WebItem))[0];
  const complete = frontier ? all.filter((row) => compareItems(row, frontier as unknown as WebItem) <= 0) : all;
  const kept = complete.slice(0, size);
  const last = kept[kept.length - 1];
  const more = all.length > kept.length || frontier !== undefined;
  if (!more) return { items: kept, nextCursor: null };
  if (last === undefined) return { items: [], nextCursor: frontier ? frontier.cursor : null };
  return { items: kept, nextCursor: encodeCursor({ publishedAt: last.publishedAt, id: last.id }) };
}
