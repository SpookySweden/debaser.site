/*
 * Scratch check for the Supabase hook and the import script (run from the root):
 *   npx tsc app/lib/profile/supabase-profile-repository.ts app/lib/comms/supabase-comms-repository.ts app/lib/profile/repository.ts app/lib/comms/repository.ts app/lib/forum/repository.ts app/lib/notifications/repository.ts app/lib/auth/auth-repository.ts app/lib/profile/avatar-upload.ts app/lib/profile/song-upload.ts app/lib/audio/catalogue.ts app/lib/audio/repository.ts app/lib/lore/repository.ts app/lib/lore/supabase-lore-repository.ts --outDir Temp/supabase-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strict
 *   npx tsc app/lib/forum/format.ts app/lib/profile/name-colours.ts app/lib/profile/visibility.ts app/lib/profile/mock-profile-repository.ts app/lib/profile/avatar-catalogue.ts --outDir Temp/check-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   npx tsc app/components/ProfileCustomiserPictureTab.tsx --outDir Temp/render-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-supabase.cjs
 *
 * Two things are proved here.
 *
 * 1. The switches. With no Supabase keys in the environment every store falls back
 *    to the mock one - which is what keeps the site working with no backend. With
 *    the keys and the four NEXT_PUBLIC_* switches set, each store selects its
 *    Supabase implementation. The second half runs in a child process, because the
 *    switches read the environment once, when the module is first loaded.
 *
 * 2. The import script matches the code. Every table and every snake_case column
 *    the TypeScript repositories name is read out of them and looked for in
 *    supabase/schema.sql, every table in that file is checked for RLS and for at
 *    least one policy, and the new-user trigger, the house-account seed and the
 *    realtime block are checked for by name. It cannot run the SQL - that happens
 *    in the Supabase SQL editor - but it can prove the two halves agree.
 */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_PATH = path.join(process.cwd(), 'supabase', 'schema.sql');
const SCHEMA = fs.readFileSync(SCHEMA_PATH, 'utf8');

/** The child run: the environment says Supabase, so every switch should agree. */
if (process.env.CHECK_SUPABASE_MODE === 'supabase') {
  const { PROFILE_DATA_SOURCE, getProfileRepository } = require('./supabase-out/profile/repository.js');
  const { COMMS_DATA_SOURCE, getCommsRepository } = require('./supabase-out/comms/repository.js');
  const { FORUM_DATA_SOURCE } = require('./supabase-out/forum/repository.js');
  const { NOTIFICATIONS_DATA_SOURCE } = require('./supabase-out/notifications/repository.js');
  const { AUTH_BACKEND } = require('./supabase-out/auth/auth-repository.js');
  const { LORE_DATA_SOURCE, getLoreRepository } = require('./supabase-out/lore/repository.js');

  assert.equal(AUTH_BACKEND, 'supabase');
  assert.equal(FORUM_DATA_SOURCE, 'supabase');
  assert.equal(PROFILE_DATA_SOURCE, 'supabase');
  assert.equal(COMMS_DATA_SOURCE, 'supabase');
  // Nothing told the notification feed where to read: it follows the board, because a tag is a
  // board event. That is what makes it live on a project that only set the board's switch.
  assert.equal(NOTIFICATIONS_DATA_SOURCE, 'supabase', 'the feed follows the board');
  assert.equal(LORE_DATA_SOURCE, 'supabase', 'and the lore shelf moves over when it is told to');
  assert.equal(getProfileRepository().source, 'supabase');
  assert.equal(getCommsRepository().source, 'supabase');
  assert.equal(getLoreRepository().source, 'supabase');

  console.log('  switches      : supabase selected for auth, board, profiles, comms and lore');
  process.exit(0);
}

/** The child run for the feed's own switch, which is allowed to disagree with the board's. */
if (process.env.CHECK_SUPABASE_MODE === 'notifications-override') {
  const { NOTIFICATIONS_DATA_SOURCE } = require('./supabase-out/notifications/repository.js');

  assert.equal(NOTIFICATIONS_DATA_SOURCE, process.env.CHECK_EXPECT);
  console.log(`  notifications : ${NOTIFICATIONS_DATA_SOURCE} when told to be, whatever the board does`);
  process.exit(0);
}

