/*
 * SPEC-notifications.md, phase 1: the new kinds (letters, picked people's rooms going live, comic pages), where each line
 * opens, the switches (one per kind; a switched-off kind is not filed), and the balloon's rules.
 *   npx tsc app/lib/notifications/feed.ts app/lib/notifications/links.ts app/lib/notifications/prefs.ts app/lib/notifications/balloon.ts app/lib/notifications/mock-notifications-repository.ts app/lib/notifications/mock-notify-settings-repository.ts --rootDir app --outDir Temp/notify-phase1-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   node Temp/check-notify-phase1.cjs
 *
 * The database side (the gate, the room trigger, notify_comic_page, the owner-only tables) is read from the migration
 * here for its shape, and probed live for its policies once applied.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, 'notify-phase1-out');
const ROOT = path.join(__dirname, '..');

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
  };
}
global.window = { localStorage: fakeStorage(), addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };

const feed = require(path.join(OUT, 'lib/notifications/feed.js'));
const { notificationHref, isSiteAddress } = require(path.join(OUT, 'lib/notifications/links.js'));
const prefs = require(path.join(OUT, 'lib/notifications/prefs.js'));
const balloon = require(path.join(OUT, 'lib/notifications/balloon.js'));
const { MOCK_NOTIFY_SETTINGS_KEY, getMockNotifySettingsRepository } = require(path.join(OUT, 'lib/notifications/mock-notify-settings-repository.js'));
const { getMockNotificationsRepository } = require(path.join(OUT, 'lib/notifications/mock-notifications-repository.js'));

const row = (over) => ({
  id: 'n1',
  userId: 'me',
  kind: 'reply',
  actorId: 'alex',
  actorName: 'ALEX',
  threadId: null,
  threadTitle: '',
  body: '',
  gameId: null,
  inviteId: null,
  recommendationId: null,
  href: null,
  roomId: null,
  createdAt: '2026-11-20T10:00:00.000Z',
  readAt: null,
  ...over,
});

(async () => {
  /* Words ------------------------------------------------------------------------------------------------------------ */
  assert.equal(feed.notificationLabel('letter'), 'SENT YOU A LETTER');
  assert.equal(feed.notificationLabel('live'), 'WENT LIVE');
  assert.equal(feed.notificationLabel('comic'), 'NEW COMIC PAGES');
  assert.equal(feed.notificationLine(row({ kind: 'letter', threadTitle: 'SUMMER' })), 'ALEX SENT YOU A LETTER "SUMMER"');
  assert.equal(feed.notificationLine(row({ kind: 'comic', actorName: 'DEBASER', threadTitle: '5 NEW PAGES IN CHAPTER 3' })), '5 NEW PAGES IN CHAPTER 3', 'a comic alert is its title alone');
  assert.equal(feed.notificationLine(row({ kind: 'live', threadTitle: 'LATE SHOW' }), true), 'ALEX IS LIVE "LATE SHOW"');
  assert.equal(feed.notificationLine(row({ kind: 'live', threadTitle: 'LATE SHOW' }), false), 'ALEX WAS LIVE "LATE SHOW"', 'after the room ends');
  assert.equal(feed.notificationLine(row({ kind: 'live' })), 'ALEX WENT LIVE', 'an unnamed room, state unknown');
  assert.equal(feed.notificationPlaceWord('live'), 'ROOM');
  assert.equal(feed.notificationPlaceWord('letter'), 'LETTER');

  /* Where a line opens ------------------------------------------------------------------------------------------------ */
  assert.equal(notificationHref(row({ kind: 'comic', href: '/comic/3/12' })), '/comic/3/12', 'the address the database filed');
  for (const away of ['https://example.com', '//example.com', '/\\example.com', 'javascript:alert(1)']) {
    assert.equal(isSiteAddress(away), false, `${away} is not a site address`);
    assert.notEqual(notificationHref(row({ kind: 'comic', href: away })), away, `a row never sends anybody to ${away}`);
  }
  assert.equal(notificationHref(row({ kind: 'letter', recommendationId: 'r1' })), '/recommendations?open=r1', 'a letter opens on RECOMMENDED');
  assert.equal(notificationHref(row({ kind: 'live', roomId: 'room-1' })), '/forum?watch=room-1', 'a live room opens the room');
  assert.equal(notificationHref(row({ kind: 'reply', threadId: 't1' })).startsWith('/forum#'), true, 'a reply is its post');
  assert.equal(notificationHref(row({ kind: 'invite', inviteId: 'i1' })).includes('i1'), true, 'an invitation is the arcade');

  /* Switches -------------------------------------------------------------------------------------------------------- */
  assert.equal(prefs.DEFAULT_NOTIFICATION_PREFS.comic, false, 'COMIC NEW PAGES starts off: following turns it on');
  assert.equal(prefs.DEFAULT_NOTIFICATION_PREFS.weeklyEmail, false, '6A: the weekly email starts off');
  for (const key of ['replies', 'letters', 'live', 'invites', 'balloons']) assert.equal(prefs.DEFAULT_NOTIFICATION_PREFS[key], true, `${key} starts on`);
  assert.equal(prefs.switchFor('tag'), 'replies');
  assert.equal(prefs.switchFor('recommend'), 'letters', 'recommendations and letters both arrive through RECOMMEND');
  assert.equal(prefs.switchFor('letter'), 'letters');
  assert.equal(prefs.switchFor('comic_reply'), 'comic');
  assert.deepEqual(prefs.parseNotificationPrefs({ replies: false, weekly_email: true, live: 'no' }), { ...prefs.DEFAULT_NOTIFICATION_PREFS, replies: false, weeklyEmail: true }, 'a database row, read defensively');

  // The mock feed drops a switched-off kind, as the database's gate does.
  const settings = getMockNotifySettingsRepository();
  const notes = getMockNotificationsRepository();
  await settings.savePrefs('bea', { ...prefs.DEFAULT_NOTIFICATION_PREFS, replies: false });
  await notes.notify({ actorId: 'alex', actorName: 'ALEX', threadId: 't1', threadTitle: 'POST', body: 'hi', targets: [{ userId: 'bea', kind: 'reply' }, { userId: 'cal', kind: 'reply' }] });
  assert.equal((await notes.list('bea')).length, 0, 'REPLIES AND TAGS off: nothing filed');
  assert.equal((await notes.list('cal')).length, 1, 'somebody with it on is still told');
  await notes.notify({ actorId: 'alex', actorName: 'ALEX', threadId: 't1', threadTitle: 'GAME', body: '', targets: [{ userId: 'bea', kind: 'invite' }], gameId: null, inviteId: 'i9' });
  assert.equal((await notes.list('bea')).length, 1, 'other kinds still reach her');
  assert.ok(window.localStorage.getItem(MOCK_NOTIFY_SETTINGS_KEY).includes('"replies":false'));

  // TELL ME WHEN LIVE picks: newest first, never yourself.
  await settings.addWatch('bea', 'alex');
  await settings.addWatch('bea', 'dee');
  await settings.addWatch('bea', 'bea');
  assert.deepEqual(await settings.listWatches('bea'), ['dee', 'alex']);
  await settings.removeWatch('bea', 'alex');
  assert.deepEqual(await settings.listWatches('bea'), ['dee']);

  /* The balloon ------------------------------------------------------------------------------------------------------ */
  const old = row({ id: 'old' });
  let state = balloon.balloonStep(balloon.BALLOON_START, [old], true, true);
  assert.equal(balloon.balloonNow(state, [old]).item, null, 'the feed as it loads is history: no balloon');
  const fresh = row({ id: 'fresh', createdAt: '2026-11-20T11:00:00.000Z' });
  state = balloon.balloonStep(state, [fresh, old], true, true);
  assert.equal(balloon.balloonNow(state, [fresh, old]).item.id, 'fresh', 'a new unread row pops up');
  const newer = row({ id: 'newer', createdAt: '2026-11-20T12:00:00.000Z' });
  state = balloon.balloonStep(state, [newer, fresh, old], true, true);
  assert.deepEqual(balloon.balloonNow(state, [newer, fresh, old]), { item: newer, more: 1 }, 'newest first, the rest +1 MORE');
  state = balloon.balloonDismiss(state);
  assert.equal(balloon.balloonNow(state, [newer, fresh, old]).item.id, 'fresh', 'closing one shows the next');
  state = balloon.balloonStep(state, [newer, { ...fresh, readAt: '2026-11-20T12:01:00.000Z' }, old], true, true);
  assert.equal(balloon.balloonNow(state, []).item, null, 'a row read elsewhere leaves the queue');
  const hidden = row({ id: 'hidden' });
  state = balloon.balloonStep(state, [hidden], false, true);
  state = balloon.balloonStep(state, [hidden], true, true);
  assert.equal(balloon.balloonNow(state, [hidden]).item, null, 'arrived while the tab was hidden: the bell holds it, no stale balloon');
  const off = row({ id: 'off' });
  state = balloon.balloonStep(state, [off], true, false);
  assert.equal(balloon.balloonNow(state, [off]).item, null, 'BALLOONS off: none');
  const a = row({ id: 'a' });
  const b = row({ id: 'b' });
  state = balloon.balloonStep(state, [a, b], true, true);
  assert.equal(balloon.balloonNow(balloon.balloonClear(state), [a, b]).item, null, '+N MORE spends the queue');

  /* The database side, read from the migration ------------------------------------------------------------------------ */
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261120014611_notifications_phase1.sql'), 'utf8');
  assert.match(sql, /alter table public\.notification_prefs enable row level security/);
  assert.match(sql, /alter table public\.live_watches enable row level security/);
  assert.match(sql, /revoke all on function public\.notify_comic_page\(text, text, text, text\) from public, anon, authenticated/, 'no browser calls COMIC\'s way in');
  assert.match(sql, /new\.privacy in \('open', 'password'\)/, 'a PRIVATE (link-only) room tells nobody');
  assert.match(sql, /interval '30 minutes'/, 'one alert per room per person per 30 minutes');
  assert.match(sql, /before insert on public\.forum_notifications/, 'the switches are applied before a row is filed');
  assert.doesNotMatch(sql, /\bdelete from\b|\bdrop table\b/i, 'nothing existing is deleted');
  assert.match(sql, /to_regprocedure\('public\.has_blocked\(uuid, uuid\)'\)/, "MODERATION's blocking is honoured once it exists");

  console.log('check-notify-phase1: OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
