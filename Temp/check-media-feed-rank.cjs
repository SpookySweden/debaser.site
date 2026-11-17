/*
 * MEDIA's default feed, version 2 (SPEC-media-feed-v2.md; Luke, 2026-11-17: "All A"): the profile and the ranker.
 *   npx tsc app/lib/web/feed-rank.ts app/lib/web/feed-profile.ts app/lib/web/title-words.ts app/lib/web/feed-mix.ts --outDir Temp/out-media-feed-rank --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node --strictNullChecks
 *
 * Runs on a saved copy of the real stream (scripts/fixtures/web/feed-v2/stream-2026-11-17.json, public metadata only) with
 * a seeded person like Luke (invented rows in the spirit of his: science explainers played on YouTube, LibriVox, Blender, a
 * skip, old gaming subscriptions, a stray liking for one PeerTube channel), a friend, and a visitor.
 *
 * - words from titles; a played row with no words still teaches; LESS, NOT FOR ME, skips; the profile's out-list
 * - nothing played, finished or skipped in 30 days; NOT FOR ME gone; at most 1 per creator a screen and the next screen
 *   without them; at most 4 per site; 3 new and 2 reading places; at most 2 people's picks; a sent row on screen one
 * - a quantum reading row because of the quantum videos played; why-lines from the fixed templates only, no scores out
 * - a visitor or new person: the balanced sampler (2 per site), no YOUR YOUTUBE
 * - holds still: a late source changes no block already drawn; the same all day, different tomorrow
 * - the page: draws once the history and sign-in are read (no 2.5 s timer on them), drops a confirmed Short, re-ranks on
 *   YouTube's answer
 */
const { join } = require('node:path');
const { readFileSync } = require('node:fs');

const OUT = join(__dirname, 'out-media-feed-rank', 'lib', 'web');
const { rankFeed, fitOf, BLOCK_ROLES, BLOCK_SIZE } = require(join(OUT, 'feed-rank.js'));
const { buildProfile, itemWords, COLD_BELOW } = require(join(OUT, 'feed-profile.js'));
const { titleWords, foldWord } = require(join(OUT, 'title-words.js'));

process.exitCode = 1;
let count = 0;
const fail = (message) => {
  console.log(`FAIL ${message}`);
  process.exit(1);
};
const ok = (condition, message) => {
  if (!condition) fail(message);
  count += 1;
};
const same = (a, b, message) => ok(JSON.stringify(a) === JSON.stringify(b), `${message}\n  got  ${JSON.stringify(a)}\n  want ${JSON.stringify(b)}`);

const NOW = Date.parse('2026-11-17T09:00:00Z');
const DAY = 86_400_000;
const ago = (days) => new Date(NOW - days * DAY).toISOString();

/* ------------------------------------------------------------------ the stream, as saved on 2026-11-17 */
const STREAM = require(join(__dirname, '..', 'scripts', 'fixtures', 'web', 'feed-v2', 'stream-2026-11-17.json')).rows.map((row) => ({
  ...row,
  url: '',
  canonicalUrl: '',
  fetchedAt: ago(0),
  thumbnailUrl: row.thumbnail ? `https://example.org/${row.id}.jpg` : undefined,
}));
ok(STREAM.length >= 200, `the saved stream is there (${STREAM.length} rows)`);
const byId = new Map(STREAM.map((row) => [row.id, row]));
const LIGHTNING = 'internet_archive:lightningconductor_2611_librivox';
const GREASE = 'youtube:xJmovF_l1fY';
const MEDIAEVAL = 'internet_archive:mediaevalfrance_2611_librivox';
const RUST = 'youtube:FbA2Jn-ItMY';
const STAPLEDON = 'internet_archive:lastandfirstmen_2611_librivox';
for (const id of [LIGHTNING, GREASE, MEDIAEVAL, RUST, STAPLEDON]) ok(byId.has(id), `the fixture holds ${id}`);

