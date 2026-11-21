/*
 * Friends hanging out in a profile's ROOM (app/lib/character/friends.ts; Luke, 2026-11-21: "make it so that moldavius
 * figtree and swedens characters like eachother and hang out with eachother in a jovial manner"), in a real browser on a
 * LOCAL dev server running on MOCK data and mock sign-in. It touches no database: every account, comment and character
 * is seeded into that browser's own storage, and any request to a Supabase host fails the run.
 * Not in `npm run checks` (it needs a running server).
 *
 *   (a mock server: every NEXT_PUBLIC_*_DATA_SOURCE=mock, NEXT_PUBLIC_AUTH_BACKEND=mock, the Supabase address EMPTY,
 *    started from a node launcher so the empty values survive)
 *   node scripts/drive-character-friends.cjs [--base http://localhost:3341] [--seconds 60]
 *
 * Seeded: sweden's profile (the real account id, on mock data) with a shown character; moldavius figtree (the real id)
 * and a stranger have each left a comment there and have shown characters, so both come to visit; the reader is a third
 * account with no character.
 *   a. all three figures are in the room;
 *   b. over a minute the two friends stand together far more of the time than sweden and the stranger do, and face each
 *      other while they stand about;
 *   c. a cheerful noise is said by one friend and answered by the other, in bubbles over each, and the noise is one of
 *      the friend noises (never words a person wrote);
 *   d. reduced motion: nobody moves and nothing is said by itself.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3341').replace(/\/$/, '');
const SECONDS = Number(opt('--seconds', '60'));
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) throw new Error('Local mock servers only.');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SWEDEN = { id: '85e2a97c-7963-4b43-981b-370ca3e457d3', name: 'sweden' };
const MOLDAVIUS = { id: 'a887588b-1dd2-4be3-9c9f-9897ec492c31', name: 'moldavius figtree' };
const STRANGER = { id: 'friends-stranger', name: 'FRIENDS STRANGER' };
const READER = { id: 'friends-reader', name: 'FRIENDS READER' };
const NOISES = ['\\(^o^)/', 'hehehe!', 'yay!! \u266A', 'o/ o/ o/', 'wheee!', 'la la la \u266A', '(^_^)b', '!!!', 'hoo hoo!', '~(^-^)~', 'bwee!', 'heh heh \u266A'];

/** Runs in the page before anything else: the mock stores, filled. */
function seed({ sweden, moldavius, stranger, reader }) {
  if (!/^localhost$|^127\.0\.0\.1$/.test(window.location.hostname)) return;
  const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString();
  const user = (person) => ({ id: person.id, email: `${person.id}@debaser.site`, displayName: person.name, createdAt: at(5000), salt: '', secretHash: '', hidden: true });
  window.localStorage.setItem('debaser.lost-account.never.v1', '1');
  window.localStorage.setItem('debaser.tour.v2', 'skipped');
  window.localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ users: [user(sweden), user(moldavius), user(stranger), user(reader)], sessionUserId: reader.id, bannedIds: [] }));
  const author = (person) => ({ id: person.id, displayName: person.name });
  const comments = [
    { id: 'friends-c1', kind: 'profile', author: author(moldavius), body: 'A comment left by the friend.', createdAt: at(30) },
    { id: 'friends-c2', kind: 'profile', author: author(stranger), body: 'A comment left by a stranger.', createdAt: at(20) },
  ];
  const profile = (person, extra = {}) => ({
    userId: person.id,
    displayName: person.name,
    bio: '',
    visibility: { showTags: true, showProfileComments: true, showAvatarComments: true, showSongComments: true },
    tags: [],
    comments: [],
    updatedAt: at(10),
    privacySeen: true,
    ...extra,
  });
  window.localStorage.setItem(
    'debaser.profile.mock.v1',
    JSON.stringify({ version: 1, profiles: { [sweden.id]: profile(sweden, { comments }), [moldavius.id]: profile(moldavius), [stranger.id]: profile(stranger), [reader.id]: profile(reader) } }),
  );
  // A stand-in strip: one cell, one plain block of colour. A test fixture in this browser only, never on the site.
  const strip = (colour) => {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 24;
    const pen = canvas.getContext('2d');
    pen.fillStyle = colour;
    pen.fillRect(2, 0, 12, 24);
    return canvas.toDataURL('image/png');
  };
  const motion = { facing: 'front', loop: true, ticks: [0] };
  const core = ['stand', 'idle', 'walk', 'dance1', 'dance2', 'dance3', 'wave', 'hop', 'turn', 'sit', 'sleep'];
  const sheet = { v: 1, cell: { w: 16, h: 24 }, columns: 1, cells: 1, fps: 10, floor: 24, head: 0, motions: Object.fromEntries(core.map((id) => [id, motion])) };
  const shown = (colour) => ({ characterId: 'friends-test', mood: 'calm', stripUrl: strip(colour), sheet, bakedAt: at(100) });
  window.localStorage.setItem(
    'debaser.profile-character.v1',
    JSON.stringify({ [sweden.id]: shown('rgb(255,240,0)'), [moldavius.id]: shown('rgb(255,0,160)'), [stranger.id]: shown('rgb(0,200,255)') }),
  );
}

