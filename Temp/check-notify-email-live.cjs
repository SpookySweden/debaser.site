/*
 * SPEC-notifications.md phase 2 on the live site (20261120110000_notifications_weekly_email.sql): the weekly email's
 * locks, asked from outside. Every probe is a refusal, so nothing is sent and nothing changes: the email route refuses a
 * caller without the database's lock, the database refuses its weekly list and its "sent" mark to a browser, and the
 * unsubscribe answers a code that belongs to nobody without touching anybody's switch. A bare GET changes nothing.
 *   node Temp/check-notify-email-live.cjs
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

if (!fs.existsSync(path.join(__dirname, '..', '.env.local'))) {
  console.log('  skip  no .env.local: the live probe needs the database address');
  process.exit(0);
}
const { loadEnv } = require('../scripts/browser.cjs');
const SITE = 'https://debaser.site';

(async () => {
  loadEnv();
  const noLock = await fetch(`${SITE}/api/notify/digest`, { method: 'POST', body: '{}' });
  assert.equal(noLock.status, 401, 'no lock: refused');
  const wrongLock = await fetch(`${SITE}/api/notify/digest`, { method: 'POST', headers: { 'x-notify-digest-secret': 'x'.repeat(64) }, body: '{}' });
  assert.ok([200, 401].includes(wrongLock.status), `a wrong lock sends nothing (${wrongLock.status})`);
  const wrongBody = await wrongLock.json().catch(() => ({}));
  assert.ok(wrongLock.status === 401 || (wrongBody.sent ?? 0) === 0, 'outside the window or refused: nothing sent');

  const { createClient } = require('@supabase/supabase-js');
  const visitor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const due = await visitor.rpc('notify_digest_due', { p_secret: 'x'.repeat(64), p_week_start: new Date().toISOString() });
  assert.notEqual(due.error, null, 'the weekly list is refused without the lock');
  const sent = await visitor.rpc('notify_digest_sent', { p_secret: 'x'.repeat(64), p_person: '00000000-0000-0000-0000-000000000000' });
  assert.notEqual(sent.error, null, "nobody's week can be marked sent without the lock");

  const nobody = await fetch(`${SITE}/api/notify/unsubscribe?t=00000000-0000-4000-8000-000000000000`, { method: 'POST' });
  assert.equal(nobody.status, 404, 'a code that belongs to nobody changes nothing');
  const malformed = await fetch(`${SITE}/api/notify/unsubscribe?t=not-a-code`, { method: 'POST' });
  assert.equal(malformed.status, 400);
  const bare = await fetch(`${SITE}/api/notify/unsubscribe?t=00000000-0000-4000-8000-000000000000`);
  assert.equal(bare.status, 405, 'a bare GET (a mail scanner) changes nothing');

  console.log('check-notify-email-live: OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
