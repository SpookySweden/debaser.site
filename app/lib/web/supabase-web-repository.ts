import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '../supabase/client';
import { DEDUPE_KEY_SHAPE, MAX_GROUP_SIZE, readStreamPage, type WebStreamPage } from './dedupe';
import { authorList, authorPattern, searchText } from './search';
import { readMediaPage } from './media-collections';
import { mergeStreamPages } from './media-merge';
import { mediaRowToItem, WEB_MEDIA_COLUMNS, WEB_MEDIA_TITLES_TABLE, type WebMediaRow } from './media-rows';
import { assemblePage, clampLimit, decodeCursor, type StreamDirection, type WebPage } from './paging';
import type { WebRepository } from './repository';
import type { WebItem } from './types';
import {
  WEB_ITEM_COLUMNS,
  WEB_ITEMS_TABLE,
  WEB_SOURCE_COLUMNS,
  WEB_SOURCES_TABLE,
  rowToItem,
  rowToSource,
  type WebItemRow,
  type WebSourceRow,
} from './rows';

/**
 * The WEB stream in Supabase: reads `web_items` / `web_sources` with the public key. Row Level Security
 * shows only enabled rows and refuses every write; the ingest route is the only writer.
 *
 * Paging is the same opaque keyset cursor as the mock (`paging.ts`). After a cursor, a page is two reads
 * built with supabase-js's own filters (never by pasting the cursor into an `.or()` string): the rows at
 * the cursor's moment with a smaller id, then the rows before that moment. Both are ranges on
 * `web_items_stream_idx`, and `id` has collation "C", so ties order like the mock's string comparison.
 * A search read oldest first (SPEC-web-sort.md) is the mirror image: a larger id, then the rows after that moment,
 * both ascending (the same index, read the other way).
 */

const MAX_SOURCES = 200;

/** Thrown with a plain-words message; the page shows its own error state either way. */
const READ_FAILED = 'The archive could not be read.';

/** Which client to read with: the browser's, or a stand-in (`scripts/check-web-db-paging.cjs`). */
export type GetClient = () => SupabaseClient | null;

/** Enough copies of one fingerprint to decide its group: one more than a group may hold (dedupe.ts). */
const COPIES_PER_KEY = MAX_GROUP_SIZE + 1;

/** The text-search column and its configuration (supabase/migrations/*_web_search_dedupe.sql). */
const SEARCH_COLUMN = 'search_tsv';
const SEARCH_CONFIG = { config: 'simple', type: 'plain' } as const;

const itemsQuery = (client: SupabaseClient) => client.from(WEB_ITEMS_TABLE).select(WEB_ITEM_COLUMNS);
type ItemsQuery = ReturnType<typeof itemsQuery>;

/** What a search reads: its words (`searchText`) and its `from:` creators (`authorPattern`); either may be absent. */
type Search = { text: string | null; author: string | null; anyWord?: boolean; direction?: StreamDirection };
const NO_SEARCH: Search = { text: null, author: null };
/** VIBE: the words joined by `|` for to_tsquery. Each is letters and digits only (`searchText`), so none is syntax. */
const ANY_WORD_CONFIG = { config: 'simple' } as const;

/**
 * The stream, or a search of it: `searchText` (search.ts: letters, digits and spaces only) is passed as
 * the one value of a plainto_tsquery filter on `search_tsv`, never pasted into a filter string; a
 * `from:` is the one value of an `imatch` (case-blind regex) on `creator`, built from letters and digits.
 */
function stream(client: SupabaseClient, search: Search): () => ItemsQuery {
  return () => {
    let query = itemsQuery(client);
    if (search.text !== null && search.anyWord) query = query.textSearch(SEARCH_COLUMN, search.text.split(' ').join(' | '), ANY_WORD_CONFIG);
    else if (search.text !== null) query = query.textSearch(SEARCH_COLUMN, search.text, SEARCH_CONFIG);
    if (search.author !== null) query = query.regexIMatch('creator', search.author);
    return query;
  };
}

/**
 * One page of rows: the raw keyset page, then its copies on other platforms (dedupe.ts), merged with the media
 * servers' titles after the same cursor (media-merge.ts, SPEC-media-servers.md).
 */
async function listRows(getClient: GetClient, cursor: string | null | undefined, limit: unknown, search: Search): Promise<WebStreamPage> {
  const client = getClient();
  if (!client) throw new Error(READ_FAILED);
  const [stream, media] = await Promise.all([listStreamRows(client, cursor, limit, search), listMedia(client, cursor, limit, search)]);
  return mergeStreamPages(stream, media, limit, search.direction ?? 'desc');
}

const mediaQuery = (client: SupabaseClient) => client.from(WEB_MEDIA_TITLES_TABLE).select(WEB_MEDIA_COLUMNS);
type MediaQuery = ReturnType<typeof mediaQuery>;

/**
 * The media servers' titles after a cursor, in stream order: the same two keyset reads as the stream. A search is
 * every word in the title (`ilike`, the words letters and digits only, from `searchText`) and a `from:` the same
 * `imatch` on the creator. Readable by signed-in people only: for anyone else, or on any failure, this is an empty
 * page, so the stream itself still shows.
 */
