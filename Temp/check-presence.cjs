/*
 * Scratch check for presence (run from the root):
 *   npx tsc app/lib/profile/presence.ts app/lib/profile/name-colours.ts app/lib/profile/visibility.ts app/lib/profile/mock-profile-repository.ts app/lib/ui/relative-time.ts --outDir Temp/check-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   npx tsc app/components/StatusDot.tsx app/components/ProfileName.tsx --outDir Temp/render-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-presence.cjs
 */
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const {
  mergeLiveStates,
  presenceDotColour,
  presenceLabel,
  presenceLine,
  presenceStatus,
} = require('./check-out/profile/presence.js');
const { relativeParts, relativeShort, relativeTime } = require('./check-out/ui/relative-time.js');
const { getMockProfileRepository } = require('./check-out/profile/mock-profile-repository.js');
const StatusDot = require('./render-out/components/StatusDot.js').default;
const ProfileName = require('./render-out/components/ProfileName.js').default;
const AuthProvider = require('./render-out/components/AuthProvider.js').default;
const PresenceProvider = require('./render-out/components/PresenceProvider.js').default;

const element = React.createElement;
const NOW = Date.parse('2026-09-21T12:00:00.000Z');
const at = (minutesAgo) => new Date(NOW - minutesAgo * 60 * 1000).toISOString();

// (2026-10-27, Luke: "far more reactive" lamps) Yellow is AWAY now - a tab open but not in use - not
// "online within the last hour"; somebody who left is red, and the tooltip says how long ago.

// 1a. The live room decides whenever it is connected: in it and in use is green, in it but idle is
// yellow, not in it is red - whatever the stored record says.
const fresh = { userId: 'a', lastSeenAt: at(0), online: true };
assert.equal(presenceStatus(fresh, NOW, { a: 'active' }), 'online', 'a tab in use is green');
assert.equal(presenceStatus(fresh, NOW, { a: 'away' }), 'away', 'a tab open but not in use is yellow');
assert.equal(presenceStatus(fresh, NOW, {}), 'offline', 'no tab in the room is red, even with a fresh heartbeat');
assert.equal(presenceStatus(undefined, NOW, { a: 'active' }, 'a'), 'online', 'the room needs no stored record');
assert.equal(presenceStatus(undefined, NOW, { b: 'active' }, 'a'), 'offline', "somebody else's tab is not yours");
assert.deepEqual(
  mergeLiveStates([
    { userId: 'a', state: 'away' },
    { userId: 'a', state: 'active' },
    { userId: 'b', state: 'away' },
    { userId: 'b', state: 'away' },
  ]),
  { a: 'active', b: 'away' },
  'one tab in use is enough for green; every tab idle is away',
);

// 1b. Without the room (still connecting, or unreachable): the stored record on the clock, never away.
assert.equal(presenceStatus(undefined, NOW), 'offline', 'nobody heard from is offline');
assert.equal(presenceStatus({ userId: 'a', lastSeenAt: at(0), online: true }, NOW), 'online');
assert.equal(presenceStatus({ userId: 'a', lastSeenAt: at(1), online: true }, NOW), 'online');
assert.equal(
  presenceStatus({ userId: 'a', lastSeenAt: at(3), online: true }, NOW),
  'offline',
  'a tab that died mid-session is not online any more',
);
assert.equal(presenceStatus({ userId: 'a', lastSeenAt: at(1), online: false }, NOW), 'offline', 'a goodbye is red');
assert.equal(presenceStatus({ userId: 'a', lastSeenAt: 'nonsense', online: true }, NOW), 'offline');

assert.equal(presenceDotColour('online'), '#28c745');
assert.equal(presenceDotColour('away'), '#fff000');
assert.equal(presenceDotColour('offline'), '#e6004c');
assert.equal(presenceLabel('online'), 'ONLINE NOW');
assert.equal(presenceLabel('away'), 'AWAY');
assert.equal(presenceLine('away', fresh, NOW), 'AWAY', 'away says so, not how long ago');
assert.equal(presenceLabel('offline'), 'OFFLINE');
assert.equal(
  presenceLine('offline', { userId: 'a', lastSeenAt: '2026-09-21T11:00:00.000Z', online: false }, NOW),
  'LAST ONLINE 1 HOUR AGO',
  'the line a lamp is read as says how long ago, not when',
);

