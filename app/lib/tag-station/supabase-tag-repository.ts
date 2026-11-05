import type { SupabaseClient } from '@supabase/supabase-js';
import { rowToItem, WEB_ITEM_COLUMNS, WEB_ITEMS_TABLE, type WebItemRow } from '../web/rows';
import type { TagStationRepository } from './repository';
import type { StationRow } from './types';

/**
 * TAG STATION's read of the live data: `web_items` with each item's row from `web_item_tags`, in one query. Reads only, and
 * nothing is added to the database (SPEC-tag-station.md).
 *
 * The client carries the reader's own session token (`getTagRepository`): `web_item_tags` can be read by signed-in people
 * only, and Row Level Security shows only enabled items. A read that fails throws; the route says so in plain words.
 */

/** PostgREST's own cap on one answer. Newest first, so past this the oldest items drop off the map. */
export const MAX_ITEMS = 1000;

type RowWithWords = WebItemRow & { web_item_tags: { words: string[] | null } | { words: string[] | null }[] | null };

export function createSupabaseTagRepository(client: SupabaseClient): TagStationRepository {
  return {
    source: 'supabase',
    async rows(): Promise<StationRow[]> {
      const { data, error } = await client
        .from(WEB_ITEMS_TABLE)
        .select(`${WEB_ITEM_COLUMNS}, web_item_tags(words)`)
        .order('published_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(MAX_ITEMS);
      if (error) throw new Error('The words could not be read.');
      return ((data ?? []) as unknown as RowWithWords[]).map((row) => {
        const { web_item_tags: tags, ...itemRow } = row;
        // One row per item, which PostgREST sends as an object; a list is handled too, in case it ever sends that.
        const held = Array.isArray(tags) ? tags[0] : tags;
        return { item: rowToItem(itemRow), claudeWords: held?.words ?? [] };
      });
    },
  };
}