let n = 0;
const made = (platform, extra = {}) => {
  n += 1;
  return { id: `${platform}:made${n}`, platform, externalId: `made${n}`, kind: 'video', url: '', canonicalUrl: '', title: `Made row ${n}`, publishedAt: ago(1), fetchedAt: ago(0), thumbnailUrl: 'https://example.org/t.jpg', ...extra };
};
const lane = (rows, fromBlock = 0) => ({ rows, fromBlock });

/* ------------------------------------------------------------------ title words */
same(titleWords("Blackbody Radiation and Wien's Law"), ['blackbody', 'radiation', 'wien'], 'title words: lower case, short and common words out');
same(titleWords('HPR4769: Laptop Computer Woes, or How I Learned to'), ['laptop', 'computer', 'woes', 'learned'], 'numbers never become words; short words stay as they are');
ok(foldWord('mechanics') === 'mechanic' && foldWord('stories') === 'story' && foldWord('physics') === 'physic' && foldWord('glass') === 'glass', 'folding meets singular and plural on both sides');
ok(titleWords('The Official Video - Full Episode Live Stream').length === 0, 'platform words teach nothing');
const words = itemWords({ title: 'I finally saw quantum mechanics with my own eyes', tags: ['Quantum Physics'] });
ok(words.get('quantum physic') === 1 && words.get('quantum') === 0.5 && words.get('mechanic') === 0.5, "an item's own tag counts in full, its parts and its title's words half");

/* ------------------------------------------------------------------ the seeded person (like Luke) */
const history = [
  { kind: 'media', ref: 'youtube:q1', title: 'I finally saw quantum mechanics with my own eyes', maker: 'Physics Explained', words: [], action: 'played', firstAt: ago(1), lastAt: ago(1) },
  { kind: 'media', ref: 'youtube:q2', title: 'Compton Effect and Quantum Wavelength', maker: 'The Chem Tutor', words: [], action: 'played', firstAt: ago(2), lastAt: ago(2) },
  { kind: 'media', ref: 'youtube:q3', title: 'Blackbody Radiation and Quantum Physics', maker: 'The Chem Tutor', words: [], action: 'finished', firstAt: ago(5), lastAt: ago(2) },
  { kind: 'media', ref: 'youtube:q4', title: 'Every Level of Consciousness', maker: 'Aperture Mind', words: [], action: 'played', firstAt: ago(3), lastAt: ago(3) },
  { kind: 'media', ref: MEDIAEVAL, title: 'Mediaeval France', maker: 'George Joseph Gustave Masson', words: ['french history', 'medieval era', 'audiobook'], action: 'played', firstAt: ago(4), lastAt: ago(4) },
  { kind: 'media', ref: LIGHTNING, title: 'The Lightning Conductor', maker: 'Charles Norris Williamson; Alice Muriel Williamson', words: [], action: 'played', firstAt: ago(1), lastAt: ago(1) },
  { kind: 'media', ref: GREASE, title: 'Grease Pencil + Performance | Blender Today LIVE #293', maker: 'Blender', words: [], action: 'skipped', firstAt: ago(1), lastAt: ago(1) },
  { kind: 'media', ref: 'youtube:mHrHLqQj7Ts', title: 'Making of: The Blender Open Movies Exhibition', maker: 'Blender', words: ['3d animation', 'documentary'], action: 'played', firstAt: ago(6), lastAt: ago(6) },
  { kind: 'media', ref: RUST, title: 'I Tested CIA Torture Methods on Rust Players', maker: 'Joey', words: [], action: 'not_for_me', firstAt: ago(2), lastAt: ago(2) },
  { kind: 'thread', ref: 't1', title: 'Favourite physics explainers', maker: '', words: [], action: 'read', firstAt: ago(2), lastAt: ago(2) },
  { kind: 'book', ref: 'books:OL1W', title: 'Dune', maker: 'Frank Herbert', words: [], action: 'read', firstAt: ago(3), lastAt: ago(3) },
];
const SIGNALS = {
  history,
  // The stray liking from his diagnosis: an earlier open of one Linux Experiment video in this browser.
  browser: { tags: {}, creators: { 'The Linux Experiment': 2 }, platforms: { peertube: 1 } },
  youtube: {
    channels: ['PewDiePie', 'The Yogscast', 'ashens', 'Civilization'].map((name) => ({ name, outside: 1 })),
    topics: ['Entertainment', 'Video game culture', 'Role-playing video game'],
    playlists: [],
    imported: [],
  },
  presetWords: [],
  letters: [],
  recommended: [],
  queued: [{ ref: 'youtube:room1', title: 'Quantum field theory in a room' }],
  closeness: [{ id: 'p-sweden', closeness: 12 }, { id: 'p-demzou', closeness: 3 }],
  now: NOW,
};
const profile = buildProfile(SIGNALS);