// 1. No keys in this process, so everything stays on the mock store.
const { PROFILE_DATA_SOURCE, getProfileRepository } = require('./supabase-out/profile/repository.js');
const { COMMS_DATA_SOURCE, getCommsRepository } = require('./supabase-out/comms/repository.js');
const { FORUM_DATA_SOURCE } = require('./supabase-out/forum/repository.js');
const { NOTIFICATIONS_DATA_SOURCE } = require('./supabase-out/notifications/repository.js');
const { AUTH_BACKEND } = require('./supabase-out/auth/auth-repository.js');
const { LORE_DATA_SOURCE, getLoreRepository } = require('./supabase-out/lore/repository.js');

assert.equal(AUTH_BACKEND, 'mock', 'no keys: accounts stay local');
assert.equal(FORUM_DATA_SOURCE, 'mock');
assert.equal(PROFILE_DATA_SOURCE, 'mock');
assert.equal(COMMS_DATA_SOURCE, 'mock');
assert.equal(NOTIFICATIONS_DATA_SOURCE, 'mock', 'and the feed has nowhere to read from either');
assert.equal(LORE_DATA_SOURCE, 'mock', 'the lore pages fall back with everything else');
assert.equal(getProfileRepository().source, 'mock');
assert.equal(getCommsRepository().source, 'mock');
assert.equal(getLoreRepository().source, 'mock');

/** The keys, without any of the switches: what each store does with them is the point. */
const KEYS = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_example',
};

// And with the keys plus the switches, each one moves over.
execFileSync(process.execPath, [__filename], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ...KEYS,
    CHECK_SUPABASE_MODE: 'supabase',
    NEXT_PUBLIC_AUTH_BACKEND: 'supabase',
    NEXT_PUBLIC_FORUM_DATA_SOURCE: 'supabase',
    NEXT_PUBLIC_PROFILE_DATA_SOURCE: 'supabase',
    NEXT_PUBLIC_COMMS_DATA_SOURCE: 'supabase',
    NEXT_PUBLIC_LORE_DATA_SOURCE: 'supabase',
  },
});

// The feed's own switch, which may disagree with the board's - in both directions.
for (const [forum, notifications] of [
  ['supabase', 'mock'],
  ['', 'supabase'],
]) {
  execFileSync(process.execPath, [__filename], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...KEYS,
      CHECK_SUPABASE_MODE: 'notifications-override',
      CHECK_EXPECT: notifications,
      NEXT_PUBLIC_FORUM_DATA_SOURCE: forum,
      NEXT_PUBLIC_NOTIFICATIONS_DATA_SOURCE: notifications,
    },
  });
}

// 2. The import script and the code agree.
const TABLES = [
  'profiles',
  'profile_avatar_versions',
  'profile_tags',
  'profile_comments',
  'profile_song_versions',
  'forum_threads',
  'forum_comments',
  'comms_threads',
  'comms_messages',
  'comms_reads',
  'comms_members',
  'music_tracks',
  'music_folders',
  'forum_notifications',
  'forum_pins',
  'lore_pages',
];

const SOURCES = [
  'app/lib/profile/supabase-profile-repository.ts',
  'app/lib/comms/supabase-comms-repository.ts',
  'app/lib/forum/supabase-repository.ts',
  'app/lib/auth/supabase-auth.ts',
  'app/lib/audio/supabase-music-repository.ts',
  'app/lib/notifications/supabase-notifications-repository.ts',
  'app/lib/lore/supabase-lore-repository.ts',
].map((file) => ({ file, text: fs.readFileSync(path.join(process.cwd(), file), 'utf8') }));

for (const table of TABLES) {
  assert.match(SCHEMA, new RegExp(`create table if not exists public\\.${table} `), `${table} is created`);
  assert.match(
    SCHEMA,
    new RegExp(`alter table public\\.${table} enable row level security`),
    `${table} has RLS switched on`,
  );
  assert.ok(
    SCHEMA.includes(`on public.${table}`),
    `${table} has at least one policy`,
  );
  assert.ok(
    SOURCES.some(({ text }) => text.includes(`'${table}'`)),
    `${table} is the table a repository reads`,
  );
}

