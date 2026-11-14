/*
 * Characters speaking in a profile's ROOM (SPEC-character-speech.md, phase 1), in a real browser on a LOCAL dev server
 * running on MOCK data. It touches no database: every account, comment and character is seeded into that browser's own
 * storage. Not in `npm run checks` (it needs a running server).
 *
 *   npx cross-env NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= next dev -p 3313      (the mock server)
 *   node scripts/drive-character-speech.cjs [--base http://localhost:3313] [--headed]
 *
 * Seeded: an owner (SPEECH OWNER) with a shown character and one remark on their own profile; a commenter (SPEECH AMY)
 * with a shown character and two comments there, one long; the reader is a third account with no character.
 *   a. the commenter's character has come to visit: the owner's figure and one guest are in the room;
 *   b. a bubble opens by itself over a figure that has stopped and stands idle; its words grow a letter at a time;
 *      what it says is one of that same person's own comments, never anybody else's;
 *   c. the bubble sits inside the room and over the head of the one speaking, never more than two lines of words;
 *   d. after it closes, the next opens within the stated gap (6 to 16 seconds);
 *   v. the voice: the audio key is there and off, and no sound machinery exists; pressed, it is on, the machinery is
 *      made, and a whole bubble sounds exactly one blip for each letter that speaks; the choice survives a reload,
 *      and nothing is made again until the reader presses something;
 *   e. pressing a bubble opens COMMENTS on the page with that comment in view and marked;
 *   f. reduced motion: nothing speaks by itself; a press on a character shows its line whole; a second press puts it away;
 *   g. one quick look at phone width: no sideways scroll.
 * Screenshots in Temp/browse/profile/speech-*.png.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3313').replace(/\/$/, '');
const SHOTS = join('Temp', 'browse', 'profile');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

const OWNER = { id: 'speech-owner', name: 'SPEECH OWNER' };
const AMY = { id: 'speech-amy', name: 'SPEECH AMY' };
const READER = { id: 'speech-reader', name: 'SPEECH READER' };
const WORDS = {
  [OWNER.id]: ['Thanks for coming by, all of you.'],
  [AMY.id]: [
    'The drawing is the one for me!',
    'A longer remark from me, long enough that it cannot fit in one bubble and has to be carried over onto a second page of two lines.',
  ],
};

/** Runs in the page before anything else: the mock stores, filled. */
function seed({ owner, amy, reader, words }) {
  if (!/^localhost$|^127\.0\.0\.1$/.test(window.location.hostname)) return;
  const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString();
  const user = (person) => ({ id: person.id, email: `${person.id}@debaser.site`, displayName: person.name, createdAt: at(5000), salt: '', secretHash: '', hidden: true });
  window.localStorage.setItem('debaser.lost-account.never.v1', '1');
  window.localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ users: [user(owner), user(amy), user(reader)], sessionUserId: reader.id, bannedIds: [] }));

  const author = (person) => ({ id: person.id, displayName: person.name });
  const comments = [
    { id: 'speech-c1', kind: 'profile', author: author(amy), body: words[amy.id][0], createdAt: at(30) },
    { id: 'speech-c2', kind: 'profile', author: author(owner), body: words[owner.id][0], createdAt: at(20) },
    { id: 'speech-c3', kind: 'profile', author: author(amy), body: words[amy.id][1], createdAt: at(10) },
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
    JSON.stringify({ version: 1, profiles: { [owner.id]: profile(owner, { comments }), [amy.id]: profile(amy), [reader.id]: profile(reader) } }),
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
  const shown = (colour) => ({ characterId: 'speech-test', mood: 'busy', stripUrl: strip(colour), sheet, bakedAt: at(100) });
  window.localStorage.setItem('debaser.profile-character.v1', JSON.stringify({ [owner.id]: shown('rgb(255,240,0)'), [amy.id]: shown('rgb(255,0,160)') }));
}

async function open(browser, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  await context.addInitScript(seed, { owner: OWNER, amy: AMY, reader: READER, words: WORDS });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  page error: ${String(error).slice(0, 200)}`));
  await page.goto(`${BASE}/profile/${OWNER.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-profile-room-stage]', { timeout: 120000 });
  // A headless browser reports no mouse until it moves, and the site would take it for a phone.
  await page.mouse.move(600, 200);
  return page;
}