async function listMedia(client: SupabaseClient, cursor: string | null | undefined, limit: unknown, search: Search): Promise<WebPage> {
  const size = clampLimit(limit);
  const base = (): MediaQuery => {
    let query = mediaQuery(client);
    // Every word in the title OR in the film series' name (so "star wars" finds the series whatever its films are
    // called). The one `.or()` string in WEB: each word is letters and digits only (`searchText`, checked again
    // here), so nothing typed can add a filter, a comma or a bracket to it.
    const words = search.text?.split(' ').filter((part) => /^[\p{L}\p{N}]+$/u.test(part)) ?? [];
    // VIBE: any one of the words, in one `.or()` (the same letters-and-digits words).
    if (search.anyWord && words.length > 0) query = query.or(words.map((word) => `title.ilike.*${word}*,${SERIES_NAME}.ilike.*${word}*`).join(','));
    else for (const word of words) {
      query = query.or(`title.ilike.*${word}*,${SERIES_NAME}.ilike.*${word}*`);
    }
    if (search.author !== null) query = query.regexIMatch('creator', search.author);
    return query;
  };
  const toItems = (data: unknown) => ((data ?? []) as unknown as WebMediaRow[]).flatMap((row) => {
    const item = mediaRowToItem(row);
    return item === null ? [] : [item];
  });
  const ascending = search.direction === 'asc';
  const readRaw = async (after: string | null): Promise<WebPage> => {
    if (after == null) {
      const { data, error } = await base().order('published_at', { ascending }).order('id', { ascending }).limit(size + 1);
      if (error) return { items: [], nextCursor: null };
      return assemblePage([], toItems(data), size);
    }
    const at = decodeCursor(after);
    if (!at) return { items: [], nextCursor: null };
    const [same, beyond] = await Promise.all([
      (ascending ? base().eq('published_at', at.publishedAt).gt('id', at.id) : base().eq('published_at', at.publishedAt).lt('id', at.id)).order('id', { ascending }).limit(size + 1),
      (ascending ? base().gt('published_at', at.publishedAt) : base().lt('published_at', at.publishedAt)).order('published_at', { ascending }).order('id', { ascending }).limit(size + 1),
    ]);
    if (same.error || beyond.error) return { items: [], nextCursor: null };
    return assemblePage(toItems(same.data), toItems(beyond.data), size);
  };
  // A film series' other films (media-collections.ts), under the same search: whole numbers only reach the filter.
  // Usually one read; a read that fills its limit (a long series crowding the others out) is redone one series at a
  // time with room for a whole series, so the FILM picker always holds every film of it (as dedupe's readCopies does).
  const readSiblings = async (collections: number[]): Promise<WebItem[]> => {
    const ids = collections.filter((id) => Number.isInteger(id) && id > 0).slice(0, MAX_COLLECTIONS);
    if (ids.length === 0) return [];
    const read = (query: MediaQuery, cap: number) => query.order('published_at', { ascending: false }).order('id', { ascending: false }).limit(cap);
    const together = await read(base().in('collection_id', ids), ids.length * FILMS_PER_COLLECTION);
    if (together.error) throw new Error(READ_FAILED);
    if ((together.data ?? []).length < ids.length * FILMS_PER_COLLECTION) return toItems(together.data);
    const each = await Promise.all(ids.map((id) => read(base().eq('collection_id', id), MAX_FILMS_IN_SERIES)));
    if (each.some((result) => result.error)) throw new Error(READ_FAILED);
    return each.flatMap((result) => toItems(result.data));
  };
  try {
    return await readMediaPage(readRaw, readSiblings, cursor ?? null);
  } catch {
    return { items: [], nextCursor: null };
  }
}

/** A page holds at most 50 rows, so at most 50 collections; a film series rarely has more than a few dozen films. */
const MAX_COLLECTIONS = 50;
const FILMS_PER_COLLECTION = 40;
/** The film series' name inside TMDB's details (media-titles.ts `MediaDetails.collection`). */
const SERIES_NAME = 'details->collection->>name';
/** One series read on its own: TMDB's longest collections are far shorter, so this is every film of it. */
const MAX_FILMS_IN_SERIES = 500;

function listStreamRows(client: SupabaseClient, cursor: string | null | undefined, limit: unknown, search: Search): Promise<WebStreamPage> {
  return readStreamPage(
    (at) => listItems(stream(client, search), at, limit, search.direction ?? 'desc'),
    async (keys) => {
      const safeKeys = keys.filter((key) => DEDUPE_KEY_SHAPE.test(key));
      if (safeKeys.length === 0) return { siblings: [], rivals: [] };
      const [siblings, rivals] = await Promise.all([
        readCopies(stream(client, NO_SEARCH), safeKeys),
        search === NO_SEARCH ? null : readCopies(stream(client, search), safeKeys),
      ]);
      return { siblings, rivals: rivals ?? siblings };
    },
    cursor ?? null,
  );
}

