import type { SupabaseClient } from '@supabase/supabase-js';
import { isWildcardServer, MEDIA_SERVERS, serverHost, type MediaServer, type MediaServerId } from './media-servers';
import { groupTitles, parseList, type MediaTitle } from './media-titles';
import { safeFetchJson, type FetchLike } from './safe-fetch';
import { buildUrl } from './urls';
import { fetchDetails, TmdbError, withTmdbToken } from './tmdb';
import type { MediaDetails } from './media-titles';

/**
 * The media servers' part of the hourly WEB update (SPEC-media-servers.md). Server only: the ingest route runs
 * it after the stream's sources.
 *
 * 1. Every server in media-servers.ts: one GET of its list file through `safe-fetch`, on that server's own host
 *    only (a list may be big: up to 16 MB). Read with `parseList`, folded with `groupTitles`, saved in batches
 *    of 500, then the server's run is finished, which drops what its list no longer has. A server that does not
 *    answer, or answers with something that is not a list, keeps everything it had: nothing is dropped.
 * 2. TMDB's details for up to 40 titles that have a TMDB number and were never asked (or not for 30 days), when
 *    `TMDB_READ_TOKEN` is set. Without it this step is skipped and titles show their list's words.
 *
 * Nothing of a server's or TMDB's answer reaches the result: it says which servers were read, how many titles,
 * and a fixed phrase for a failure.
 */

export const LIST_MAX_BYTES = 16 * 1024 * 1024;
export const LIST_TIMEOUT_MS = 15_000;
export const SAVE_BATCH = 500;
export const DETAILS_PER_RUN = 40;
const DETAILS_AT_ONCE = 5;
/** How long the media part may take before it stops starting new TMDB batches. */
export const MEDIA_BUDGET_MS = 20_000;

/** What the update writes through: the lock-checking database functions (or a stand-in in the check). */
export type MediaStore = {
  save(server: MediaServerId, run: string, titles: MediaTitleRow[]): Promise<void>;
  finish(server: MediaServerId, run: string): Promise<void>;
  needingDetails(limit: number): Promise<{ id: string; type: 'movie' | 'tv'; tmdbId: number }[]>;
  saveDetails(rows: { id: string; details: MediaDetails | null }[]): Promise<void>;
};

/** One title as `web_media_save` takes it: the title's words and this server's copy. */
export type MediaTitleRow = {
  id: string;
  media_type: string;
  tmdb_id: number | null;
  title: string;
  creator: string | null;
  description: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  released_at: string | null;
  local_id: string | null;
  episodes: [number, number][] | null;
};

export type MediaServerResult = { server: MediaServerId; titles: number; error: string | null };
export type MediaIngestResult = { servers: MediaServerResult[]; details: number; detailsError: string | null };

export function titleToRow(title: MediaTitle, server: MediaServerId): MediaTitleRow {
  const copy = title.copies.find((candidate) => candidate.server === server);
  return {
    id: title.id,
    media_type: title.type,
    tmdb_id: title.tmdbId ?? null,
    title: title.title,
    creator: title.creator ?? null,
    description: title.description ?? null,
    thumbnail_url: title.thumbnailUrl ?? null,
    duration_seconds: title.durationSeconds ?? null,
    released_at: title.date ?? null,
    local_id: copy?.localId ?? null,
    episodes: copy?.episodes ?? null,
  };
}

/** The list file's address: the server's own host and its fixed path, nothing from any data. */
export function listUrl(server: MediaServer): string {
  const segments = server.listPath.split('/').filter((part) => part.length > 0);
  return buildUrl(serverHost(server), segments);
}