/* ------------------------------------------------------------------ the profile */
ok((profile.words.quantum ?? 0) > 3, `played videos with no words still teach their titles' words (quantum ${profile.words.quantum})`);
ok((profile.makers['the chem tutor'] ?? 0) > (profile.makers['physics explained'] ?? 0), 'finishing counts more than playing');
ok(profile.out.has(LIGHTNING) && profile.out.has(GREASE) && profile.out.has(MEDIAEVAL) && profile.out.has(RUST), 'played, skipped and NOT FOR ME rows are out');
ok((profile.makers.joey ?? 0) < 0, 'NOT FOR ME counts against its maker');
ok((profile.words.physic ?? 0) > 0 && (profile.words.physic ?? 0) < (profile.words.quantum ?? 0), 'a board thread teaches weakly');
ok((profile.words.entertainment ?? 0) === 0.5, 'a YouTube topic counts little: they are broad');
ok(profile.closeness.get('p-sweden') === 1 && profile.closeness.get('p-demzou') === 0.25, 'closeness: the closest person 1');
ok(profile.evidence >= COLD_BELOW, 'a person with a history is not cold');
const replay = buildProfile({ ...SIGNALS, history: [{ ...history[1], firstAt: ago(9), lastAt: ago(2) }] });
const once = buildProfile({ ...SIGNALS, history: [history[1]] });
ok(replay.makers['the chem tutor'] > once.makers['the chem tutor'], 'a replay (first and last time over a day apart) counts more');
const less = buildProfile({ ...SIGNALS, history: [...history, { kind: 'maker', ref: 'blender', title: 'Blender', maker: 'Blender', words: [], action: 'less', firstAt: ago(0), lastAt: ago(0) }] });
ok(less.makers.blender <= -6, 'SHOW LESS FROM THIS CHANNEL sinks its maker');

