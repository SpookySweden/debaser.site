/*
 * SPEC-notifications.md phase 2: the weekly email's rules. When it goes (Sunday 18:00 to Monday 18:00 UK time, winter and
 * summer), what is in it (5 lines a kind, AND N MORE, a reply and a tag one section, links to the site), what never is
 * (anybody's words; anything for a week with nothing waiting), the unsubscribe in every email, and names made safe.
 * The database side (who is left out, the lock) is read from the migration for its shape.
 *   npx tsc app/lib/notifications/digest.ts --rootDir app --outDir Temp/notify-digest-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   node Temp/check-notify-digest.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.window = { localStorage: { getItem: () => null, setItem() {} }, addEventListener() {}, removeEventListener() {} };
const d = require(path.join(__dirname, 'notify-digest-out', 'lib', 'notifications', 'digest.js'));

/* When ------------------------------------------------------------------------------------------------------------------ */
const at = (iso) => d.digestWindow(new Date(iso));
// Winter (GMT): 22 November 2026 is a Sunday.
assert.equal(at('2026-11-22T17:59:00Z'), null, 'Sunday 17:59 UK: not yet');
assert.equal(at('2026-11-22T18:00:00Z').weekStart.toISOString(), '2026-11-22T18:00:00.000Z', 'Sunday 18:00 UK: the week starts');
assert.equal(at('2026-11-23T17:59:00Z').weekStart.toISOString(), '2026-11-22T18:00:00.000Z', 'Monday 17:59: the PC was off, still this week');
assert.equal(at('2026-11-23T18:00:00Z'), null, 'Monday 18:00: the week is skipped');
assert.equal(at('2026-11-24T10:00:00Z'), null, 'Tuesday: never');
assert.equal(at('2026-11-21T19:00:00Z'), null, 'Saturday: never');
// Summer (BST, an hour ahead): 21 June 2026 is a Sunday; 18:00 UK is 17:00 UTC.
assert.equal(at('2026-06-21T16:59:00Z'), null, 'summer Sunday 17:59 UK: not yet');
assert.equal(at('2026-06-21T17:00:00Z').weekStart.toISOString(), '2026-06-21T17:00:00.000Z', 'summer Sunday 18:00 UK');
assert.equal(at('2026-06-22T16:30:00Z').weekStart.toISOString(), '2026-06-21T17:00:00.000Z', 'summer Monday 17:30 UK');
assert.equal(at('2026-06-22T17:00:00Z'), null, 'summer Monday 18:00 UK: skipped');

/* What ------------------------------------------------------------------------------------------------------------------ */
const row = (over) => ({
  person: 'p1', email: 'reader@example.com', unsubscribe_code: '11111111-2222-3333-4444-555555555555', kind: 'reply',
  actor_name: 'ALEX', thread_title: 'Panel thumbnails', thread_id: 'aaaaaaaa-0000-0000-0000-000000000001', recommendation_id: null,
  invite_id: null, room_id: null, href: null, created_at: '2026-11-20T10:00:00Z', kind_total: 1, ...over,
});
assert.deepEqual(d.buildDigests([]), [], 'nothing waiting: no email');