async function readServer(server: MediaServer, store: MediaStore, fetchImpl: FetchLike, now: () => Date): Promise<MediaServerResult> {
  const id = server.id as MediaServerId;
  let body: unknown;
  try {
    body = await safeFetchJson(listUrl(server), { allowedHosts: [serverHost(server)], fetchImpl, timeoutMs: LIST_TIMEOUT_MS, maxBytes: LIST_MAX_BYTES });
  } catch {
    return { server: id, titles: 0, error: 'NOT ANSWERING' };
  }
  if (!Array.isArray(body)) return { server: id, titles: 0, error: 'NOT A LIST' };
  const run = now().toISOString();
  const titles = groupTitles(parseList(body, id, run));
  // An empty list, or one with nothing usable in it, is far more often a server mid-rebuild (a media drive not
  // mounted, a half-written file) than a library really emptied: it keeps everything, like a server not answering.
  if (titles.length === 0) return { server: id, titles: 0, error: body.length === 0 ? 'EMPTY LIST' : 'NOTHING USABLE' };
  try {
    for (let start = 0; start < titles.length; start += SAVE_BATCH) {
      await store.save(id, run, titles.slice(start, start + SAVE_BATCH).map((title) => titleToRow(title, id)));
    }
    await store.finish(id, run);
  } catch {
    return { server: id, titles: 0, error: 'COULD NOT SAVE' };
  }
  return { server: id, titles: titles.length, error: null };
}

export async function runMediaIngest(
  store: MediaStore,
  deps: { fetch?: FetchLike; now?: () => Date; tmdbToken?: string; servers?: readonly MediaServer[]; budgetMs?: number } = {},
): Promise<MediaIngestResult> {
  const began = Date.now();
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());
  // A server with no list file (`listPath: '*'`) has nothing to read: its titles come from a search (wildcard-search.ts).
  const listed = (deps.servers ?? MEDIA_SERVERS).filter((server) => !isWildcardServer(server));
  const servers = await Promise.all(listed.map((server) => readServer(server, store, fetchImpl, now)));

  const token = (deps.tmdbToken ?? '').trim();
  if (token.length === 0) return { servers, details: 0, detailsError: 'NOT SET UP' };

  let waiting: Awaited<ReturnType<MediaStore['needingDetails']>>;
  try {
    waiting = await store.needingDetails(DETAILS_PER_RUN);
  } catch {
    return { servers, details: 0, detailsError: 'COULD NOT READ' };
  }
  const tmdbFetch = withTmdbToken(token, fetchImpl);
  const answers: { id: string; details: MediaDetails | null }[] = [];
  let failed = false;
  for (let start = 0; start < waiting.length; start += DETAILS_AT_ONCE) {
    // The route has 60 seconds in all; titles not reached wait for the next hour.
    if (Date.now() - began > (deps.budgetMs ?? MEDIA_BUDGET_MS)) break;
    const slice = waiting.slice(start, start + DETAILS_AT_ONCE);
    const results = await Promise.all(
      slice.map(async (title) => {
        try {
          return { id: title.id, details: await fetchDetails(title.type, title.tmdbId, tmdbFetch) };
        } catch (error) {
          if (error instanceof TmdbError) failed = true;
          return null;
        }
      }),
    );
    for (const result of results) if (result !== null) answers.push(result);
  }
  try {
    if (answers.length > 0) await store.saveDetails(answers);
  } catch {
    return { servers, details: 0, detailsError: 'COULD NOT SAVE' };
  }
  return { servers, details: answers.length, detailsError: failed ? 'SOME NOT ANSWERED' : null };
}

/** The store over the lock-checking database functions (supabase/migrations/*_web_media.sql). */
export function makeMediaStore(db: SupabaseClient, lock: string): MediaStore {
  return {
    async save(server, run, titles) {
      const { error } = await db.rpc('web_media_save', { p_secret: lock, p_server: server, p_run: run, p_titles: titles });
      if (error) throw new Error('save failed');
    },
    async finish(server, run) {
      const { error } = await db.rpc('web_media_finish', { p_secret: lock, p_server: server, p_run: run });
      if (error) throw new Error('finish failed');
    },
    async needingDetails(limit) {
      const { data, error } = await db.rpc('web_media_needing_details', { p_secret: lock, p_limit: limit });
      if (error) throw new Error('read failed');
      return ((data ?? []) as { id: string; media_type: string; tmdb_id: number }[]).flatMap((row) =>
        (row.media_type === 'movie' || row.media_type === 'tv') && Number.isInteger(row.tmdb_id) ? [{ id: row.id, type: row.media_type, tmdbId: row.tmdb_id }] : [],
      );
    },
    async saveDetails(rows) {
      const { error } = await db.rpc('web_media_save_details', { p_secret: lock, p_rows: rows });
      if (error) throw new Error('save failed');
    },
  };
}