/* ------------------------------------------------------------------ the inputs */
const READING = [
  { kind: 'longread', item: made('longread', { kind: 'text', outlet: 'QUANTA MAGAZINE', creator: 'E. Writer', title: 'A New Twist in Quantum Entanglement', tags: ['physics'] }) },
  { kind: 'longread', item: made('longread', { kind: 'text', outlet: 'AEON', creator: 'F. Writer', title: 'Why we garden', tags: [] }) },
  { kind: 'paper', item: made('paper', { kind: 'text', outlet: 'ARXIV', creator: 'A. Author', title: 'Gradient tricks for language models', tags: ['artificial intelligence'] }) },
  { kind: 'paper', item: made('paper', { kind: 'text', outlet: 'BIORXIV', creator: 'D. Author', title: 'Mouse cortex mapping', tags: ['neuroscience'] }) },
  ...['BBC NEWS', 'NPR', 'DW'].map((outlet, i) => ({ kind: 'news', item: made('news', { kind: 'text', outlet, title: `Election result ${i}` }) })),
  ...['HACKER NEWS', 'HACKADAY'].map((outlet, i) => ({ kind: 'tech', item: made('tech', { kind: 'text', outlet, creator: `SITE ${i}`, title: `A small tool ${i}` }) })),
];
const QUANTA = READING[0].item.id;
const SHELF = [
  made('youtube', { creator: 'PewDiePie', title: 'Minecraft hardcore day 400' }),
  made('youtube', { creator: 'The Yogscast', title: 'Jingle Jam live' }),
  made('youtube', { creator: 'Physics Explained', title: 'Why quantum tunnelling breaks intuition' }),
  made('youtube', { creator: 'The Chem Tutor', title: 'Photoelectric Effect and Quantum Energy' }),
  made('youtube', { creator: 'Space Time', title: 'What is quantum gravity' }),
];
const DISCOVER = [
  made('internet_archive', { creator: 'Prelinger Archives', title: 'The Atom and You', tags: ['science documentary', 'quantum physics', 'atomic age'] }),
  made('internet_archive', { creator: 'BBC Archive', title: 'Castles of medieval France', tags: ['medieval era', 'castles', 'documentary'] }),
  made('internet_archive', { creator: 'Old Time Radio', title: 'X Minus One: The Map', tags: ['radio drama', 'science fiction'] }),
  made('openverse', { creator: 'NASA', title: 'Saturn from Cassini', tags: ['space', 'astronomy'] }),
];
const PEOPLE = [
  { item: byId.get(STAPLEDON), people: [{ id: 'p-sweden', name: 'sweden' }], how: 'sent' },
  { item: made('peertube', { creator: 'Blender Studio', title: 'Wing It! making of', tags: ['3d animation'] }), people: [{ id: 'p-demzou', name: 'Demzou' }], how: 'recommended' },
  { item: made('internet_archive', { creator: 'Anon Maker', title: 'A public pick' }), people: [{ id: 'anon:1', name: 'ANON' }], how: 'recommended' },
  { item: made('youtube', { creator: 'Room Friend', title: 'Queued in the room' }), people: [{ id: 'p-sweden', name: 'sweden' }], how: 'queued' },
];
function input(over = {}) {
  return {
    pool: STREAM,
    youtube: lane(SHELF),
    reading: lane(READING),
    discover: lane(DISCOVER),
    people: [lane(PEOPLE)],
    visitor: false,
    readingOpens: {},
    profile,
    dropped: () => false,
    now: NOW,
    ...over,
  };
}
const ids = (rows) => rows.map((row) => row.item.id);
const blocks = (rows) => Array.from({ length: Math.ceil(rows.length / BLOCK_SIZE) }, (_, i) => rows.slice(i * BLOCK_SIZE, (i + 1) * BLOCK_SIZE));
const makerOf = (row) => (row.item.creator ?? '').trim().toLowerCase();

const feed = rankFeed(input());
const first = feed.slice(0, 12);
console.log('  first 12 for the seeded person:');
for (const row of first) console.log(`    ${row.lane.padEnd(7)} ${String(row.item.platform).padEnd(16)} ${(row.item.creator ?? '').slice(0, 24).padEnd(24)} ${row.item.title.slice(0, 40).padEnd(40)} | ${row.why}`);

/* ------------------------------------------------------------------ what stays out */
for (const id of [LIGHTNING, GREASE, MEDIAEVAL, RUST]) ok(!feed.some((row) => row.item.id === id), `${id} (played, skipped or NOT FOR ME) is nowhere in the feed`);
ok(new Set(ids(feed)).size === feed.length, 'no row twice');

/* ------------------------------------------------------------------ variety */
const linux = (rows) => rows.filter((row) => row.item.creator === 'The Linux Experiment').length;
ok(linux(first) <= 1, `The Linux Experiment at most once on screen one (${linux(first)}), whatever this browser once opened`);
blocks(feed).forEach((rows, b) => {
  const makers = rows.map(makerOf).filter(Boolean);
  ok(new Set(makers).size === makers.length, `screen ${b + 1}: one row per creator (${makers.join(' / ')})`);
  const sites = {};
  for (const row of rows) sites[row.item.platform] = (sites[row.item.platform] ?? 0) + 1;
  // The site limit gives way only when nothing else is left to fill a place (the stream is mostly one site, so later screens may).
  if (b < 3) ok(Object.values(sites).every((value) => value <= 4), `screen ${b + 1}: at most 4 per site (${JSON.stringify(sites)})`);
  ok(rows.filter((row) => row.lane === 'people').length <= 2, `screen ${b + 1}: at most 2 people's picks`);
  // Sitting out gives way only deep in the feed, when nothing else is left.
  if (b > 0 && b < 8) {
    const before = new Set(blocks(feed)[b - 1].map(makerOf).filter(Boolean));
    ok(!rows.some((row) => before.has(makerOf(row))), `screen ${b + 1}: no creator from the screen before`);
  }
});
ok(first[3].lane === 'reading' && first[9].lane === 'reading' && first.filter((row) => row.lane === 'reading').length === 2, 'two reading places, 4 and 10, never side by side');
same(BLOCK_ROLES.filter((role) => role === 'new').length, 3, '3 new places in 12 (decision 1A)');
ok([2, 6, 11].every((place) => first[place].lane === 'new'), `places 3, 7 and 12 are new to the person (${[2, 6, 11].map((place) => first[place].lane)})`);
ok([2, 6, 11].every((place) => fitOf(first[place].item, profile) < 1 || DISCOVER.some((row) => row.id === first[place].item.id)), 'a new place holds something that does not fit yet, or a DISCOVER find');