/**
 * Every copy of these fingerprints, up to `COPIES_PER_KEY` each. Usually one read; but one read has one
 * limit, and a fingerprint with many copies could crowd another's out of it, so a read that fills its
 * limit is redone one fingerprint at a time (at most one read per item on the page, all at once). Every
 * page then sees a group the same way, which is what keeps each copy on exactly one row.
 */
async function readCopies(base: () => ItemsQuery, keys: string[]): Promise<WebItem[]> {
  const read = (query: ItemsQuery, limit: number) =>
    query.order('published_at', { ascending: false }).order('id', { ascending: false }).limit(limit);
  const toItems = (data: unknown) => ((data ?? []) as unknown as WebItemRow[]).map(rowToItem);

  const limit = keys.length * COPIES_PER_KEY;
  const together = await read(base().in('dedupe_key', keys), limit);
  if (together.error) throw new Error(READ_FAILED);
  if ((together.data ?? []).length < limit) return toItems(together.data);

  const each = await Promise.all(keys.map((key) => read(base().eq('dedupe_key', key), COPIES_PER_KEY)));
  if (each.some((result) => result.error)) throw new Error(READ_FAILED);
  return each.flatMap((result) => toItems(result.data));
}

async function listItems(base: () => ItemsQuery, cursor: string | null | undefined, limit: unknown, direction: StreamDirection = 'desc'): Promise<WebPage> {
  const size = clampLimit(limit);
  const ascending = direction === 'asc';

  if (cursor == null) {
    const { data, error } = await base()
      .order('published_at', { ascending })
      .order('id', { ascending })
      .limit(size + 1);
    if (error) throw new Error(READ_FAILED);
    return assemblePage([], ((data ?? []) as unknown as WebItemRow[]).map(rowToItem), size);
  }

  const at = decodeCursor(cursor);
  if (!at) return { items: [], nextCursor: null };

  // Newest first: the rest of the cursor's moment (smaller ids), then older moments. Oldest first: the mirror image.
  const [same, older] = await Promise.all([
    (ascending ? base().eq('published_at', at.publishedAt).gt('id', at.id) : base().eq('published_at', at.publishedAt).lt('id', at.id))
      .order('id', { ascending })
      .limit(size + 1),
    (ascending ? base().gt('published_at', at.publishedAt) : base().lt('published_at', at.publishedAt))
      .order('published_at', { ascending })
      .order('id', { ascending })
      .limit(size + 1),
  ]);
  if (same.error || older.error) throw new Error(READ_FAILED);
  return assemblePage(
    ((same.data ?? []) as unknown as WebItemRow[]).map(rowToItem),
    ((older.data ?? []) as unknown as WebItemRow[]).map(rowToItem),
    size,
  );
}

export function createSupabaseWebRepository(getClient: GetClient): WebRepository {
  return {
    source: 'supabase',
    listItems({ cursor, limit }) {
      return listRows(getClient, cursor, limit, NO_SEARCH);
    },
    async searchItems({ query, from, cursor, limit, anyWord, oldestFirst }) {
      const text = searchText(query);
      const authors = authorList(from);
      if (text === null && authors === null) return { items: [], nextCursor: null };
      return listRows(getClient, cursor, limit, { text, author: authors === null ? null : authorPattern(authors), ...(anyWord ? { anyWord: true } : {}), ...(oldestFirst ? { direction: 'asc' as const } : {}) });
    },
    async listSources() {
      const client = getClient();
      if (!client) throw new Error(READ_FAILED);
      const { data, error } = await client
        .from(WEB_SOURCES_TABLE)
        .select(WEB_SOURCE_COLUMNS)
        .order('label', { ascending: true })
        .limit(MAX_SOURCES);
      if (error) throw new Error(READ_FAILED);
      return ((data ?? []) as unknown as WebSourceRow[]).map(rowToSource);
    },
    async getItem(id) {
      const client = getClient();
      if (!client) throw new Error(READ_FAILED);
      // Row Level Security hides a disabled row, so a hidden item reads as no row: gone, like a deleted one.
      const { data, error } = await client.from(WEB_ITEMS_TABLE).select(WEB_ITEM_COLUMNS).eq('id', id).limit(1);
      if (error) throw new Error(READ_FAILED);
      const row = ((data ?? []) as unknown as WebItemRow[])[0];
      return row === undefined ? null : rowToItem(row);
    },
    async getItemByExternal(platform, externalId) {
      const client = getClient();
      if (!client) throw new Error(READ_FAILED);
      const { data, error } = await client.from(WEB_ITEMS_TABLE).select(WEB_ITEM_COLUMNS).eq('platform', platform).eq('external_id', externalId).limit(1);
      if (error) throw new Error(READ_FAILED);
      const row = ((data ?? []) as unknown as WebItemRow[])[0];
      return row === undefined ? null : rowToItem(row);
    },
  };
}

let instance: WebRepository | null = null;

export function getSupabaseWebRepository(): WebRepository {
  instance ??= createSupabaseWebRepository(getSupabaseBrowserClient);
  return instance;
}
