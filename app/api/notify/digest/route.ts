import { createClient } from '@supabase/supabase-js';
import { buildDigests, digestWindow, DIGEST_FROM, renderDigest, type DigestRow } from '../../../lib/notifications/digest';

/**
 * The weekly email (SPEC-notifications.md, phase 2), called by the database's timer every hour on Sundays and Mondays
 * (20261120110000_notifications_weekly_email.sql) with the lock in a header:
 *
 *   POST /api/notify/digest   header x-notify-digest-secret: <the lock>   ->  { owed, sent, failed }
 *
 * Like the MEDIA fetch, this route holds no database key: the lock is the database's own (in its vault), and the
 * database checks it in every call. The one key here is Resend's (`RESEND_API_KEY`, which Luke put in the PC's settings
 * himself). It sends only between Sunday 18:00 and Monday 18:00 UK time, one email a person a week, only to people who
 * asked for it and have something unread, never to test, hidden or banned accounts or stream guests (the database
 * leaves them out). A test run (`{ "test": true, "person": "<id>" }`) sends that one person's email now, whatever the
 * day, and doesn't count as their week's.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LOCK_HEADER = 'x-notify-digest-secret';
const MIN_LOCK_LENGTH = 32;
const MAX_LOCK_LENGTH = 200;
/** Resend's free plan takes two sends a second. */
const SEND_GAP_MS = 600;
/** Stop starting new sends with this long left of the minute; the rest go next hour (they aren't marked sent). */
const STOP_AFTER_MS = 45_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(request: Request): Promise<Response> {
  const started = Date.now();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!supabaseUrl || !publicKey) return json({ error: 'The weekly email is not set up on this server.' }, 503);

  const lock = request.headers.get(LOCK_HEADER) ?? '';
  if (lock.length < MIN_LOCK_LENGTH || lock.length > MAX_LOCK_LENGTH) return json({ error: 'Not allowed.' }, 401);

  const body = (await request.json().catch(() => ({}))) as { test?: unknown; person?: unknown };
  const testPerson = body.test === true && typeof body.person === 'string' && UUID.test(body.person) ? body.person : null;

  const window = testPerson === null ? digestWindow(new Date()) : { weekStart: new Date() };
  if (window === null) return json({ owed: 0, sent: 0, failed: 0, note: 'outside the send window' }, 200);

  const apiKey = process.env.RESEND_API_KEY ?? '';
  if (!apiKey) return json({ error: 'The weekly email has no Resend key on this server.' }, 503);

  const db = createClient(supabaseUrl, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const due = await db.rpc('notify_digest_due', { p_secret: lock, p_week_start: window.weekStart.toISOString() });
  if (due.error !== null) return json({ error: due.error.code === '42501' ? 'Not allowed.' : 'The list could not be read.' }, due.error.code === '42501' ? 401 : 500);

  const rows = ((due.data ?? []) as DigestRow[]).filter((row) => testPerson === null || row.person === testPerson);
  const digests = buildDigests(rows);

  let sent = 0;
  let failed = 0;
  for (const digest of digests) {
    if (Date.now() - started > STOP_AFTER_MS) break;
    const email = renderDigest(digest);
    const answer = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: DIGEST_FROM, to: [digest.email], subject: email.subject, text: email.text, html: email.html, headers: email.headers }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);

    if (answer !== null && answer.ok) {
      sent += 1;
      if (testPerson === null) await db.rpc('notify_digest_sent', { p_secret: lock, p_person: digest.person });
    } else {
      failed += 1;
      // The reason only, never the address or the key: a log line someone else might read.
      console.warn('weekly email: Resend refused a send', answer === null ? 'no answer' : answer.status);
    }
    await sleep(SEND_GAP_MS);
  }

  return json({ owed: digests.length, sent, failed, test: testPerson !== null }, 200);
}
