/*
 * Friends kissing now and then, with hearts (app/lib/character/friends.ts; Luke, 2026-11-22: "Make it so that moldsvius
 * figtree and Sweden's characters kiss sometimes with hearts and cutely"), in a real browser on a LOCAL dev server running
 * on MOCK data and mock sign-in. It touches no database: every account, comment and character is seeded into that
 * browser's own storage, the friend in the stream room is said onto the mock room's own wire (a BroadcastChannel), and
 * any request to a Supabase host fails the run. Not in `npm run checks` (it needs a running server, and minutes).
 *
 *   (a mock server: every NEXT_PUBLIC_*_DATA_SOURCE=mock, NEXT_PUBLIC_AUTH_BACKEND=mock, the Supabase address EMPTY,
 *    started from a node launcher so the empty values survive)
 *   node scripts/drive-character-kiss.cjs [--base http://localhost:3318] [--plain] [--only room|strip|still]
 *
 * Both friends wear GUY, baked by the dev workbench's own bake (needs WebGL: swiftshader), unless `--plain` (a stand-in
 * block). Real account ids for sweden and moldavius figtree, on mock data. A kiss comes 20 to 70 seconds after two friends
 * stand together, so each part waits up to 100 seconds for one.
 *   a. ROOM (sweden's profile; moldavius figtree and a stranger commented, so both visit): the two friends step in, then
 *      lean in on the same tick, facing each other, boxes overlapping, each sheared by a plain matrix; text hearts (♥) rise
 *      in the ROOM; after it the left one hops and the right one cheers; the stranger never kisses.
 *   b. strip (a stream room, the reader is sweden, moldavius figtree's companion on the wire): sweden's companion walks
 *      over, tells the room `kiss` at the moment, leans in with hearts; moldavius's figure, told `kiss` on the wire, leans
 *      in too, toward sweden's.
 *   c. reduced motion, ROOM and strip: nobody moves or leans and no hearts rise; a still ♥ over each friend instead.
 * Screenshots in Temp/browse/kiss/.
 */
const assert = require('node:assert/strict');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright-core');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3318').replace(/\/$/, '');
const ONLY = opt('--only', null);
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) throw new Error('Local mock servers only.');
const SHOTS = join('Temp', 'browse', 'kiss');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const WAIT_MS = 100_000;
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

const SWEDEN = { id: '85e2a97c-7963-4b43-981b-370ca3e457d3', name: 'sweden' };
const MOLDAVIUS = { id: 'a887588b-1dd2-4be3-9c9f-9897ec492c31', name: 'moldavius figtree' };
const STRANGER = { id: 'kiss-stranger', name: 'KISS STRANGER' };
const READER = { id: 'kiss-reader', name: 'KISS READER' };

/** Runs in the page before anything else: the mock stores, filled, and an ear on a stream room's wire. */
function seed({ sweden, moldavius, stranger, reader, as, shownOf }) {
  if (!/^localhost$|^127\.0\.0\.1$/.test(window.location.hostname)) return;
  const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString();
  const user = (person) => ({ id: person.id, email: `${person.id}@debaser.site`, displayName: person.name, createdAt: at(5000), salt: '', secretHash: '', hidden: true });
  window.localStorage.setItem('debaser.lost-account.never.v1', '1');
  window.localStorage.setItem('debaser.tour.v2', 'skipped');
  window.localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ users: [user(sweden), user(moldavius), user(stranger), user(reader)], sessionUserId: as, bannedIds: [] }));
  const author = (person) => ({ id: person.id, displayName: person.name });
  const comments = [
    { id: 'kiss-c1', kind: 'profile', author: author(moldavius), body: 'A comment left by the friend.', createdAt: at(30) },
    { id: 'kiss-c2', kind: 'profile', author: author(stranger), body: 'A comment left by a stranger.', createdAt: at(20) },
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
  if (shownOf !== null) window.localStorage.setItem('debaser.profile-character.v1', JSON.stringify(shownOf));
  const ear = new BroadcastChannel('debaser-watch');
  window.__kissHeard = [];
  ear.onmessage = (event) => {
    const data = event.data;
    if (data && data.type === 'here' && data.member && data.member.userId === as) {
      window.__kissRoom = data.roomId;
      if (data.companion && data.companion.k === 'kiss') window.__kissHeard.push({ r: data.companion.r, at: Date.now() });
    }
  };
}