// 2. The store: heartbeats, goodbyes and the two reads.
(async () => {
  const repository = getMockProfileRepository();
  const seen = [];
  const unsubscribe = repository.subscribePresence((records) => seen.push(records));

  const beat = await repository.markSeen('user-a');
  assert.equal(beat.online, true);
  assert.equal(presenceStatus(await repository.getPresence('user-a'), Date.now()), 'online');

  const gone = await repository.markOffline('user-a');
  assert.equal(gone.online, false);
  assert.ok(
    Date.parse(gone.lastSeenAt) >= Date.parse(beat.lastSeenAt),
    'the goodbye dates the moment they were last there',
  );
  const stampAfterGoodbye = gone.lastSeenAt;

  await new Promise((resolve) => setTimeout(resolve, 5));
  const again = await repository.markOffline('user-a');
  assert.equal(again.lastSeenAt, stampAfterGoodbye, 'saying goodbye twice does not push it forward');
  assert.equal(presenceStatus(await repository.getPresence('user-a'), Date.now()), 'offline');

  await repository.markSeen('user-b');
  // (2026-11-05, SPEC-privacy-phase-1.md) New people start with the lamp off, and the list holds only the ones who switched it on.
  assert.deepEqual(await repository.listPresence(), [], 'lamps off: nobody is listed');
  await repository.saveProfile('user-a', { visibility: { showOnline: true } });
  await repository.saveProfile('user-b', { visibility: { showOnline: true } });
  const all = await repository.listPresence();
  assert.deepEqual(all.map((record) => record.userId), ['user-a', 'user-b']);
  const onlyB = await repository.listPresence(['user-b']);
  assert.deepEqual(onlyB.map((record) => record.userId), ['user-b']);
  assert.equal(await repository.getPresence('user-nobody'), null);

  assert.ok(seen.length >= 4, 'every write pushed a snapshot to the listeners');
  assert.deepEqual(seen[seen.length - 1].map((record) => record.userId), ['user-a', 'user-b']);

  const beforeUnsubscribe = seen.length;
  unsubscribe();
  await repository.markSeen('user-c');
  assert.equal(seen.length, beforeUnsubscribe, 'no snapshot after unsubscribing');

  // 2b. The mock live room: always connected, and holds the tab's own account and state.
  const rooms = [];
  const leaveRoom = repository.subscribeLive((live) => rooms.push(live));
  assert.deepEqual(rooms[0], {}, 'the room answers at once, empty before anybody tracks');
  repository.trackLive('user-a', 'active');
  assert.deepEqual(rooms[rooms.length - 1], { 'user-a': 'active' });
  repository.trackLive('user-a', 'away');
  assert.deepEqual(rooms[rooms.length - 1], { 'user-a': 'away' }, 'a change of state reaches the listeners');
  repository.untrackLive();
  assert.deepEqual(rooms[rooms.length - 1], {}, 'signing out leaves the room');
  leaveRoom();
  const roomsBefore = rooms.length;
  repository.trackLive('user-a', 'active');
  assert.equal(rooms.length, roomsBefore, 'no room snapshot after unsubscribing');
  repository.untrackLive();

  // 3. The lamp itself, and what a name does before presence has been read.
  const lamps = ['online', 'away', 'offline'].map((status) =>
    renderToStaticMarkup(element(StatusDot, { status, size: 8 })),
  );
  assert.match(lamps[0], /background-color:#28c745/, 'emerald means online');
  assert.match(lamps[1], /background-color:#fff000/, 'daffodil means away');
  assert.match(lamps[1], /aria-label="AWAY"/);
  assert.match(lamps[2], /background-color:#e6004c/, 'rose means offline');
  assert.match(lamps[0], /aria-label="ONLINE NOW"/);

  // A private lamp (Luke, 2026-11-07): a plain box of the same size, with a spoken name that says nothing about whether they are here.
  const box = renderToStaticMarkup(element(StatusDot, { status: 'private', size: 8 }));
  assert.match(box, /aria-label="ONLINE LAMP PRIVATE"/, 'it has a spoken name');
  assert.doesNotMatch(box, /ONLINE NOW|AWAY|OFFLINE|LAST ONLINE/, 'and tells nobody whether they are online');
  assert.match(box, /bg-hardware/, 'a filled box from the tokens');
  assert.match(box, /border-ink\b/, 'with an outline in the field ink, so it shows on a dark bar');
  assert.match(box, /width:8px;height:8px/, 'the same size as a lamp');
  assert.match(lamps[0], /width:8px;height:8px/, 'so it moves nothing');
  assert.doesNotMatch(box, /background-color/, 'and carries no status colour');
  assert.match(lamps[2], /title="NEVER SEEN"/, 'a red lamp nobody has ever heard from says so');

  const tree = (child) => renderToStaticMarkup(element(AuthProvider, null, element(PresenceProvider, null, child)));

  const guest = tree(element(ProfileName, { author: { id: null, displayName: '' } }));
  assert.match(guest, /Anonymous/);
  assert.doesNotMatch(guest, /aria-label="ONLINE NOW"/, 'a guest has no account to be online with');

  const account = tree(element(ProfileName, { author: { id: 'user-a', displayName: 'sweden' } }));
  assert.match(account, /sweden/);
  assert.doesNotMatch(account, /background-color:#e6004c/, 'no lamp is drawn before presence has been read');

  // 4. How long ago, in words: the one wording every "last seen" on the site uses.
  const secondsAgo = (count) => new Date(NOW - count * 1000).toISOString();
  const hoursAgo = (count) => new Date(NOW - count * 60 * 60 * 1000).toISOString();
  const daysAgo = (count) => new Date(NOW - count * 24 * 60 * 60 * 1000).toISOString();

  assert.equal(relativeTime(secondsAgo(1), NOW), '1 SECOND AGO', 'seconds, while they are the honest unit');
  assert.equal(relativeTime(secondsAgo(44), NOW), '44 SECONDS AGO');
  assert.equal(relativeTime(at(1), NOW), '1 MINUTE AGO', 'and the minute it becomes');
  assert.equal(relativeTime(at(44), NOW), '44 MINUTES AGO');
  assert.equal(relativeTime(at(45), NOW), '1 HOUR AGO', 'forty-five minutes reads as the hour it nearly is');
  assert.equal(relativeTime(hoursAgo(21), NOW), '21 HOURS AGO');
  assert.equal(relativeTime(hoursAgo(22), NOW), '1 DAY AGO', 'a day in, it counts days');
  assert.equal(relativeTime(daysAgo(5), NOW), '5 DAYS AGO');
  assert.equal(relativeTime(daysAgo(6), NOW), '1 WEEK AGO', 'a week in, it counts weeks');
  assert.equal(relativeTime(daysAgo(13), NOW), '2 WEEKS AGO');
  assert.equal(relativeTime(daysAgo(28), NOW), '1 MONTH AGO', 'a month is thirty days, not four weeks');
  assert.equal(relativeTime(daysAgo(320), NOW), '1 YEAR AGO', 'and a year in, it counts years');
  assert.equal(relativeTime(daysAgo(1100), NOW), '3 YEARS AGO');

  // The same ladder, in one character: what the side panel's account rows read. Both forms walk
  // `UNITS`, so a reading cannot be `45m` here and `1 HOUR AGO` there.
  assert.equal(relativeShort(secondsAgo(22), NOW), '22s');
  assert.equal(relativeShort(at(5), NOW), '5m');
  assert.equal(relativeShort(hoursAgo(3), NOW), '3h');
  assert.equal(relativeShort(daysAgo(4), NOW), '4d');
  assert.equal(relativeShort(daysAgo(13), NOW), '2w');
  assert.equal(relativeShort(daysAgo(180), NOW), '6m', 'months share the letter with minutes, and never the age');
  assert.equal(relativeShort(daysAgo(400), NOW), '1y');
  assert.equal(relativeShort(null, NOW), '--', 'a reading nobody could take says so rather than inventing one');

  // The two forms agree about which unit an age is in, for every age either is drawn at.
  for (const stamp of [secondsAgo(22), secondsAgo(44), at(5), at(44), hoursAgo(3), hoursAgo(21), daysAgo(4), daysAgo(13), daysAgo(35), daysAgo(180), daysAgo(400)]) {
    const parts = relativeParts(stamp, NOW);
    assert.equal(relativeShort(stamp, NOW), `${parts.value}${relativeShort(stamp, NOW).slice(-1)}`);
    assert.ok(
      relativeTime(stamp, NOW).startsWith(`${parts.value} `),
      `both forms read ${stamp} as the same count (${relativeShort(stamp, NOW)} vs ${relativeTime(stamp, NOW)})`,
    );
  }

  assert.deepEqual(
    relativeParts(at(5), NOW),
    { value: 5, unit: 'minute' },
    'the count and the unit are readable on their own, so a caller can lay them out itself',
  );
  assert.equal(relativeTime(null, NOW), 'AT AN UNKNOWN TIME', 'a blank column is not a date');
  assert.equal(relativeTime('nonsense', NOW), 'AT AN UNKNOWN TIME', 'and neither is a stamp nobody can parse');
  assert.equal(
    relativeTime(new Date(NOW + 60 * 1000).toISOString(), NOW),
    '1 SECOND AGO',
    'a clock that disagrees counts as the least it can, never as the future',
  );

  assert.equal(presenceLine('online', undefined, NOW), 'ONLINE NOW', 'the one status that needs no arithmetic');
  assert.equal(
    presenceLine('offline', { userId: 'a', lastSeenAt: at(12), online: false }, NOW),
    'LAST ONLINE 12 MINUTES AGO',
    'and the line a profile ends with',
  );
  assert.equal(presenceLine('offline', undefined, NOW), 'NEVER SEEN', 'an account nobody has heard from says so');

  console.log('presence checks passed');
  console.log('  statuses : online / away / offline ->', ['online', 'away', 'offline'].map(presenceDotColour).join(' '));
  console.log('  store    : markSeen online, goodbye dates the leave, listPresence all + by id');
  console.log('  how long : seconds / minutes / hours / days / months / years, uppercased by the one wording');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