// Every snake_case column named in the repositories' row types exists in the
// script. This is the check that catches "the code queries a column the import
// script never makes" - the failure that would otherwise only show up at runtime.
const ROW_TYPES = SOURCES.flatMap(({ text }) => [...text.matchAll(/^type \w+Row = \{([\s\S]*?)^\};/gm)].map((m) => m[1]));
assert.ok(ROW_TYPES.length >= 4, 'the row types were found');

const columns = new Set(
  ROW_TYPES.flatMap((block) => [...block.matchAll(/^\s{2}([a-z][a-z0-9_]*)\??:/gm)].map((match) => match[1])),
);
assert.ok(columns.size > 20, `the column list was read (${columns.size} columns)`);

const missing = [...columns].filter((column) => !SCHEMA.includes(`${column} `) && !SCHEMA.includes(`${column},`));

assert.deepEqual(missing, [], `every column the code names is in the script: missing ${missing.join(', ')}`);

// The pieces that are easy to forget, by name.
assert.match(SCHEMA, /create trigger on_auth_user_created/, 'new accounts get a profile row');
assert.match(SCHEMA, /admin1212@debaser\.site/, 'the house account is seeded');
assert.match(SCHEMA, /'#1d3ca6'/, 'and seeded in the swatch`s Royal Blue');
// The welcome tag is filed by the database as well as the app, or a Supabase account would open
// with an empty tag list while a mock one opened with a tag (see app/lib/profile/visibility.ts).
assert.match(SCHEMA, /'NEW HERE'/, 'every account is given the welcome tag on signup');
assert.match(
  SCHEMA,
  /is_house boolean[\s\S]*when is_house then 'debaser\.site'/,
  'the trigger itself plants the house account, so the order of events cannot miss it',
);
assert.match(SCHEMA, /create unique index if not exists forum_threads_anchor_key/, 'one auto-thread per item');
assert.match(SCHEMA, /parent_id uuid references public\.forum_comments/, 'replies keep their parent');
assert.match(
  SCHEMA,
  /update auth\.users[\s\S]*jsonb_build_object\('display_name', 'debaser\.site'\)/,
  'the house account signs its posts with the house name, not the address',
);
assert.match(
  SCHEMA,
  /create trigger on_auth_user_created_before[\s\S]*claim_house_name/,
  'and a house account created from now on carries that name from the start',
);

for (const table of ['forum_threads', 'forum_comments', 'comms_threads', 'comms_messages', 'profiles', 'forum_notifications', 'forum_pins']) {
  assert.ok(
    SCHEMA.includes(`alter publication supabase_realtime add table public.${table}`),
    `${table} is in the realtime publication`,
  );
}

// And the script is re-runnable rather than one-shot.
assert.ok(!/^\s*drop table/m.test(SCHEMA), 'the script never drops a table');
assert.match(SCHEMA, /drop policy if exists/, 'policies are recreated by name');

// Moderation: one admin test, and the policies that read it.
assert.match(SCHEMA, /create or replace function public\.is_admin\(\)/, 'the admin test is one function');

for (const policy of [
  'forum_threads moderate',
  'forum_threads remove',
  'forum_comments moderate',
  'forum_comments remove',
  'profile_tags admin remove',
  'profile_comments admin remove',
]) {
  assert.ok(SCHEMA.includes(`create policy "${policy}"`), `${policy} exists`);
}

// Storage: the bucket the drawings go in, and who may touch it.
assert.match(
  SCHEMA,
  /insert into storage\.buckets[\s\S]*'avatars'/,
  'the picture bucket is created',
);

for (const policy of ['avatars readable', 'avatars filed by owner', 'avatars replaced by owner', 'avatars removed by owner or admin']) {
  assert.ok(SCHEMA.includes(`create policy "${policy}"`), `${policy} exists`);
}

assert.match(
  SCHEMA,
  /storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/,
  'a drawing can only be filed into your own folder',
);