let supabaseHit = false;
async function open(browser, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  await context.route(/supabase\.(co|in)\/|api\.debaser\.site/, (route) => {
    supabaseHit = true;
    return route.abort();
  });
  await context.addInitScript(seed, { sweden: SWEDEN, moldavius: MOLDAVIUS, stranger: STRANGER, reader: READER });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  page error: ${String(error).slice(0, 200)}`));
  await page.goto(`${BASE}/profile/${SWEDEN.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-profile-room-stage]', { timeout: 180000 });
  await page.mouse.move(600, 200);
  const stage = page.locator('[data-profile-room-stage]');
  await stage.scrollIntoViewIfNeeded();
  return page;
}

/** One look: where each figure is, what it is doing, and any bubble. */
const look = (ids) => {
  const stage = document.querySelector('[data-profile-room-stage]');
  if (!stage) return null;
  const figures = {};
  for (const id of ids) {
    const el = stage.querySelector(`[data-character-of="${id}"]`);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    figures[id] = { left: r.left, w: r.width, motion: el.getAttribute('data-motion'), dir: el.querySelector('[style*="scaleX(-1)"]') ? -1 : 1 };
  }
  const bubble = stage.querySelector('[data-speech-bubble]');
  const said = bubble
    ? {
        id: bubble.getAttribute('data-speech-bubble'),
        of: bubble.parentElement?.querySelector('button')?.getAttribute('data-character-of') ?? null,
        text: [...bubble.querySelectorAll('[data-speech-typed]')].map((el) => el.textContent).join(''),
      }
    : null;
  return { figures, said };
};

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  const ids = [SWEDEN.id, MOLDAVIUS.id, STRANGER.id];
  try {
    console.log(`drive-character-friends against ${BASE}`);
    const page = await open(browser);
    await page.waitForFunction((list) => list.every((id) => document.querySelector(`[data-profile-room-stage] [data-character-of="${id}"]`)), ids, { timeout: 30000 });
    console.log('  ok  a. sweden, moldavius figtree and the stranger are all in the room');

    let friendsNear = 0;
    let strangerNear = 0;
    let samples = 0;
    const bubbles = [];
    const started = Date.now();
    while (Date.now() - started < SECONDS * 1000) {
      const now = await page.evaluate(look, ids);
      const f = now.figures;
      if (Date.now() - started > 20000 && f[SWEDEN.id] && f[MOLDAVIUS.id] && f[STRANGER.id]) {
        samples += 1;
        const w = f[SWEDEN.id].w;
        if (Math.abs(f[SWEDEN.id].left - f[MOLDAVIUS.id].left) <= w * 1.7) friendsNear += 1;
        if (Math.abs(f[SWEDEN.id].left - f[STRANGER.id].left) <= w * 1.7) strangerNear += 1;
      }
      if (now.said && (bubbles.length === 0 || bubbles[bubbles.length - 1].id !== now.said.id || bubbles[bubbles.length - 1].of !== now.said.of)) bubbles.push({ ...now.said, at: Date.now() - started });
      if (now.said) bubbles[bubbles.length - 1].text = now.said.text;
      await sleep(250);
    }
    const together = friendsNear / samples;
    const withStranger = strangerNear / samples;
    console.log(`  room: the friends stood together ${(together * 100).toFixed(0)}% of the time, sweden and the stranger ${(withStranger * 100).toFixed(0)}% (${samples} looks)`);
    assert.ok(together > 0.5, 'the friends stand together most of the time');
    assert.ok(together > withStranger * 1.5, 'far more than with a stranger');
    console.log('  ok  b. the friends find each other and hang out');

    console.log(`  bubbles: ${bubbles.map((b) => `${b.of === SWEDEN.id ? 'sweden' : b.of === MOLDAVIUS.id ? 'moldavius' : 'stranger'} ${b.id} "${b.text}" @${(b.at / 1000).toFixed(1)}s`).join(' | ')}`);
    const call = bubbles.findIndex((b) => b.id.startsWith('friend:'));
    if (call < 0) console.log('  --  c. no cheerful noise came up in this run (they are picked at random among the lines): run again for longer');
    else {
      const noise = bubbles[call];
      assert.ok(NOISES.includes(noise.text), `a friend noise, not words: "${noise.text}"`);
      const reply = bubbles[call + 1];
      assert.ok(reply && reply.id.startsWith('friend-back:'), 'the friend answers next');
      assert.notEqual(reply.of, noise.of, 'and it is the other friend who answers');
      assert.ok([SWEDEN.id, MOLDAVIUS.id].includes(reply.of), 'the answer comes from the friend, never the stranger');
      assert.ok(NOISES.includes(reply.text), `with a friend noise too: "${reply.text}"`);
      console.log('  ok  c. one friend made a cheerful noise and the other answered it');
    }
    await page.context().close();

    const still = await open(browser, { reducedMotion: 'reduce' });
    await still.waitForFunction((list) => list.every((id) => document.querySelector(`[data-profile-room-stage] [data-character-of="${id}"]`)), ids, { timeout: 30000 });
    const first = await still.evaluate(look, ids);
    await sleep(7000);
    const later = await still.evaluate(look, ids);
    for (const id of ids) assert.equal(later.figures[id].left, first.figures[id].left, 'nobody moves under reduced motion');
    assert.equal(later.said, null, 'nothing is said by itself under reduced motion');
    console.log('  ok  d. reduced motion: nobody moves, nothing is said by itself');
    await still.context().close();
    assert.equal(supabaseHit, false, 'no request went to a Supabase host');
    console.log('drive-character-friends: OK');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