/** A stand-in strip (`--plain`): one cell, one plain block of colour. A test fixture in this browser only. */
function plainShown(colour) {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 24;
  const pen = canvas.getContext('2d');
  pen.fillStyle = colour;
  pen.fillRect(4, 0, 8, 24);
  const motion = { facing: 'side', loop: true, ticks: [0] };
  const core = ['stand', 'idle', 'walk', 'dance1', 'dance2', 'dance3', 'wave', 'hop', 'turn', 'sit', 'sleep'];
  const sheet = { v: 1, cell: { w: 16, h: 24 }, columns: 1, cells: 1, fps: 10, floor: 24, head: 0, motions: Object.fromEntries(core.map((id) => [id, motion])) };
  return { characterId: 'kiss-test', mood: 'calm', stripUrl: canvas.toDataURL('image/png'), sheet, bakedAt: new Date(Date.now() - 6e6).toISOString() };
}

let supabaseHit = false;
async function open(browser, { as, shownOf, reduced = false }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await context.route(/supabase\.(co|in)\/|api\.debaser\.site/, (route) => {
    supabaseHit = true;
    return route.abort();
  });
  await context.addInitScript(seed, { sweden: SWEDEN, moldavius: MOLDAVIUS, stranger: STRANGER, reader: READER, as, shownOf });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  page error: ${String(error).slice(0, 200)}`));
  return page;
}

async function clearPrivacyWindow(page) {
  const close = page.locator('[data-dock-window="privacy-first-look"]').getByRole('button', { name: /^Close / });
  if ((await close.count()) > 0) await close.first().click().catch(() => undefined);
}

/** GUY, baked by the dev workbench's own bake (the SHOW key's), as sweden on sweden's own profile. */
async function bakeGuy(browser) {
  const page = await open(browser, { as: SWEDEN.id, shownOf: null });
  await page.goto(`${BASE}/profile/${SWEDEN.id}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.mouse.move(700, 300);
  await sleep(2500);
  await clearPrivacyWindow(page);
  await page.getByRole('button', { name: '[ EDIT PROFILE ]' }).first().click({ timeout: 120000 });
  await page.getByRole('button', { name: /\[ CHAR/ }).click({ timeout: 120000 });
  await page.waitForFunction(() => window.__characterBakeProof !== undefined, null, { timeout: 180000 });
  const baked = await page.evaluate(async () => {
    const hook = window.__characterBakeProof;
    hook.applyPreset('guy');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const made = await hook.bakeCharacter(hook.figure(), 'guy');
    const stripUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(made.strip);
    });
    return { stripUrl, sheet: made.sheet };
  });
  await page.context().close();
  return { characterId: 'kiss-guy', mood: 'calm', stripUrl: baked.stripUrl, sheet: baked.sheet, bakedAt: new Date().toISOString() };
}

/** One look at the ROOM: each figure's box, motion, kiss stage, transform, and the hearts and still hearts in it. */
const roomLook = (ids) => {
  const stage = document.querySelector('[data-profile-room-stage]');
  if (!stage) return null;
  const figures = {};
  for (const id of ids) {
    const el = stage.querySelector(`[data-character-of="${id}"]`);
    if (!el) continue;
    const box = el.parentElement.getBoundingClientRect();
    const still = el.parentElement.querySelector('[data-kiss-still]');
    figures[id] = {
      left: Math.round(box.left),
      w: Math.round(box.width),
      motion: el.getAttribute('data-motion'),
      kiss: el.getAttribute('data-kiss'),
      transform: el.style.transform || '',
      dir: el.querySelector('[style*="scaleX(-1)"]') ? -1 : 1,
      still: still ? still.textContent : null,
    };
  }
  const hearts = [...stage.querySelectorAll('[data-note-trail="hearts"] span')].map((el) => el.textContent);
  return { figures, hearts, at: Date.now() };
};

/** One look at the strip: each companion's place, kiss, body transform, hearts and mark. */
const stripLook = (ids) => {
  const out = {};
  for (const id of ids) {
    const place = document.querySelector(`[data-companion-strip] [data-companion-of="${id}"]`);
    if (!place || place.style.visibility !== 'visible') continue;
    const body = place.querySelector('[data-companion-figure]') ?? place.querySelector('span[style*="background"]');
    const mark = place.querySelector('[data-companion-mark]');
    out[id] = {
      x: Number(place.dataset.x),
      motion: place.dataset.motion,
      facing: place.dataset.facing,
      kiss: place.dataset.kiss ?? null,
      transform: body ? body.style.transform : '',
      hearts: [...place.querySelectorAll('[data-note-trail="hearts"] span')].map((el) => el.textContent),
      mark: mark && mark.style.visibility === 'visible' ? mark.textContent : null,
    };
  }
  return { figures: out, at: Date.now() };
};