// The upload module: the paths it builds and the files it refuses.
const { AVATAR_BUCKET, avatarStoragePath, validateAvatarFile } = require('./supabase-out/profile/avatar-upload.js');
const { AVATAR_ACCEPT, MAX_AVATAR_BYTES } = require('./supabase-out/profile/avatar-catalogue.js');

assert.equal(AVATAR_BUCKET, 'avatars');
assert.match(
  avatarStoragePath('b5a56c2d-eb6c', 3, '.png'),
  /^b5a56c2d-eb6c\/avatar-v3-\d{14}\.png$/,
  'the path carries the owner and the version',
);
assert.match(avatarStoragePath('../../etc/passwd', 1, '.png'), /^etcpasswd\/avatar-v1-/, 'a nasty id cannot escape');
// (2026-10-25, SPEC-less-text.md) `ONLY PNG, JPG, WEBP OR GIF DRAWINGS ARE ACCEPTED.` -> `PNG, JPG, WEBP OR GIF ONLY.`
assert.equal(validateAvatarFile({ type: 'application/pdf', size: 10 }), 'PNG, JPG, WEBP OR GIF ONLY.');
assert.equal(
  validateAvatarFile({ type: 'image/png', size: MAX_AVATAR_BYTES + 1 }),
  `DRAWINGS MUST BE ${Math.round(MAX_AVATAR_BYTES / 1024)}KB OR SMALLER.`,
);
assert.equal(validateAvatarFile({ type: 'image/png', size: 4096 }), undefined);

// The bucket's own rules have to agree with the site's, or the site would promise
// one limit in its message and the bucket enforce another behind its back.
const bucketRow = SCHEMA.match(/insert into storage\.buckets[\s\S]*?values \(\s*'avatars'[\s\S]*?\);/)[0];
const bucketLimit = Number(bucketRow.match(/(\d{6,})/)[1]);
const bucketTypes = bucketRow.match(/array\[([^\]]+)\]/)[1].split(',').map((type) => type.trim().replace(/^'|'$/g, ''));

assert.equal(bucketLimit, MAX_AVATAR_BYTES, 'the bucket refuses at the same size the site does');
assert.deepEqual(bucketTypes, AVATAR_ACCEPT.split(','), 'and accepts the same drawings');

for (const type of AVATAR_ACCEPT.split(',')) {
  assert.equal(validateAvatarFile({ type, size: 1024 }), undefined, `${type} is accepted by the form too`);
}

// The music bucket and an account's own track, checked the way the pictures are: the
// bucket the shelf writes into, the folder rule, and the limits the site and the bucket
// have to agree on.
const { MUSIC_ACCEPT, MUSIC_BUCKET, MAX_TRACK_BYTES, trackStoragePath, validateTrackFile } = require('./supabase-out/audio/catalogue.js');
const { songStoragePath } = require('./supabase-out/profile/song-upload.js');

assert.equal(MUSIC_BUCKET, 'mp3');
assert.match(SCHEMA, /insert into storage\.buckets[\s\S]*'mp3'/, 'the music bucket is created');

for (const policy of ['mp3 readable', 'mp3 filed by owner', 'mp3 replaced by owner', 'mp3 removed by owner or admin']) {
  assert.ok(SCHEMA.includes(`create policy "${policy}"`), `${policy} exists`);
}

const musicBucketRow = SCHEMA.match(/values \(\s*'mp3'[\s\S]*?\);/)[0];
const musicLimit = Number(musicBucketRow.match(/(\d{6,})/)[1]);
const musicTypes = musicBucketRow
  .match(/array\[([^\]]+)\]/)[1]
  .split(',')
  .map((type) => type.trim().replace(/^'|'$/g, ''));

assert.equal(musicLimit, MAX_TRACK_BYTES, 'the bucket refuses at the same size the site does');
assert.deepEqual(
  musicTypes,
  MUSIC_ACCEPT.split(',').filter((type) => type.startsWith('audio/')),
  'and accepts the same audio',
);

