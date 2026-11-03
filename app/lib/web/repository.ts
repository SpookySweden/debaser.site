import { isSupabaseConfigured } from '../supabase/client';
import type { WebStreamPage } from './dedupe';
import { getMockWebRepository } from './mock-web-repository';
import { getSupabaseWebRepository } from './supabase-web-repository';
import type { WebItem, WebPlatform, WebSource } from './types';

/**
 * Where /web reads its stream from, by the same switch as the other features. Default is the mock, so the
 * site runs with no backend. Once the `web_items` migration is pushed and the ingest has run, set
 *
 *   NEXT_PUBLIC_WEB_DATA_SOURCE=supabase
 *
 * in `.env.local` (and in Vercel or `.env.production`) to read the `web_items` / `web_sources` tables.
 */
export type WebDataSource = 'mock' | 'supabase';

export const WEB_DATA_SOURCE: WebDataSource =
  process.env.NEXT_PUBLIC_WEB_DATA_SOURCE === 'supabase' && isSupabaseConfigured ? 'supabase' : 'mock';

export type ListWebItemsInput = {
  /** Opaque, from a previous page's `nextCursor`. Omitted for the first page. */
  cursor?: string | null;
  limit?: number;
};

export type SearchWebItemsInput = ListWebItemsInput & {
  /** What the reader typed. Only its words are used (`searchWords` in search.ts); none means no results. */
  query: string;
  /** `from:` creators (search.ts `authorList`): only their items, either of them. Words, a creator, or both. */
  from?: readonly string[];
  /** VIBE (search-intent.ts): an item matches with ANY of the words rather than all of them. */
  anyWord?: boolean;
  /** DATE oldest first (SPEC-web-sort.md): `published_at` then `id` ascending. Absent: newest first, as ever. */
  oldestFirst?: boolean;
};

/**
 * Reads only. Ingest (fetching from platforms) is server-side and never goes through this.
 *
 * Both lists are rows (`WebStreamItem`): copies of one work on several platforms come back as one row with
 * the others in `alsoOn` (dedupe.ts). Searching keeps the same order and the same cursors.
 */
export type WebRepository = {
  readonly source: WebDataSource;
  listItems(input: ListWebItemsInput): Promise<WebStreamPage>;
  searchItems(input: SearchWebItemsInput): Promise<WebStreamPage>;
  listSources(): Promise<WebSource[]>;
  /**
   * One item by `web_items.id`, for a forum thread filed under it (app/lib/web/bridges.ts). Null when it
   * is hidden or gone; throws when the read itself fails, which a thread must not take for "gone".
   */
  getItem(id: string): Promise<WebItem | null>;
  /**
   * One item by its platform and the platform's own id, for a song's cover card in a room (SPEC-music-queues.md):
   * a WEB audio track names only those. Null when it is not in the stream (never saved, hidden or gone).
   */
  getItemByExternal(platform: WebPlatform, externalId: string): Promise<WebItem | null>;
};

export function getWebRepository(): WebRepository {
  return WEB_DATA_SOURCE === 'supabase' ? getSupabaseWebRepository() : getMockWebRepository();
}