async function roomPart(browser, shownOf) {
  const ids = [SWEDEN.id, MOLDAVIUS.id, STRANGER.id];
  const page = await open(browser, { as: READER.id, shownOf });
  await page.goto(`${BASE}/profile/${SWEDEN.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-profile-room-stage]', { timeout: 180000 });
  await page.mouse.move(600, 200);
  await page.locator('[data-profile-room-stage]').scrollIntoViewIfNeeded();
  await page.waitForFunction((list) => list.every((id) => document.querySelector(`[data-profile-room-stage] [data-character-of="${id}"]`)), ids, { timeout: 30000 });
  const started = Date.now();
  const looks = [];
  let shot = false;
  while (Date.now() - started < WAIT_MS) {
    const now = await page.evaluate(roomLook, ids);
    looks.push(now);
    const f = now.figures;
    if (looks.length % 100 === 0 && f[SWEDEN.id] && f[MOLDAVIUS.id]) {
      console.log(`      ${((Date.now() - started) / 1000).toFixed(0)} s: sweden's at ${f[SWEDEN.id].left} (${f[SWEDEN.id].motion}), moldavius's at ${f[MOLDAVIUS.id].left} (${f[MOLDAVIUS.id].motion}), ${f[SWEDEN.id].w} wide`);
    }
    if (!shot && f[SWEDEN.id]?.kiss === 'lean' && f[MOLDAVIUS.id]?.kiss === 'lean' && now.hearts.length > 0) {
      await page.locator('[data-profile-room]').screenshot({ path: join(SHOTS, 'a-room-lean.png') });
      shot = true;
    }
    // Over: both back to plain after leaning.
    const leaned = looks.some((one) => one.figures[SWEDEN.id]?.kiss === 'lean');
    if (leaned && f[SWEDEN.id]?.kiss === null && f[MOLDAVIUS.id]?.kiss === null) {
      for (let more = 0; more < 6; more += 1) {
        await sleep(100);
        looks.push(await page.evaluate(roomLook, ids));
      }
      break;
    }
    await sleep(100);
  }
  const went = looks.find((one) => one.figures[SWEDEN.id]?.kiss === 'go');
  assert.ok(went, `a kiss started in the ROOM within ${WAIT_MS / 1000} s`);
  console.log(`      the kiss started ${((went.at - started) / 1000).toFixed(1)} s after the ROOM opened`);
  const leanOf = (id) => looks.find((one) => one.figures[id]?.kiss === 'lean');
  const a = leanOf(SWEDEN.id);
  const b = leanOf(MOLDAVIUS.id);
  assert.ok(a && b, 'both friends lean in');
  assert.ok(Math.abs(a.at - b.at) <= 150, `on the same tick (${Math.abs(a.at - b.at)} ms apart)`);
  const peak = looks.filter((one) => one.figures[SWEDEN.id]?.kiss === 'lean' && one.figures[MOLDAVIUS.id]?.kiss === 'lean');
  assert.ok(peak.length >= 5, `leaning together for a moment (${peak.length} looks)`);
  const mid = peak[Math.floor(peak.length / 2)];
  const [left, right] = [mid.figures[SWEDEN.id], mid.figures[MOLDAVIUS.id]].sort((p, q) => p.left - q.left);
  assert.equal(left.dir, 1, 'the left one faces right, toward its friend');
  assert.equal(right.dir, -1, 'the right one faces left, toward its friend');
  assert.ok(right.left - left.left < left.w, `boxes overlapping, close enough to kiss (${right.left - left.left} px apart, ${left.w} wide)`);
  assert.ok(/^matrix\(1, 0, -0\.\d+, 1, 0, 0\)$/.test(left.transform), `the left one sheared toward its friend: ${left.transform}`);
  assert.ok(/^matrix\(1, 0, 0\.\d+, 1, 0, 0\)$/.test(right.transform), `the right one sheared toward its friend: ${right.transform}`);
  assert.ok(mid.hearts.length > 0 && mid.hearts.every((glyph) => glyph === '♥'), `text hearts rise between them (${mid.hearts.join('')})`);
  assert.ok(looks.every((one) => !one.figures[STRANGER.id]?.kiss), 'the stranger never kisses');
  pass(`a. ROOM: the friends stepped in, leaned in together facing each other (${right.left - left.left} px apart), sheared, hearts rising: ${shot ? 'Temp/browse/kiss/a-room-lean.png' : 'no screenshot'}`);
  const end = looks[looks.length - 1].figures;
  const leftEnd = end[SWEDEN.id].left < end[MOLDAVIUS.id].left ? end[SWEDEN.id] : end[MOLDAVIUS.id];
  const rightEnd = leftEnd === end[SWEDEN.id] ? end[MOLDAVIUS.id] : end[SWEDEN.id];
  assert.equal(leftEnd.motion, 'hop', 'after it the left one hops');
  assert.equal(rightEnd.motion, 'cheer', 'and the right one cheers');
  assert.equal(leftEnd.transform, '', 'upright again');
  pass('a. ROOM: after the kiss the left one hops and the right one cheers, upright again');
  await page.context().close();
}

/** The reader goes live in a stream room (as in drive-one-character.cjs); moldavius's companion joins on the wire. */
async function streamRoom(page, me) {
  await page.goto(`${BASE}/stream`, { waitUntil: 'domcontentloaded' });
  await page.mouse.move(600, 200);
  await page.getByRole('button', { name: /GO LIVE|BACK TO YOUR ROOM/ }).first().click({ timeout: 120000 });
  await sleep(500);
  const startKey = page.locator('[data-go-live-start]');
  if ((await startKey.count()) > 0) await startKey.click();
  await page.waitForFunction(
    (id) => (JSON.parse(window.localStorage.getItem('debaser.watch.v1') ?? '{"rooms":[]}').rooms ?? []).some((room) => room.hostId === id && room.endedAt === null),
    me,
    { timeout: 60000 },
  );
  const roomId = await page.evaluate((id) => JSON.parse(window.localStorage.getItem('debaser.watch.v1')).rooms.find((room) => room.hostId === id && room.endedAt === null).id, me);
  await page.evaluate(() => {
    const key = [...document.querySelectorAll('button')].find((button) => /GO LIVE/.test(button.textContent ?? '') && /WHO CAN JOIN/.test(button.parentElement?.parentElement?.textContent ?? ''));
    key?.click();
  });
  await sleep(800);
  await page.keyboard.press('Escape');
  // Folded away, so the companions are on the strip above the music bar.
  await page.evaluate(
    ({ pal, roomId: id }) => {
      const wire = new BroadcastChannel('debaser-watch');
      const member = { key: 'kiss-pal-tab', userId: pal.id, name: pal.name, joinedAt: Date.now() };
      window.__kissPal = { x: 0.45, r: 0, k: null };
      const say = () => wire.postMessage({ type: 'here', roomId: id, member, companion: { x: window.__kissPal.x, m: 'stand', r: window.__kissPal.r, k: window.__kissPal.k, c: 'kiss-guy', p: null } });
      window.__kissPalSay = say;
      say();
      setInterval(say, 1000);
    },
    { pal: MOLDAVIUS, roomId },
  );
  await page.waitForFunction((id) => document.querySelector(`[data-companion-of="${id}"]`)?.style.visibility === 'visible', MOLDAVIUS.id, { timeout: 60000 });
}

async function stripPart(browser, shownOf) {
  const ids = [SWEDEN.id, MOLDAVIUS.id];
  const page = await open(browser, { as: SWEDEN.id, shownOf });
  await streamRoom(page, SWEDEN.id);
  // Moldavius's companion is a stand-in that never walks (its own browser would bring it over): it is said to stand a
  // little way along from sweden's, on the same stretch of strip.
  await page.waitForFunction((id) => document.querySelector(`[data-companion-of="${id}"]`)?.style.visibility === 'visible', SWEDEN.id, { timeout: 60000 });
  await sleep(4000);
  await page.evaluate((id) => {
    const mine = document.querySelector(`[data-companion-of="${id}"]`);
    const x = Number(mine.dataset.x);
    const w = mine.getBoundingClientRect().width;
    const room = window.innerWidth - w;
    window.__kissPal.x = Math.min(1, Math.max(0, (x - w * 1.2) / room));
    window.__kissPalSay();
  }, SWEDEN.id);
  const started = Date.now();
  const looks = [];
  let told = false;
  let shot = false;
  while (Date.now() - started < WAIT_MS + 20_000) {
    // Sweden's companion told the room it kisses: moldavius's tab would have worked out the same moment; say it so.
    if (!told && (await page.evaluate(() => window.__kissHeard.length > 0))) {
      told = true;
      await page.evaluate(() => {
        window.__kissPal.r += 1;
        window.__kissPal.k = 'kiss';
        window.__kissPalSay();
      });
      console.log(`      sweden's companion told the room "kiss" ${((Date.now() - started) / 1000).toFixed(1)} s after the stream room opened`);
    }
    const now = await page.evaluate(stripLook, ids);
    looks.push(now);
    const f = now.figures;
    // Somebody at the screen (mid-screen, well away from the strip and the window's top edge, so nothing is chased): a
    // companion left alone long enough falls asleep.
    if (looks.length % 50 === 0) await page.mouse.move(500 + (looks.length % 100), 450);
    if (looks.length % 150 === 0) {
      const one = (who) => (f[who] ? `x ${f[who].x} ${f[who].motion} ${f[who].facing}` : 'not in sight');
      console.log(`      ${((Date.now() - started) / 1000).toFixed(0)} s: sweden's ${one(SWEDEN.id)}; moldavius's ${one(MOLDAVIUS.id)}`);
    }
    if (!shot && f[SWEDEN.id]?.kiss && f[MOLDAVIUS.id]?.kiss) {
      const box = await page.locator(`[data-companion-strip] [data-companion-of="${SWEDEN.id}"]`).boundingBox();
      if (box) await page.screenshot({ path: join(SHOTS, 'b-strip-lean.png'), clip: { x: Math.max(0, box.x - 160), y: Math.max(0, box.y - 120), width: 400, height: box.height + 160 } });
      shot = true;
    }
    if (told && looks.some((one) => one.figures[SWEDEN.id]?.kiss) && !f[SWEDEN.id]?.kiss && !f[MOLDAVIUS.id]?.kiss) break;
    await sleep(100);
  }
  assert.ok(told, `sweden's companion told the room "kiss" within ${(WAIT_MS + 20_000) / 1000} s`);
  const mine = looks.filter((one) => one.figures[SWEDEN.id]?.kiss);
  const theirs = looks.filter((one) => one.figures[MOLDAVIUS.id]?.kiss);
  assert.ok(mine.length >= 5, `sweden's companion leans in (${mine.length} looks)`);
  assert.ok(theirs.length >= 3, `moldavius figtree's leans in too (${theirs.length} looks)`);
  const both = looks.find((one) => one.figures[SWEDEN.id]?.kiss && one.figures[MOLDAVIUS.id]?.kiss);
  assert.ok(both, 'leaning at the same time');
  const s = both.figures[SWEDEN.id];
  const m = both.figures[MOLDAVIUS.id];
  const sTowards = m.x >= s.x ? 'right' : 'left';
  assert.equal(s.kiss, sTowards, `sweden's leans toward moldavius figtree's (${s.kiss})`);
  assert.equal(m.kiss, sTowards === 'right' ? 'left' : 'right', `and moldavius figtree's back toward sweden's (${m.kiss})`);
  // (The browser reads the matrix back in its own short form: `matrix(1, 0, -0.12, 1, 0, 0)`.)
  assert.ok(/matrix\(1(\.0+)?, 0(\.0+)?, -?0\.\d+, 1(\.0+)?, 0, 0\)/.test(s.transform), `sheared by a plain matrix: ${s.transform}`);
  const hearts = looks.flatMap((one) => [...(one.figures[SWEDEN.id]?.hearts ?? []), ...(one.figures[MOLDAVIUS.id]?.hearts ?? [])]);
  assert.ok(hearts.length > 0 && hearts.every((glyph) => glyph === '♥'), `text hearts rise on the strip (${hearts.length})`);
  pass(`b. strip: sweden's companion told the room, both leaned in toward each other (${Math.abs(m.x - s.x)} px apart), hearts rising: ${shot ? 'Temp/browse/kiss/b-strip-lean.png' : 'no screenshot'}`);
  await page.context().close();
}