/** One look at the room: the bubble, who is under it, and where everything is. */
const look = () => {
  const stage = document.querySelector('[data-profile-room-stage]');
  const bubble = stage?.querySelector('[data-speech-bubble]') ?? null;
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  };
  if (!stage || !bubble) return { bubble: null, talkers: stage?.getAttribute('data-room-talkers') ?? null };
  const figure = bubble.parentElement.querySelector('button');
  return {
    bubble: {
      id: bubble.getAttribute('data-speech-bubble'),
      label: bubble.getAttribute('aria-label'),
      page: bubble.getAttribute('data-speech-page'),
      href: bubble.getAttribute('href'),
      typed: [...bubble.querySelectorAll('[data-speech-typed]')].map((el) => el.textContent).join(''),
      rows: bubble.querySelectorAll('[data-speech-typed]').length,
      box: box(bubble),
      font: window.getComputedStyle(bubble).fontFamily,
    },
    speaker: figure ? { of: figure.getAttribute('data-character-of'), motion: figure.getAttribute('data-motion'), box: box(figure) } : null,
    stage: box(stage),
  };
};

async function waitForBubble(page, timeout, not = null) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const seen = await page.evaluate(look);
    if (seen.bubble !== null && seen.bubble.id !== not) return { seen, waited: Date.now() - started };
    await sleep(100);
  }
  return null;
}

async function waitForNoBubble(page, timeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if ((await page.evaluate(look)).bubble === null) return Date.now() - started;
    await sleep(100);
  }
  return null;
}

function holds(seen, what) {
  const { bubble, speaker, stage } = seen;
  assert.ok(speaker !== null, `${what}: the bubble belongs to a figure`);
  const [who, said] = bubble.label.split(' SAID: ');
  const person = [OWNER, AMY].find((one) => one.id === speaker.of);
  assert.ok(person, `${what}: the speaker is somebody in the room (${speaker.of})`);
  assert.equal(who, person.name, `${what}: the bubble names the one it is over`);
  assert.ok(WORDS[person.id].includes(said), `${what}: ${person.name} says only what ${person.name} wrote ("${said.slice(0, 40)}")`);
  assert.equal(speaker.motion, 'idle', `${what}: the speaker stands still`);
  assert.ok(bubble.box.left >= stage.left - 1 && bubble.box.right <= stage.right + 1 && bubble.box.top >= stage.top - 1, `${what}: the bubble is inside the room`);
  assert.ok(bubble.box.bottom <= speaker.box.top + 1, `${what}: the bubble is over the speaker's head, not on it`);
  const centre = (speaker.box.left + speaker.box.right) / 2;
  assert.ok(centre >= bubble.box.left - 4 && centre <= bubble.box.right + 4, `${what}: and over that speaker, not somebody else`);
  assert.ok(bubble.rows >= 1 && bubble.rows <= 2, `${what}: never more than two lines of words (${bubble.rows})`);
  assert.match(bubble.font, /Pixelify/i, `${what}: in the speech lettering`);
  return { person, said };
}