assert.match(
  songStoragePath('b5a56c2d-eb6c', 3, '.mp3'),
  /^b5a56c2d-eb6c\/song-v3-\d{14}\.mp3$/,
  'a profile song carries the owner and the version',
);
assert.equal(
  trackStoragePath('../../etc/passwd', 'x.mp3', '.mp3').startsWith('etcpasswd/'),
  true,
  'a nasty id cannot escape the bucket folder rule',
);
assert.equal(
  validateTrackFile({ name: 'a.mp3', type: 'audio/mpeg', size: MAX_TRACK_BYTES + 1 }),
  `TRACKS MUST BE ${Math.round(MAX_TRACK_BYTES / (1024 * 1024))}MB OR SMALLER.`,
);

// Banning: the columns, the helper, the admin-only write, and every policy that has
// to carry the ban check (seventeen writes, plus the two board read policies).
for (const column of ['banned_at timestamptz', "banned_reason text not null default ''", 'banned_by uuid']) {
  assert.ok(SCHEMA.includes(column), `profiles gains ${column.split(' ')[0]}`);
}

assert.match(
  SCHEMA,
  /create or replace function public\.is_banned\(user_id uuid default auth\.uid\(\)\)/,
  'one helper answers both "am I banned" and "is that author banned"',
);
assert.match(SCHEMA, /banned_at is not null/, 'and it reads the stamp');
assert.ok(
  SCHEMA.includes('create policy "profiles moderated by admin"'),
  'only the admin may write a ban',
);

const policyBodies = [...SCHEMA.matchAll(/create policy "([^"]+)"[^;]*;/g)];
const banPolicies = policyBodies.filter((match) => match[0].includes('is_banned('));
// By name: a later section can re-create a policy (the comms ones are), and what
// matters is which policies carry the check, not how many times they were written.
const banPolicyNames = [...new Set(banPolicies.map((match) => match[1]))].sort();
assert.deepEqual(
  banPolicyNames,
  [
    'avatar versions insert own',
    'avatars filed by owner',
    'avatars replaced by owner',
    'comms members added by members',
    'comms messages insert own',
    'comms threads insert by participant',
    'comms threads update by participant',
    'forum_comments insert own',
    'forum_comments readable',
    'forum_comments update own',
    'forum_notifications inserted by actor',
    'forum_threads insert own',
    'forum_threads readable',
    'forum_threads update own',
    'game invites sent by the challenger',
    'lore pages filed by an account',
    'lore pages opened by an account',
    'music folders made by any account',
    'music tracks filed by uploader',
    'profile comments insert',
    'profile tags insert',
    'profiles update own',
    'song versions insert own',
  ],
  'a banned account can write nothing, and what it wrote is hidden',
);
assert.match(
  SCHEMA,
  /create policy "forum_threads readable" on public\.forum_threads\s+for select using \(\(author_id is null or not public\.is_banned\(author_id\)\) or public\.is_admin\(\)\)/,
  'the board hides a banned author from everybody but the admin',
);

// The lore pages are the one table that is deliberately *not* published: their editors merge over a
// broadcast channel rather than over the change feed, so a channel bound to a page cannot go quiet
// because of a table that was never added to the publication.
assert.ok(
  !SCHEMA.includes('alter publication supabase_realtime add table public.lore_pages'),
  'a lore page is not in the realtime publication: its editors use a broadcast channel',
);

// What the picture tab offers: an upload, and the site's own pictures. The tablet
// instructions and the fixed slots are gone, and the site picker has to be there.
const ProfileCustomiserPictureTab = require('./render-out/components/ProfileCustomiserPictureTab.js').default;
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const element = React.createElement;

const {
  SITE_PICTURES,
  PROFILE_PICTURE_SLACK,
} = require('./check-out/profile/avatar-catalogue.js');
const { CONCEPT_SHEETS } = require('./check-out/concepts/sheets.js');

const pictureHtml = renderToStaticMarkup(
  element(ProfileCustomiserPictureTab, {
    profile: { displayName: 'sweden', avatar: { versions: [], currentVersionId: null } },
    pendingSrc: null,
    onSelectSrc: () => undefined,
    note: '',
    onNoteChange: () => undefined,
    onUpload: () => undefined,
    onFileVersion: () => undefined,
    onRestore: () => undefined,
    busy: false,
    uploadMessage: null,
  }),
);