async function stillPart(browser, shownOf) {
  const ids = [SWEDEN.id, MOLDAVIUS.id, STRANGER.id];
  const page = await open(browser, { as: READER.id, shownOf, reduced: true });
  await page.goto(`${BASE}/profile/${SWEDEN.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-profile-room-stage]', { timeout: 180000 });
  await page.mouse.move(600, 200);
  await page.locator('[data-profile-room-stage]').scrollIntoViewIfNeeded();
  await page.waitForFunction((list) => list.every((id) => document.querySelector(`[data-profile-room-stage] [data-character-of="${id}"]`)), ids, { timeout: 30000 });
  const first = await page.evaluate(roomLook, ids);
  const started = Date.now();
  let seen = null;
  const looks = [];
  while (Date.now() - started < WAIT_MS) {
    const now = await page.evaluate(roomLook, ids);
    looks.push(now);
    if (now.figures[SWEDEN.id]?.still && now.figures[MOLDAVIUS.id]?.still) {
      seen = now;
      break;
    }
    await sleep(250);
  }
  assert.ok(seen, `a still heart over both friends within ${WAIT_MS / 1000} s`);
  await page.locator('[data-profile-room]').screenshot({ path: join(SHOTS, 'c-room-still.png') });
  assert.equal(seen.figures[SWEDEN.id].still, '♥', 'a heart');
  assert.equal(seen.figures[STRANGER.id].still, null, 'none over the stranger');
  for (const one of looks) {
    for (const id of ids) {
      assert.equal(one.figures[id].left, first.figures[id].left, 'nobody moves under reduced motion');
      assert.equal(one.figures[id].transform, '', 'nobody leans');
      assert.ok(!one.figures[id].kiss, 'no kiss stage');
    }
    assert.equal(one.hearts.length, 0, 'no rising hearts');
  }
  pass(`c. reduced motion, ROOM: nobody moved or leaned and no hearts rose; a still ♥ over each friend after ${((seen.at - started) / 1000).toFixed(1)} s`);
  await page.context().close();

  // The strip, reduced: a still ♥ over sweden's companion at the moment, nothing moving.
  const strip = await open(browser, { as: SWEDEN.id, shownOf, reduced: true });
  await streamRoom(strip, SWEDEN.id);
  const startedStrip = Date.now();
  let marked = null;
  while (Date.now() - startedStrip < WAIT_MS) {
    const now = await strip.evaluate(stripLook, [SWEDEN.id, MOLDAVIUS.id]);
    assert.ok(!now.figures[SWEDEN.id]?.kiss && (now.figures[SWEDEN.id]?.hearts.length ?? 0) === 0, 'no lean and no rising hearts on the strip');
    if (now.figures[SWEDEN.id]?.mark === '♥') {
      marked = now;
      break;
    }
    await sleep(250);
  }
  assert.ok(marked, `a still ♥ over sweden's companion on the strip within ${WAIT_MS / 1000} s`);
  assert.equal(await strip.evaluate(() => window.__kissHeard.length), 0, 'and nothing sent for it');
  pass(`c. reduced motion, strip: a still ♥ over sweden's companion after ${((marked.at - startedStrip) / 1000).toFixed(1)} s, nothing sent`);
  await strip.context().close();
}

(async () => {
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: !args.includes('--headed'),
    // swiftshader: the bake needs WebGL, which a headless browser has only this way.
    args: ['--no-first-run', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    console.log(`drive-character-kiss against ${BASE}`);
    let shown;
    if (args.includes('--plain')) {
      const page = await browser.newPage();
      await page.goto(`${BASE}/specimen`, { waitUntil: 'domcontentloaded', timeout: 180000 }).catch(() => undefined);
      const friend = await page.evaluate(plainShown, 'rgb(255,0,160)');
      await page.close();
      shown = friend;
    } else {
      shown = await bakeGuy(browser);
      writeFileSync(join(SHOTS, 'guy-strip.png'), Buffer.from(shown.stripUrl.slice(shown.stripUrl.indexOf(',') + 1), 'base64'));
      console.log(`      GUY baked: ${shown.sheet.cells} cells of ${shown.sheet.cell.w} x ${shown.sheet.cell.h}`);
    }
    const shownOf = { [SWEDEN.id]: shown, [MOLDAVIUS.id]: shown, [STRANGER.id]: shown };
    if (ONLY === null || ONLY === 'room') await roomPart(browser, shownOf);
    if (ONLY === null || ONLY === 'strip') await stripPart(browser, shownOf);
    if (ONLY === null || ONLY === 'still') await stillPart(browser, shownOf);
    assert.equal(supabaseHit, false, 'no request went to a Supabase host');
    console.log(`drive-character-kiss: OK (${passed} passed)`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