async function main() {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: !args.includes('--headed'), args: ['--no-first-run'] });
  try {
    const page = await open(browser);

    /* a. who is in the room */
    await page.waitForSelector('[data-profile-character="guest"]', { timeout: 60000 });
    const figures = await page.evaluate(() => ({
      owner: document.querySelectorAll('[data-profile-room] [data-profile-character="owner"]').length,
      guests: [...document.querySelectorAll('[data-profile-room] [data-profile-character="guest"]')].map((el) => el.getAttribute('data-character-of')),
      talkers: document.querySelector('[data-profile-room-stage]').getAttribute('data-room-talkers'),
    }));
    assert.equal(figures.owner, 1, "the owner's character is in the room");
    assert.deepEqual(figures.guests, [AMY.id], "and the commenter's character has come to visit");
    assert.equal(figures.talkers, '2', 'both have something to say');
    pass('the commenter\'s character has come to visit: the owner and one guest in the room, both with something to say');

    /* b. c. a bubble opens by itself */
    await page.locator('[data-profile-room]').scrollIntoViewIfNeeded();
    const inView = Date.now();
    const first = await waitForBubble(page, 12000);
    assert.ok(first !== null, 'a bubble opens by itself within a few seconds of the room coming into view');
    await sleep(350);
    const later = await page.evaluate(look);
    assert.ok(later.bubble !== null && later.bubble.typed.length > first.seen.bubble.typed.length, `its words grow (${first.seen.bubble.typed.length} -> ${later.bubble?.typed.length} letters)`);
    const spoke = holds(later, 'first bubble');
    await page.screenshot({ path: join(SHOTS, 'speech-desktop-dark.png') });
    pass(`a bubble opened by itself ${((Date.now() - inView) / 1000).toFixed(1)} s after the room came into view, over ${spoke.person.name}, typing a letter at a time`);
    pass(`${spoke.person.name} said their own words ("${spoke.said.slice(0, 32)}..."), standing still, the bubble inside the room and over their head`);

    /* d. the gap, and more bubbles: every one of them must hold the same rules */
    const seenIds = new Set([first.seen.bubble.id]);
    const pagesSeen = new Set([later.bubble.page]);
    let lastId = first.seen.bubble.id;
    const gaps = [];
    for (let turn = 0; turn < 3; turn += 1) {
      // Watch this bubble to its end, noting its pages.
      const upFor = Date.now();
      for (;;) {
        const now = await page.evaluate(look);
        if (now.bubble === null || now.bubble.id !== lastId) break;
        pagesSeen.add(now.bubble.page);
        assert.ok(Date.now() - upFor < 40000, 'a bubble closes by itself');
        await sleep(200);
      }
      const closed = Date.now();
      const next = await waitForBubble(page, 20000);
      assert.ok(next !== null, 'another bubble opens after the gap');
      gaps.push(Date.now() - closed);
      await sleep(300);
      holds(await page.evaluate(look), `bubble ${turn + 2}`);
      lastId = next.seen.bubble.id;
      seenIds.add(lastId);
    }
    assert.ok(gaps.every((gap) => gap >= 5500 && gap <= 17000), `each gap between bubbles is within 6 to 16 seconds (${gaps.map((gap) => (gap / 1000).toFixed(1)).join(', ')} s)`);
    pass(`one bubble at a time, ${gaps.map((gap) => (gap / 1000).toFixed(1)).join(' s, ')} s apart: within the 6 to 16 seconds stated`);
    pass(`four bubbles watched (${seenIds.size} different lines, pages seen: ${[...pagesSeen].join(' ')}): each said by its own writer, over its own head`);

    /* v. the voice */
    const sound = () => page.evaluate(() => ({ ...(window.__debaserSpeech ?? { contexts: -1, blips: -1 }) }));
    const key = page.locator('[data-profile-room] [data-speech-audio]');
    assert.equal(await key.getAttribute('data-speech-audio'), 'off', 'the audio key starts off');
    assert.equal(await key.getAttribute('aria-pressed'), 'false');
    assert.deepEqual(await sound(), { contexts: 0, blips: 0 }, 'four bubbles have typed and no sound machinery was ever made');
    pass("the audio key is on the room's title bar and starts off; after four bubbles no sound machinery exists and nothing has sounded");
    // Switched on between two bubbles, so the next one is heard from its first letter.
    await waitForNoBubble(page, 45000);
    await key.click();
    assert.equal(await key.getAttribute('aria-pressed'), 'true', 'pressed, it says it is on');
    assert.equal((await sound()).contexts, 1, 'and its own press is what makes the machinery');
    const voiced = await waitForBubble(page, 20000);
    assert.ok(voiced !== null, 'a bubble to listen to');
    const heard = voiced.seen.bubble.label.split(' SAID: ')[1];
    assert.ok((await waitForNoBubble(page, 45000)) !== null, 'it finishes');
    const speaking = [...heard].filter((letter) => /[\p{L}\p{N}]/u.test(letter)).length;
    const blips = (await sound()).blips;
    assert.equal(blips, speaking, `one blip for each letter that speaks, none for a space or a mark (${blips} blips, ${speaking} letters)`);
    pass(`switched on by its own press: "${heard.slice(0, 24)}..." sounded ${blips} blips for its ${speaking} letters, none for spaces or marks`);

    /* e. pressing a bubble */
    const current = await waitForBubble(page, 20000);
    assert.ok(current !== null, 'a bubble to press');
    const wanted = current.seen.bubble.label.split(' SAID: ')[1];
    const address = page.url();
    await page.locator('[data-speech-bubble]').click();
    await page.waitForFunction(() => document.querySelector('#profile-comments ul li.outline-dotted') !== null, null, { timeout: 8000, polling: 50 });
    const opened = await page.evaluate(() => {
      const marked = document.querySelector('#profile-comments ul li.outline-dotted');
      const box = marked.getBoundingClientRect();
      return { text: marked.textContent, inView: box.top >= 0 && box.bottom <= window.innerHeight };
    });
    assert.ok(opened.text.includes(wanted.slice(0, 40)), 'the comment that opens is the one the bubble said');
    assert.ok(opened.inView, 'and it is in view');
    assert.equal(page.url().split('#')[0], address.split('#')[0], 'on the same page');
    await page.screenshot({ path: join(SHOTS, 'speech-desktop-pressed.png') });
    pass(`pressing the bubble opened COMMENTS at "${wanted.slice(0, 28)}...", in view and marked`);

    /* v. again: the choice is remembered, and still nothing sounds before a press */
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-profile-room] [data-speech-audio="on"]', { timeout: 120000 });
    assert.equal((await sound()).contexts, 0, 'remembered as on, and no machinery until the reader presses something');
    await page.mouse.click(700, 60);
    assert.equal((await sound()).contexts, 1, 'the first press anywhere lets it start');
    pass('after a reload the key is still on, nothing is made until a press, and the first press anywhere starts it');
    await page.context().close();

    /* f. reduced motion */
    const still = await open(browser, { reducedMotion: 'reduce' });
    await still.waitForSelector('[data-profile-character="guest"]', { timeout: 60000 });
    await still.locator('[data-profile-room]').scrollIntoViewIfNeeded();
    assert.equal(await waitForBubble(still, 9000), null, 'reduced motion: nothing speaks by itself');
    // Pressed through the page, not by a pointer: two still figures may stand on the same spot.
    await still.locator('[data-profile-character="owner"]').evaluate((figure) => figure.click());
    const shown = await waitForBubble(still, 3000);
    assert.ok(shown !== null, 'a press on a character shows its line');
    const whole = shown.seen.bubble;
    assert.equal(whole.typed.replace(/ /g, ''), whole.label.split(' SAID: ')[1].replace(/ /g, '').slice(0, whole.typed.replace(/ /g, '').length), 'whole from the first look');
    assert.ok(whole.typed.length >= 20, `not a letter at a time (${whole.typed.length} letters at once)`);
    await sleep(4000);
    assert.ok((await still.evaluate(look)).bubble !== null, 'and it stays until asked to go');
    await still.screenshot({ path: join(SHOTS, 'speech-desktop-reduced-motion.png') });
    await still.locator('[data-profile-character="owner"]').evaluate((figure) => figure.click());
    assert.ok((await waitForNoBubble(still, 3000)) !== null, 'a second press puts it away');
    pass('reduced motion: nothing speaks by itself; a press shows the line whole and it stays; a second press puts it away');
    await still.context().close();

    /* g. one quick look at phone width */
    const phone = await open(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await phone.locator('[data-profile-room]').scrollIntoViewIfNeeded();
    await sleep(6000);
    const wide = await phone.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: window.innerWidth }));
    assert.ok(wide.page <= wide.screen + 1, `no sideways scroll at phone width (${wide.page} in ${wide.screen})`);
    pass(`phone width, one look: no sideways scroll (${wide.page}px in ${wide.screen}px)`);
    await phone.context().close();

    console.log(`${passed} proofs passed`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`FAILED after ${passed} proofs: ${error.message}`);
  process.exit(1);
});
