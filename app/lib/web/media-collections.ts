import { compareItems } from './paging';
import { posterUrl, type MediaCollection, type MediaCopy, type MediaInfo, type MediaPart } from './media-titles';
import type { WebItem } from './types';

/**
 * Film series (TMDB collections) as ONE row each (Luke, 2026-11-01: "film series (TMDB collection)"). Pure, so
 * the mock and the Supabase repository group the same way; `scripts/check-web-media.cjs` holds it.
 *
 * TMDB names a film's collection (`belongs_to_collection`, saved in its details by the hourly update). On a page,
 * every film of a collection the servers hold is one row, led by the newest film in stream order: the row carries
 * the collection's name and poster, and all its films (`parts`, in release order) for the FILM picker. A film led
 * by a newer one is left off the page, because it is on that row, which is earlier in the stream. Re-reading a page
 * gives the same rows, the property the shared cursor relies on (media-merge.ts), as with dedupe.ts.
 *
 * `siblings`: every film sharing a collection with a page film (the page's own films may be among them), read with
 * the same search, so under a search a row holds only the films that match it.
 */

export function collectionOf(item: Pick<WebItem, 'media'>): MediaCollection | undefined {
  return item.media?.type === 'movie' ? item.media.details?.collection : undefined;
}

/** For searching: a film with its series' name added to its title, so a search for the series finds it. */
export function withSeriesName(item: WebItem): WebItem {
  const collection = collectionOf(item);
  return collection ? { ...item, title: `${item.title} ${collection.name}` } : item;
}

function toPart(item: WebItem): MediaPart {
  const media = item.media as MediaInfo;
  const part: MediaPart = { id: item.id, title: item.title, copies: media.copies };
  if (media.tmdbId !== undefined) part.tmdbId = media.tmdbId;
  if (media.details?.date) part.date = media.details.date;
  if (media.details) part.details = media.details;
  return part;
}

/** Every server holding any film of the collection, once each, in the first film's order then the next's. */
function unionCopies(parts: readonly MediaPart[]): MediaCopy[] {
  const seen = new Map<string, MediaCopy>();
  for (const part of parts) for (const copy of part.copies) if (!seen.has(copy.server)) seen.set(copy.server, { server: copy.server });
  return [...seen.values()];
}

/** The row for a collection: the leader's place in the stream, the collection's name and poster, every film. */
export function collectionRow(leader: WebItem, members: readonly WebItem[]): WebItem {
  const collection = collectionOf(leader) as MediaCollection;
  const parts = [...members].map(toPart).sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.title.localeCompare(b.title));
  const media = leader.media as MediaInfo;
  const row: WebItem = {
    ...leader,
    title: collection.name,
    media: { ...media, copies: unionCopies(parts), collection, parts },
  };
  // The collection's poster; else the leader's own. Its overview is the leader film's, so the row says no more than it knows.
  const poster = posterUrl(collection.posterPath);
  if (poster) row.thumbnailUrl = poster;
  delete row.description;
  delete row.durationSeconds;
  return row;
}

export function collapseCollections(page: readonly WebItem[], siblings: readonly WebItem[]): WebItem[] {
  const byCollection = new Map<number, Map<string, WebItem>>();
  for (const item of [...siblings, ...page]) {
    const collection = collectionOf(item);
    if (!collection) continue;
    const group = byCollection.get(collection.id) ?? new Map<string, WebItem>();
    if (!group.has(item.id)) group.set(item.id, item);
    byCollection.set(collection.id, group);
  }
  const rows: WebItem[] = [];
  for (const item of page) {
    const collection = collectionOf(item);
    const members = collection ? [...(byCollection.get(collection.id)?.values() ?? [])].sort(compareItems) : [];
    if (members.length < 2) {
      rows.push(item);
      continue;
    }
    if (members[0].id !== item.id) continue; // on the newer film's row
    rows.push(collectionRow(item, members));
  }
  return rows;
}

/**
 * One page of media rows, for either repository: a raw keyset page, its collections' other films, collapsed. A page
 * whose films all ride on earlier rows reads on (a few times at most), so LOAD MORE never adds nothing while more remains.
 * A failed sibling read shows the page ungrouped rather than not at all.
 */
export async function readMediaPage(
  readRaw: (cursor: string | null) => Promise<{ items: WebItem[]; nextCursor: string | null }>,
  readSiblings: (collections: number[]) => Promise<WebItem[]>,
  cursor: string | null,
): Promise<{ items: WebItem[]; nextCursor: string | null }> {
  let at = cursor;
  for (let read = 1; ; read += 1) {
    const raw = await readRaw(at);
    const collections = pageCollections(raw.items);
    let rows = raw.items;
    if (collections.length > 0) {
      try {
        rows = collapseCollections(raw.items, await readSiblings(collections));
      } catch {
        rows = raw.items;
      }
    }
    if (rows.length > 0 || raw.nextCursor === null || read >= 4) return { items: rows, nextCursor: raw.nextCursor };
    at = raw.nextCursor;
  }
}

/** The collections a page's films belong to (for the sibling read). */
export function pageCollections(page: readonly WebItem[]): number[] {
  return [...new Set(page.flatMap((item) => (collectionOf(item) ? [(collectionOf(item) as MediaCollection).id] : [])))];
}