const replies = Array.from({ length: 5 }, (_, i) => row({ created_at: `2026-11-20T1${i}:00:00Z`, kind_total: 7 }));
const rows = [
  ...replies,
  row({ kind: 'tag', actor_name: 'BEA', kind_total: 2, created_at: '2026-11-19T09:00:00Z' }),
  row({ kind: 'letter', actor_name: 'CAL', thread_title: 'SUMMER SCRAPS', recommendation_id: 'rec-1', thread_id: null }),
  row({ kind: 'comic', actor_name: 'DEBASER', thread_title: '5 NEW PAGES IN CHAPTER 3', href: '/comic/3/12', thread_id: null }),
  row({ kind: 'live', actor_name: '<script>x</script>', thread_title: 'LATE & LOUD', room_id: 'room-9', thread_id: null }),
  row({ kind: 'nonsense' }),
  row({ kind: 'invite', actor_name: 'EVE', thread_title: 'CHESS\nCLICK HERE: https://example.com', invite_id: 'inv-1', thread_id: null }),
];
const [one, ...others] = d.buildDigests(rows);
assert.equal(others.length, 0, 'one email per person');
const replySection = one.sections.find((s) => s.label === 'REPLIES AND TAGS');
assert.equal(replySection.lines.length, 5, 'at most 5 lines a section');
assert.equal(replySection.more, 4, 'a reply and a tag are one section: 7 replies + 2 tags, 5 shown, AND 4 MORE');
assert.deepEqual(one.sections.map((s) => s.label), ['REPLIES AND TAGS', 'LETTERS', 'ROOMS THAT WENT LIVE', 'COMIC', 'GAME INVITES'], 'a fixed order; an unknown kind is left out');
assert.doesNotMatch(one.sections[4].lines[0].text, /\n/, 'a title typed with a line break stays one line: nobody writes extra lines into an email');
assert.equal(one.sections[1].lines[0].text, 'CAL SENT YOU A LETTER "SUMMER SCRAPS"');
assert.equal(one.sections[1].lines[0].url, 'https://debaser.site/recommendations?open=rec-1', 'a line is a link to the site');
assert.equal(one.sections[3].lines[0].url, 'https://debaser.site/comic/3/12');

const email = d.renderDigest(one);
assert.match(email.text, /AND 4 MORE/);
assert.match(email.text, /TURN OFF WEEKLY EMAIL: https:\/\/debaser\.site\/unsubscribe\?t=11111111-2222-3333-4444-555555555555/, 'the unsubscribe link, in the text copy');
assert.match(email.html, /\[ TURN OFF WEEKLY EMAIL \]/, 'and in the HTML copy');
assert.equal(email.headers['List-Unsubscribe'], '<https://debaser.site/api/notify/unsubscribe?t=11111111-2222-3333-4444-555555555555>', "the standard header Gmail's button uses");
assert.equal(email.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
assert.doesNotMatch(email.html, /<script>/, 'third-party names are text, never HTML');
assert.match(email.html, /&lt;script&gt;x&lt;\/script&gt;/);
assert.match(email.html, /LATE &amp; LOUD/);
assert.doesNotMatch(email.html, /<img|style=|color/i, 'no pictures and no colours: nothing to load, readable anywhere');
assert.equal(d.DIGEST_FROM, 'DEBASER_OS <post@debaser.site>', '9A: from debaser.site');

/* The database side ------------------------------------------------------------------------------------------------------ */
const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261120110000_notifications_weekly_email.sql'), 'utf8');
assert.match(sql, /not pr\.is_hidden/, 'never test or hidden accounts');
assert.match(sql, /not coalesce\(u\.is_anonymous, false\)/, 'never stream guests');
assert.match(sql, /pr\.banned_at is null/, 'never banned accounts');
assert.match(sql, /p\.weekly_email/, 'only people who asked (6A)');
assert.match(sql, /n\.read_at is null/, 'only what is still unread (8A)');
assert.doesNotMatch(sql.match(/returns table \(([\s\S]*?)\)/)[1], /\bbody\b/, "a notification's words are never handed over");
assert.match(sql, /set weekly_email = coalesce\(p_on, false\), updated_at = now\(\) where unsubscribe_code = p_code/, 'the unsubscribe changes WEEKLY EMAIL only');
assert.match(sql, /'23 \* \* \* 0,1'/, 'the timer: Sundays and Mondays, every hour');
assert.match(sql, /dense_rank\(\) over \(order by w\.person\)/, 'whole people per call, never half an email');
assert.doesNotMatch(sql, /limit 5000/);
const route = fs.readFileSync(path.join(__dirname, '..', 'app/api/notify/digest/route.ts'), 'utf8');
assert.match(route, /if \(!marked\)[\s\S]*return json/, 'a send that cannot be marked stops the run: no copy every hour');

console.log('check-notify-digest: OK');