/* ------------------------------------------------------------------ relevance */
const sent = first.find((row) => row.item.id === STAPLEDON);
ok(sent !== undefined && sent.lane === 'people' && sent.why === 'SWEDEN SENT YOU THIS' && sent.people[0].id === 'p-sweden', 'a row sent personally is on screen one, saying who sent it, with their face');
ok(first.some((row) => row.item.id === QUANTA && /^BECAUSE YOU (PLAYED|FINISHED) .*QUANTUM/.test(row.why)), 'the quantum long read is on screen one, because of the quantum videos played');
ok(first.some((row) => row.item.creator === 'Physics Explained' || row.item.creator === 'The Chem Tutor'), 'a new video from a channel the person plays here is on screen one');
const pew = feed.findIndex((row) => row.item.creator === 'PewDiePie');
const tutor = feed.findIndex((row) => row.item.creator === 'The Chem Tutor');
ok(tutor >= 0 && (pew === -1 || tutor < pew), 'what the person plays here beats a subscription they never play here');

/* ------------------------------------------------------------------ why-lines */
const TEMPLATE = /^(BECAUSE YOU (PLAYED|FINISHED|READ|OPENED|WANTED MORE LIKE) .+|FROM A CHANNEL YOU WATCH|MORE FROM .+|FITS .+|PICKED FOR TODAY|NEW: NEAR .+|NEW TO YOU|TODAY'S NEWS|A NEW PAPER|A LONG READ FOR TODAY|IN TECH TODAY|.+ SENT YOU THIS|SENT TO YOU|QUEUED IN A ROOM YOU JOINED|RECOMMENDED HERE|ON NOW|.+ RECOMMENDED THIS)$/;
for (const row of feed.slice(0, 48)) ok(TEMPLATE.test(row.why), `why-line in plain words from the fixed list: "${row.why}"`);
for (const row of feed.slice(0, 48)) {
  const own = `${row.why}`.replace(/^BECAUSE YOU \S+ /, '').replace(/^(MORE FROM|FITS|NEW: NEAR) /, '');
  ok(!/\d/.test(own) || history.some((h) => h.title.toUpperCase().startsWith(own.replace(/\.\.\.$/, ''))) || /\d/.test(row.item.creator ?? ''), `no number in a why-line except inside a title: "${row.why}"`);
}
{
  // Found in review: a pick whose person came with a blank name read " RECOMMENDED THIS".
  const blank = rankFeed(input({ people: [lane([{ item: made('peertube', { creator: 'Blank Name Maker', title: 'A pick by a blank name' }), people: [{ id: 'p-blank', name: '' }], how: 'recommended' }])] }));
  const row = blank.find((one) => one.item.creator === 'Blank Name Maker');
  ok(row !== undefined && row.why === 'RECOMMENDED HERE', `a person with no name is not named (${row && row.why})`);
}
ok(feed.every((row) => Object.keys(row).every((key) => ['item', 'lane', 'why', 'block', 'kind', 'people'].includes(key))), 'nothing but the row, its lane, its why and its people leaves the ranker (no scores)');

/* ------------------------------------------------------------------ visitor and new person: the sampler */
const coldProfile = buildProfile({ ...SIGNALS, history: [], browser: { tags: {}, creators: {}, platforms: {} }, youtube: null, closeness: [] });
ok(coldProfile.evidence < COLD_BELOW, 'nothing to go on is cold');
const visitorFeed = rankFeed(input({ profile: coldProfile, visitor: true, people: [lane(PEOPLE.filter((row) => row.how === 'recommended').map((row) => ({ ...row, people: [{ id: 'anon:x', name: 'ANON' }] })))] }));
ok(!visitorFeed.some((row) => row.lane === 'youtube'), 'a visitor gets no YOUR YOUTUBE rows');
blocks(visitorFeed).slice(0, 3).forEach((rows, b) => {
  const sites = {};
  for (const row of rows) if (row.lane !== 'reading') sites[row.item.platform] = (sites[row.item.platform] ?? 0) + 1;
  ok(Object.values(sites).every((value) => value <= 2) && Object.keys(sites).length >= 4, `sampler screen ${b + 1}: at most 2 per site, 4 sites or more (${JSON.stringify(sites)})`);
});
ok(visitorFeed.slice(0, 12).filter((row) => row.lane === 'reading').length === 2, 'the sampler keeps its 2 reading rows');
ok(visitorFeed.slice(0, 12).every((row) => ['PICKED FOR TODAY', 'RECOMMENDED HERE', "TODAY'S NEWS", 'A NEW PAPER', 'A LONG READ FOR TODAY', 'IN TECH TODAY', 'ON NOW'].includes(row.why)), 'a visitor is told no one\'s name and no history');
ok(visitorFeed.slice(0, 12).filter((row) => row.lane !== 'reading' && row.item.thumbnailUrl).length >= 9, 'the sampler puts pictured rows first');

/* ------------------------------------------------------------------ NOT FOR ME pressed now, Shorts, duplicates */
const pressed = first[0].item.id;
const after = rankFeed(input({ dropped: (item) => item.id === pressed }));
ok(!after.some((row) => row.item.id === pressed), 'NOT FOR ME pressed this visit takes the row out at once');
const short = made('youtube', { creator: 'Physics Explained', title: 'Quantum in 30 seconds', durationSeconds: 30 });
const long = made('youtube', { creator: 'Physics Explained', title: 'Quantum in 30 minutes', durationSeconds: 1800 });
const shorts = rankFeed(input({ youtube: lane([short, long, ...SHELF.filter((row) => row.creator !== 'Physics Explained')]) }));
ok(shorts.findIndex((row) => row.item.id === long.id) < shorts.findIndex((row) => row.item.id === short.id) || !shorts.some((row) => row.item.id === short.id), 'a YouTube Short sinks below the same channel\'s full video');
const twice = rankFeed(input({ youtube: lane([STREAM[5], ...SHELF]) }));
ok(twice.filter((row) => row.item.id === STREAM[5].id).length <= 1, 'a row in two sources shows once');

/* ------------------------------------------------------------------ holds still */
same(ids(rankFeed(input())), ids(feed), 'the same visit gives the same list');
for (const late of ['discover', 'people', 'youtube', 'reading']) {
  const before = rankFeed(input({ [late]: late === 'people' ? [] : null }));
  const later = rankFeed(input({ [late]: late === 'people' ? [lane(PEOPLE, 2)] : lane(input()[late].rows, 2) }));
  same(ids(later.slice(0, 24)), ids(before.slice(0, 24)), `${late} arriving late (from screen 3) changes nothing on screens 1 and 2`);
}
{
  // Found in the mock drive: a small stream ran out before DISCOVER answered, the feed ended, and the late source never joined.
  const small = { pool: STREAM.slice(0, 6), youtube: null, people: [] };
  const early = rankFeed(input({ ...small, discover: null }));
  const lastBlock = early.length === 0 ? 0 : early[early.length - 1].block + 1;
  const joined = rankFeed(input({ ...small, discover: lane(DISCOVER, lastBlock) }));
  same(ids(joined.slice(0, early.length)), ids(early), 'a short feed: what was drawn stays put when a late source arrives');
  ok(joined.slice(early.length).some((row) => DISCOVER.some((one) => one.id === row.item.id)) && joined.slice(early.length).every((row) => row.block >= lastBlock), 'and the late source joins below it, even though the stream had run out');
}
/* ------------------------------------------------------------------ lives (SPEC-live-streams.md, merged 2026-11-17) */
{
  const LIVES = [
    made('twitch', { creator: 'Physics Explained', title: 'Live: quantum questions answered', live: true }),
    made('twitch', { creator: 'Physics Explained', title: 'A second stream from the same channel', live: true }),
    made('youtube', { creator: 'Space Live', title: 'Rocket launch live', live: true }),
    made('twitch', { creator: 'Speedrunner', title: 'Any% world record attempts', live: true }),
  ];
  const opened = { ...LIVES[2] };
  const withLives = rankFeed(input({ live: lane(LIVES), profile: buildProfile({ ...SIGNALS, history: [...history, { kind: 'media', ref: opened.id, title: opened.title, maker: 'Space Live', words: [], action: 'played', firstAt: ago(1), lastAt: ago(1) }] }) }));
  const screens = blocks(withLives);
  ok(screens.slice(0, 3).every((rows) => rows[4].lane === 'live'), `place 5 of each screen is LIVE while lives last (${screens.slice(0, 3).map((rows) => rows[4].lane)})`);
  ok(screens.every((rows) => rows.filter((row) => row.lane === 'live').length <= 1), 'at most one live a screen');
  ok(withLives.some((row) => row.item.id === opened.id), 'a live is offered even though its channel was played lately');
  ok(withLives.filter((row) => row.lane === 'live' && row.item.creator === 'Physics Explained').length >= 1 && screens.every((rows) => rows.filter((row) => row.item.creator === 'Physics Explained').length <= 1), 'a live keeps to one row per creator a screen');
  ok(withLives.filter((row) => row.lane === 'live').every((row) => TEMPLATE.test(row.why)), 'a live says why in plain words');
  const noLives = rankFeed(input());
  ok(noLives[4].lane !== 'live', 'with no lives, place 5 is like what you play');
  const turnedDown = rankFeed(input({ live: lane(LIVES), dropped: (item) => item.id === LIVES[0].id }));
  ok(!turnedDown.some((row) => row.item.id === LIVES[0].id), 'a live turned down (NOT FOR ME) stays out');
  const before = rankFeed(input({ live: null }));
  const later = rankFeed(input({ live: lane(LIVES, 2) }));
  same(ids(later.slice(0, 24)), ids(before.slice(0, 24)), 'lives arriving late (from screen 3) change nothing on screens 1 and 2');
}

ok(feed.every((row, i) => i === 0 || row.block >= feed[i - 1].block), 'rows carry their screen, in order');
ok(blocks(feed).slice(0, -1).every((rows, b) => rows.every((row) => row.block === b)), 'every screen but the last is a whole 12');

const tomorrow = rankFeed(input({ now: NOW + DAY, profile: buildProfile({ ...SIGNALS, now: NOW + DAY }) }));
ok(JSON.stringify(ids(tomorrow.slice(0, 12))) !== JSON.stringify(ids(first)), 'tomorrow is a different list');

/* ------------------------------------------------------------------ the page */
{
  const page = readFileSync(join(__dirname, '..', 'app', 'components', 'WebStream.tsx'), 'utf8');
  const call = page.match(/rankFeed<WebStreamItem>\(\{[\s\S]*?\r?\n {4}\}\);[\s\S]{0,400}?\r?\n {2}\}, \[([^\]]*)\]\);/);
  ok(call !== null, 'the page ranks the default feed with rankFeed');
  ok(call && /dropped: \(item\) => [^\n]*hiddenShortNow\(item\)/.test(call[0]), 'the feed drops a Short YouTube has confirmed (hiddenShortNow)');
  ok(call && /\bshortsSeen\b/.test(call[1]), 'and ranks again when YouTube answers (shortsSeen)');
  ok(!/setTimeout\(\(\) => setMixGate\(true\), 2500\)/.test(page), 'the first screen no longer gives up on the history after 2.5 seconds');
  ok(/mixGate[^\n]*history !== null/.test(page) || /history !== null[^\n]*mixGate/.test(page), 'the first screen waits for the history');
}

console.log(`check-media-feed-rank: ${count} passed`);
process.exitCode = 0;
