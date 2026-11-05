import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { makeTaggingStore, runTagging } from '../../../lib/web/tagging';

/**
 * Claude's words for MEDIA's saved items (lib/web/tagging.ts). Called every three hours by pg_cron + pg_net with the same lock
 * as the ingest (20261031190000_web_ingest_lock.sql): the database made it and keeps it in Vault.
 *
 *   POST /api/web/tag   header  x-web-ingest-secret: <the lock>   ->  { collected, sent, waiting, inputTokens, outputTokens }
 *
 * ANTHROPIC_API_KEY is a server-only setting in Vercel. Without it the route does nothing and says so, so the page still
 * orders its list by the platforms' own tags. The key never reaches an answer.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
  if (!supabaseUrl || !publicKey) return json({ error: 'The tagging is not set up on this server.' }, 503);

  const lock = request.headers.get(LOCK_HEADER) ?? '';
  if (lock.length < MIN_LOCK_LENGTH || lock.length > MAX_LOCK_LENGTH) return json({ error: 'Not allowed.' }, 401);
  if (!process.env.ANTHROPIC_API_KEY) return json({ skipped: 'no key set' }, 200);

  const db = createClient(supabaseUrl, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    return json(await runTagging(new Anthropic(), makeTaggingStore(db, lock)), 200);
  } catch (error) {
    if (error instanceof Error && error.message === 'TAGGING_DATABASE') return json({ error: 'Not allowed, or the database could not be read.' }, 401);
    // Only the lock's holder reads this, in the cron's saved answers. Claude's own status and error type say what went
    // wrong; any other error is named but its message is dropped, since a bad header's message can repeat the key.
    const said = error instanceof Anthropic.APIError && error.status === 400 ? ` ${(error.apiMessage ?? '').replace(/sk-ant-\S+/g, '[key]').slice(0, 160)}` : '';
    const reason = error instanceof Anthropic.APIError ? `claude ${error.status ?? 'no status'} ${error.type ?? 'unknown'}${said}` : error instanceof Error ? error.name : 'unknown';
    // Yes or no only, nothing of the key: a stray character in a pasted key is a TypeError before anything is sent.
    const keyPlain = /^[\x21-\x7e]+$/.test(process.env.ANTHROPIC_API_KEY ?? '');
    // Never an error's message or stack: a bad header's message repeats the key, and can run over several lines of a stack.
    return json({ error: 'The tagging could not run.', reason, keyPlain }, 500);
  }
}
