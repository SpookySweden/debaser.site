import { createClient } from '@supabase/supabase-js';
import { WEB_ADAPTERS } from '../../../lib/web/adapters';
import { IngestLockError, makeIngestStore, runIngest } from '../../../lib/web/ingest';
import { makeMediaStore, runMediaIngest } from '../../../lib/web/media-ingest';
import { FETCH_ONE_PROVIDERS } from '../../../lib/web/search/index';

/**
 * WEB's ingest (SPEC-web.md): reads each enabled `web_sources` row through its adapter and saves what it
 * finds into `web_items`. Called once an hour by pg_cron + pg_net, which sends the lock in a header:
 *
 *   POST /api/web/ingest   header  x-web-ingest-secret: <the lock>   ->  { checked, results }
 *
 * This route holds no secret and no server key (Luke, 2026-10-31). The lock is a random value the
 * database made for itself and keeps in Supabase Vault; the route only hands what it was sent to the three
 * lock-checking database functions (supabase/migrations/20261031190000_web_ingest_lock.sql), through the
 * public-key client. A wrong lock is refused there (401 here); a header too short to be the lock is refused
 * before the database is asked at all.
 *
 * POST only: Next answers 405 to every method this file does not export. The work itself, and its rules
 * (a cap per run, one failure never stopping the others, plain-words errors), live in `lib/web/ingest.ts`.
 *
 * Saving opened items (SPEC-web-search.md): when `NEXT_PUBLIC_WEB_SAVE_OPENED` is `on` - set only once the
 * `web_requests` migration is pushed - the run also saves up to five items people opened from a search
 * everywhere, through two more lock-checking functions (supabase/migrations/*_web_requests.sql). It reads the
 * server-only `YOUTUBE_API_KEY` for those (one videos.list each); without it YouTube items come from oEmbed.
 * The key never reaches an answer: the results carry request ids and outcomes only.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Sources run one after another, each fetch capped at 10s; a run is at most five of them. */
export const maxDuration = 60;

const LOCK_HEADER = 'x-web-ingest-secret';
/** The database's lock is 64 hex characters; anything outside these bounds is not worth a database call. */
const MIN_LOCK_LENGTH = 32;
const MAX_LOCK_LENGTH = 200;

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: Request): Promise<Response> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!supabaseUrl || !publicKey) {
    return json({ error: 'The WEB ingest is not set up on this server.' }, 503);
  }
  const lock = request.headers.get(LOCK_HEADER) ?? '';
  if (lock.length < MIN_LOCK_LENGTH || lock.length > MAX_LOCK_LENGTH) {
    return json({ error: 'Not allowed.' }, 401);
  }

  const db = createClient(supabaseUrl, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const resolving =
      process.env.NEXT_PUBLIC_WEB_SAVE_OPENED === 'on'
        ? { providers: FETCH_ONE_PROVIDERS, env: { YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY } }
        : null;
    // The media servers' lists and TMDB's details (SPEC-media-servers.md) alongside the stream's sources, so the
    // two together stay inside maxDuration. TMDB_READ_TOKEN is server-only; it never reaches an answer.
    const [result, media] = await Promise.all([
      runIngest(makeIngestStore(db, lock), WEB_ADAPTERS, {}, resolving),
      runMediaIngest(makeMediaStore(db, lock), { tmdbToken: process.env.TMDB_READ_TOKEN }),
    ]);
    // YOUR YOUTUBE's account copies not refreshed for 30 days go (YouTube's terms; Luke's OK 2026-11-13,
    // 20261113173009_youtube_taste.sql). Lock-checked like the rest; a failure here never fails the run.
    const forgot = await db.rpc('web_forget_old_youtube_taste', { p_secret: lock });
    const youtubeTasteForgotten = forgot.error === null && typeof forgot.data === 'number' ? forgot.data : null;
    // FOR YOU's history rows untouched for 90 days go (Luke's OK 2026-11-13, 20261113210656_user_history.sql), the same way.
    const old = await db.rpc('web_forget_old_history', { p_secret: lock });
    const historyForgotten = old.error === null && typeof old.data === 'number' ? old.data : null;
    return json({ ...result, media, youtubeTasteForgotten, historyForgotten }, 200);
  } catch (error) {
    if (error instanceof IngestLockError) return json({ error: 'Not allowed.' }, 401);
    return json({ error: 'The WEB sources could not be read.' }, 500);
  }
}
