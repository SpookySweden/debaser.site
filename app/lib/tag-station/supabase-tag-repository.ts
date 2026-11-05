import type { SupabaseClient } from '@supabase/supabase-js';
import { canonicalIso, rowToItem, WEB_ITEM_COLUMNS, WEB_ITEMS_TABLE, type WebItemRow } from '../web/rows';
import type { WebItem } from '../web/types';
import type { TagStationRepository } from './repository';
import type { StationRow } from './types';
import { FACETS, type Facet, type WordFact } from './word-facts';

/**
 * TAG STATION's read of the live data: `web_items` with each item's row from `web_item_tags`, and the tagged results nobody saved
 * from `web_seen_items` (SPEC-tag-station.md). Reads only.
 *
 * The client carries the reader's own session token (`getTagRepository`): `web_item_tags` can be read by signed-in people
 * only, and Row Level Security shows only enabled items. A read that fails throws; the route says so in plain words.
 */

/** PostgREST's own cap on one answer. Newest first, so past this the oldest items drop off the map. */
export const MAX_ITEMS = 1000;

type RowWithWords = WebItemRow & { web_item_tags: { words: string[] | null } | { words: string[] | null }[] | null };

/** The columns of a seen row anyone may read (supabase/migrations/*_web_seen_items.sql). */
const SEEN_COLUMNS = 'id, platform, kind, title, creator, published_at, words';
const KINDS: readonly WebItem['kind'][] = ['audio', 'video', 'image', 'text', 'other'];

type SeenRow = { id: string; platform: string; kind: string | null; title: string | null; creator: string | null; published_at: string | null; words: string[] | null };

/** A seen result as a row of the map: its words and name, and no address, because it was never saved. */
function seenToRow(row: SeenRow): StationRow {
  return {
    item: {
      id: row.id,
      platform: row.platform as WebItem['platform'],
      externalId: row.id.slice(row.platform.length + 1),
      kind: KINDS.includes(row.kind as WebItem['kind']) ? (row.kind as WebItem['kind']) : 'other',
      url: '',
      canonicalUrl: '',
      title: row.title ?? row.id,
      ...(row.creator ? { creator: row.creator } : {}),
      publishedAt: row.published_at ? canonicalIso(row.published_at) : '',
      fetchedAt: '',
    },
    claudeWords: row.words ?? [],
    seenOnly: true,
  };
}

export function createSupabaseTagRepository(client: SupabaseClient): TagStationRepository {
  return {
    source: 'supabase',
    async rows(): Promise<StationRow[]> {
      const [saved, seen] = await Promise.all([
        client
          .from(WEB_ITEMS_TABLE)
          .select(`${WEB_ITEM_COLUMNS}, web_item_tags(words)`)
          .order('published_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(MAX_ITEMS),
        client.from('web_seen_items').select(SEEN_COLUMNS).neq('words', '{}').order('published_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false }).limit(MAX_ITEMS),
      ]);
      if (saved.error || seen.error) throw new Error('The words could not be read.');
      const savedRows = ((saved.data ?? []) as unknown as RowWithWords[]).map((row): StationRow => {
        const { web_item_tags: tags, ...itemRow } = row;
        // One row per item, which PostgREST sends as an object; a list is handled too, in case it ever sends that.
        const held = Array.isArray(tags) ? tags[0] : tags;
        return { item: rowToItem(itemRow), claudeWords: held?.words ?? [] };
      });
      // A result saved since is the saved item, with its own words.
      const savedIds = new Set(savedRows.map((row) => row.item.id));
      const seenRows = ((seen.data ?? []) as unknown as SeenRow[]).filter((row) => !savedIds.has(row.id)).map(seenToRow);
      return [...savedRows, ...seenRows];
    },
    async wordFacts(): Promise<WordFact[]> {
      // PostgREST's cap is 1,000 rows an answer, so a fixed few pages; a failed page is only fewer answers, and the map still draws.
      const pages = await Promise.all(
        [0, 1, 2, 3, 4].map((page) =>
          client
            .from('web_word_facts')
            .select('word, facet, same_as, vague')
            .not('facet', 'is', null)
            .order('word')
            .range(page * MAX_ITEMS, (page + 1) * MAX_ITEMS - 1),
        ),
      );
      return pages.flatMap(({ data, error }) => (error ? [] : ((data ?? []) as { word: string; facet: string | null; same_as: string | null; vague: boolean | null }[]))).map((row) => ({
        word: row.word,
        facet: FACETS.includes(row.facet as Facet) ? (row.facet as Facet) : null,
        sameAs: row.same_as,
        vague: row.vague === true,
      }));
    },
    async limitReached(): Promise<boolean> {
      const { data, error } = await client.rpc('web_tag_limit_reached');
      return error === null && data === true;
    },
  };
}
