import { getSupabaseBrowserClient } from '../supabase/client';
import { WEB_DATA_SOURCE } from './repository';
import type { WebItem } from './types';

/**
 * Saving opened items (SPEC-web-search.md, Luke's choice): an EVERYWHERE result someone PLAYs, DISCUSSes or
 * WATCHes is saved into the stream by the hourly ingest, so it can carry a forum thread long-term.
 *
 * The browser sends no item data: only a request naming (platform, external id), through the database
 * function `web_request_add` (signed-in people only, a daily cap each; supabase/migrations/*_web_requests.sql).
 * The ingest then reads the item from the platform's own API and saves it.
 *
 * **The switch.** It is on with `NEXT_PUBLIC_WEB_SAVE_OPENED=on` (with the Supabase data source): set in
 * .env.production since the migration was pushed (Luke's OK, 2026-10-31). While off, nothing is sent, and
 * DISCUSS is not offered on EVERYWHERE results: a thread filed under an item that never reaches the stream
 * would say "ITEM GONE" for ever. The mock data source has no ingest, so it never records anything.
 */
export const SAVE_OPENED = process.env.NEXT_PUBLIC_WEB_SAVE_OPENED === 'on' && WEB_DATA_SOURCE === 'supabase';

const ID = /^[a-z][a-z0-9_]{0,40}$/;
const EXTERNAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
/** Each item is asked for once per page load; the database ignores repeats anyway. */
const asked = new Set<string>();

/** Records that someone opened this result. Never throws: a failed request only means it is not saved. */
export async function recordOpened(item: Pick<WebItem, 'id' | 'platform' | 'externalId'>): Promise<void> {
  if (!SAVE_OPENED || asked.has(item.id) || !ID.test(item.platform) || !EXTERNAL_ID.test(item.externalId)) return;
  const db = getSupabaseBrowserClient();
  if (db === null) return;
  try {
    const { data } = await db.auth.getSession();
    if (!data.session) return;
    asked.add(item.id);
    await db.rpc('web_request_add', { p_platform: item.platform, p_external_id: item.externalId });
  } catch {
    // Not saved; nothing the reader needs to know.
  }
}