assert.doesNotMatch(pictureHtml, /HAND-DRAWN|SLOTS|DRAW IT ON THE TABLET/, 'the tablet instructions are gone');
// (2026-10-25, SPEC-less-text.md) `UPLOAD A PICTURE (PNG / JPG / WEBP / GIF, UP TO 2MB):` -> `UPLOAD (MAX 2MB):`, and
// `OR PICK ONE OF THE PICTURES ALREADY ON THE SITE (THE MEDIA CATALOGUE):` -> `OR PICK ONE:`.
// (2026-11-04) The colon went from the label, which now sits over its CHOOSE FILE key (ChooseFileKey.tsx).
assert.match(pictureHtml, /UPLOAD \(MAX \d+MB\)/, 'the upload is still the first way in');
assert.match(pictureHtml, /OR PICK ONE:/, 'and the site pictures are the second');
assert.ok(pictureHtml.search(/UPLOAD \(MAX/) < pictureHtml.indexOf('OR PICK ONE:'), 'in that order');
assert.doesNotMatch(pictureHtml, /UPLOAD A PICTURE|PICTURES ALREADY ON THE SITE/, 'in the short wording');
// (2026-10-25, SPEC-less-text.md) The tile's `title={picture.src}` (a file path on hover) is cut, and this used to
// match that tip. The thumbnail itself is read now: the image component carries the path URL-encoded.
assert.ok(pictureHtml.includes(encodeURIComponent('/assets/concepts/concept-sheet-01.png')), 'the sheet on disk is drawn as a thumbnail');
assert.doesNotMatch(pictureHtml, /title="\/assets\/concepts\//, 'without its path as a tip');

assert.equal(SITE_PICTURES.length, 1, 'the concept sheet is offered while its shape fits');
assert.equal(SITE_PICTURES[0].src, CONCEPT_SHEETS[0].src, 'and it is the sheet on disk');
assert.ok(
  Math.abs(SITE_PICTURES[0].width / SITE_PICTURES[0].height - 1) <= PROFILE_PICTURE_SLACK,
  'because it is square enough to be drawn at 1:1',
);

// Sign-up failures are said in the archive's voice: Supabase's own wording leaves a
// visitor with nothing to do, and the worst of them hides that nothing was created.
const { describeSignUpFailure } = require('./supabase-out/auth/failure-messages.js');

assert.match(
  // (2026-10-25, SPEC-less-text.md) `... SO NOTHING WAS CREATED. THE ARCHIVE'S MAIL SERVICE IS BEING SORTED OUT ...`
  // -> `THE CONFIRMATION MAIL FAILED, SO NO ACCOUNT WAS MADE. TRY AGAIN LATER.`
  describeSignUpFailure('Error sending confirmation email'),
  /NO ACCOUNT WAS MADE/,
  'a mail failure says the account was rolled back',
);
assert.match(
  describeSignUpFailure('email rate limit exceeded'),
  /TRY AGAIN SOON/,
  'a project-wide limit is not the visitor\'s fault',
);
assert.match(
  describeSignUpFailure('Email address "x@y.z" is invalid'),
  /CANNOT RECEIVE MAIL/,
  'an address Supabase refuses to mail says why',
);
assert.equal(
  describeSignUpFailure('User already registered'),
  'USER ALREADY REGISTERED',
  'everything else is passed through, uppercased',
);

console.log('supabase checks passed');
console.log('  tables      :', TABLES.length, 'in the import script, all with RLS');
console.log('  columns     :', columns.size, 'named by the repositories, all present');
console.log('  seed        :', 'debaser.site / #000080 via a new-user trigger');
console.log('  moderation  :', 'is_admin() + six policies for the house account');
console.log('  banning     :', `${banPolicyNames.length} policies carry is_banned(), writes refused and posts hidden`);
console.log('  pictures    :', `bucket ${AVATAR_BUCKET}, owner-scoped paths, ${Math.round(bucketLimit / (1024 * 1024))}MB cap, four policies`);
console.log('  music       :', `bucket ${MUSIC_BUCKET}, owner-scoped paths, ${Math.round(musicLimit / (1024 * 1024))}MB cap, four policies, songs per profile`);
