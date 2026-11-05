/*
 * Scratch check for the users page (run from the project root):
 *   npx tsc app/lib/profile/directory.ts app/lib/profile/presence.ts --outDir Temp/directory-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strict
 *   npx tsc app/components/UserDirectoryRow.tsx --outDir Temp/directory-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strict
 *   node Temp/check-user-directory.cjs
 *
 * Proves the two halves of the directory:
 *   1. the ordering - the house account first as admin, then whoever is online,
 *      then away (the site open, not in use), then the rest, alphabetical inside a rank;
 *   2. the row markup - lamp, coloured name, [ ADMIN ] / [ YOU ], and the message
 *      button only where a signed-in visitor has somebody to write to.
 */
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const { buildUserDirectory, countDirectoryStatuses } = require('./directory-out/profile/directory.js');
const UserDirectoryRow = require('./directory-render/components/UserDirectoryRow.js').default;
const AuthProvider = require('./directory-render/components/AuthProvider.js').default;
const PresenceProvider = require('./directory-render/components/PresenceProvider.js').default;

const element = React.createElement;
/** UserDirectoryRow draws ProfileName, so the presence provider has to be around it. */
const withProviders = (child) =>
  renderToStaticMarkup(element(AuthProvider, null, element(PresenceProvider, null, child)));

function account(id, displayName, createdAt) {
  return { id, displayName, email: `${id}@example.com`, createdAt, backend: 'mock' };
}

const ACCOUNTS = [
  account('user-zoe', 'zoe', '2026-09-02T10:00:00.000Z'),
  account('debaser-site', 'debaser.site', '2026-09-01T09:00:00.000Z'),
  account('user-amy', 'amy', '2026-09-03T10:00:00.000Z'),
  account('user-bob', 'bob', '2026-09-04T10:00:00.000Z'),
];

// (2026-10-27, Luke: "far more reactive" lamps) Yellow is AWAY now - a tab open but not in use - not
// "online within the last hour"; somebody who left is red, and the tooltip says how long ago.
const STATUS = {
  'user-zoe': 'online',
  'user-amy': 'away',
  'user-bob': 'online',
  'debaser-site': 'offline',
};

// (2026-11-05, SPEC-privacy-phase-1.md) A row with no stamp is a lamp switched off, so the people lit up here need one.
const RECORDS = {
  'user-zoe': { userId: 'user-zoe', lastSeenAt: '2026-09-21T04:00:00.000Z', online: true },
  'user-bob': { userId: 'user-bob', lastSeenAt: '2026-09-21T04:00:00.000Z', online: true },
  'user-amy': { userId: 'user-amy', lastSeenAt: '2026-09-21T04:00:00.000Z', online: false },
  'debaser-site': { userId: 'debaser-site', lastSeenAt: '2026-09-20T12:00:00.000Z', online: false },
};

function directory(viewerId) {
  return buildUserDirectory({
    accounts: ACCOUNTS,
    statusFor: (userId) => STATUS[userId] ?? 'offline',
    recordFor: (userId) => RECORDS[userId],
    viewerId,
  });
}

// 1. Ordering: the admin, then the people who are around.
const rows = directory('user-bob');
assert.deepEqual(
  rows.map((row) => row.account.id),
  ['debaser-site', 'user-bob', 'user-zoe', 'user-amy'],
  'admin first, then online by name, then away',
);
assert.equal(rows[0].admin, true, 'the house account is the admin');
assert.equal(rows.filter((row) => row.admin).length, 1);
assert.deepEqual(
  rows.filter((row) => row.you).map((row) => row.account.id),
  ['user-bob'],
  'only the reader is you',
);
assert.deepEqual(directory(null).filter((row) => row.you), [], 'nobody is you signed out');
assert.deepEqual(countDirectoryStatuses(rows), { online: 2, away: 1, offline: 1 });

// Two accounts with the same name keep a stable order.
const tied = buildUserDirectory({
  accounts: [account('b-id', 'Sam', '2026-09-01T00:00:00.000Z'), account('a-id', 'sam', '2026-09-01T00:00:00.000Z')],
  statusFor: () => 'offline',
  recordFor: () => undefined,
  viewerId: null,
});
assert.deepEqual(
  tied.map((row) => row.account.id),
  ['a-id', 'b-id'],
  'a name tie falls back to the id',
);

