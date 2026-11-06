import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { cachedFetch } from '../../../lib/web/search/cached-fetch';
import { peertubeHosts } from '../../../lib/web/search/peertube-index';
import { makeSweepStore, readSources, runSweep } from '../../../lib/web/sweep';

/**
 * The catalogue sweep (lib/web/sweep.ts; SPEC-discover.md). Called every two minutes by pg_cron + pg_net with the same lock as the ingest:
 * the database made it and keeps it in Vault.
 *
 *   POST /api/web/sweep   header  x-web-ingest-secret: <the lock>   ->  { collected, sent, waiting, inputTokens, outputTokens, read, stopped, busy }
 *
 * ANTHROPIC_API_KEY is a server-only setting in Vercel. Without it the route does nothing and says so. The key never reaches an answer.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 240;

const LOCK_HEADER = 'x-web-ingest-secret';
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
  if (!supabaseUrl || !publicKey) return json({ error: 'The sweep is not set up on this server.' }, 503);

  const lock = request.headers.get(LOCK_HEADER) ?? '';
  if (lock.length < MIN_LOCK_LENGTH || lock.length > MAX_LOCK_LENGTH) return json({ error: 'Not allowed.' }, 401);
  if (!process.env.ANTHROPIC_API_KEY) return json({ skipped: 'no key set' }, 200);

  // The lock as a header too: the pool's file bucket checks it from there.
  const db = createClient(supabaseUrl, publicKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { [LOCK_HEADER]: lock } } });
  try {
    const hosts = await peertubeHosts(cachedFetch);
    // Plain fetch, not the day-long cache: a sweep's whole point is the next page, and its answers aren't worth keeping.
    return json(await runSweep(new Anthropic(), makeSweepStore(db, lock), (state, deadline) => readSources(state, deadline, { peertubeHosts: hosts })), 200);
  } catch (error) {
    if (error instanceof Error && error.message === 'TAGGING_DATABASE') return json({ error: 'Not allowed, or the database could not be read.', failed: (error as Error & { failed?: string }).failed }, 401);
    // Never an error's message or stack: a bad header's message repeats the key. Claude's own status and type say what went wrong.
    const reason = error instanceof Anthropic.APIError ? `claude ${error.status ?? 'no status'} ${error.type ?? 'unknown'}` : error instanceof Error ? error.name : 'unknown';
    return json({ error: 'The sweep could not run.', reason }, 500);
  }
}