// 2. The admin row: pinned, marked, dark blue, and lamped - unlike the board.
const adminHtml = withProviders(
  element(UserDirectoryRow, { row: rows[0], viewerId: 'user-bob', onMessage: () => undefined }),
);
assert.match(adminHtml, /\[ ADMIN \]/);
assert.match(
  adminHtml,
  /href="\/profile\/debaser-site"[^>]*><span>debaser\.site<\/span><\/a>/,
  'the name is drawn by ProfileName, so its dark blue swatch lands with the profile read',
);
assert.match(adminHtml, /background-color:#e6004c/, 'and a rose lamp, which the board never draws for it');
assert.match(adminHtml, /OFFLINE/);
assert.match(adminHtml, /href="\/profile\/debaser-site"/, 'the name opens the house profile');
assert.match(adminHtml, /\[ MESSAGE \]/, 'the admin can be written to like anybody else');
assert.doesNotMatch(adminHtml, /\[ YOU \]/);

// Your own row: marked, green, and with nobody to message.
const youRow = rows.find((row) => row.you);
const youHtml = withProviders(
  element(UserDirectoryRow, { row: youRow, viewerId: 'user-bob', onMessage: () => undefined }),
);
assert.match(youHtml, /\[ YOU \]/);
assert.match(youHtml, /background-color:#28c745/, 'your own lamp is emerald');
assert.doesNotMatch(youHtml, /\[ MESSAGE \]/);

// A signed-out visitor: no message buttons and nobody marked as them.
const guestRows = directory(null);
const guestHtml = withProviders(
  element(UserDirectoryRow, {
    row: guestRows.find((row) => row.account.id === 'user-bob'),
    viewerId: null,
    onMessage: () => undefined,
  }),
);
assert.doesNotMatch(guestHtml, /\[ MESSAGE \]/, 'a guest gets no message button');
assert.doesNotMatch(guestHtml, /\[ YOU \]/);

// The joined stamp: what Supabase sends, drawn as a stamp rather than as ISO.
const supabaseRow = {
  account: account('user-new', 'newcomer', '2026-09-21T07:30:44.427944+00:00'),
  status: 'offline',
  record: undefined,
  admin: false,
  you: false,
};
const supabaseHtml = withProviders(element(UserDirectoryRow, { row: supabaseRow, viewerId: null }));
// (2026-10-23, SPEC-efficiency.md) `JOINED <date>` is cut from the list (the profile has it); the row is
// the name, the lamp and its age. The raw instant must still never leak into it.
assert.doesNotMatch(supabaseHtml, /JOINED/, 'the joined date is not on the list row');
assert.doesNotMatch(supabaseHtml, /07:30:44/, 'no seconds');
assert.doesNotMatch(supabaseHtml, /\+00:00/, 'and no raw instant');

// A banned account: marked in the row, because their posts are hidden from
// everybody but the admin - the name would otherwise just look quiet.
const bannedRows = buildUserDirectory({
  accounts: [{ ...account('user-out', 'outlaw', '2026-09-01T00:00:00.000Z'), banned: true }],
  statusFor: () => 'offline',
  recordFor: () => undefined,
  viewerId: null,
});
const bannedHtml = withProviders(element(UserDirectoryRow, { row: bannedRows[0], viewerId: null }));
assert.match(bannedHtml, /\[ BANNED \]/, 'a ban is said out loud');
assert.doesNotMatch(adminHtml, /\[ BANNED \]/, 'and only where it applies');

// 3. The actions slot: the arcade invites where the directory messages, in the same row.
const inviteHtml = withProviders(
  element(UserDirectoryRow, {
    row: rows.find((row) => row.account.id === 'user-zoe'),
    viewerId: 'user-bob',
    onMessage: () => undefined,
    actions: React.createElement('button', { type: 'button' }, '[ INVITE TO GAME ]'),
  }),
);
assert.match(inviteHtml, /\[ INVITE TO GAME \]/, 'a screen with its own verb adds it to the row');
assert.match(inviteHtml, /\[ MESSAGE \]/, 'and the message button stays where it was');
assert.match(inviteHtml, /ONLINE/, 'the lamp is drawn once, not once per screen');
assert.equal((inviteHtml.match(/<li /g) ?? []).length, 1, 'one row, whatever it offers');

const inviteOnly = withProviders(
  element(UserDirectoryRow, {
    row: rows.find((row) => row.account.id === 'user-zoe'),
    viewerId: 'user-bob',
    actions: React.createElement('button', { type: 'button' }, '[ INVITE TO GAME ]'),
  }),
);
assert.match(inviteOnly, /\[ INVITE TO GAME \]/, 'the arcade offers its own verb and nothing else');
assert.doesNotMatch(inviteOnly, /\[ MESSAGE \]/, 'and no button it did not ask for');
assert.doesNotMatch(
  withProviders(element(UserDirectoryRow, { row: rows[1], viewerId: 'user-bob' })),
  /\[ MESSAGE \]/,
  'a row with nothing to ask offers nothing',
);

console.log('user directory checks passed');
console.log('  order :', rows.map((row) => `${row.account.displayName}(${row.status})`).join(' -> '));
console.log('  admin :', adminHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
console.log('  joined:', supabaseHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
