/*
 * Dragging characters into a profile's ROOM (Luke, 2026-11-23: "allow to drag into the profile room"; "Also others' in
 * stream"), in a real browser on a LOCAL dev server running on MOCK data. It touches no database: the accounts and the
 * characters are seeded into that browser's own storage, and the second person in the stream room is a member said onto the
 * mock room's own wire (a BroadcastChannel) from the page. Not in `npm run checks` (it needs a running server).
 *
 *   npx cross-env NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= next dev -p 3317      (the mock server)
 *   node scripts/drive-drop-into-room.cjs [--base http://localhost:3317] [--headed]
 *
 * The reader (DROP READER, with a character, so their companion is out) goes live in a stream room; DROP PAL joins it.
 * The reader opens DROP OWNER's profile, whose ROOM starts out of sight below the fold. Then:
 *   1. your companion: picked up off the strip, carried while the ROOM is scrolled into view (so it cannot simply climb in
 *      by itself), let go over the ROOM: it is in the ROOM within a moment, where it was let go, and not on the strip;
 *   2. somebody else's companion from the stream (DROP PAL, whose ROOM this is not): picked up off the strip, let go over
 *      the ROOM: it is in the ROOM as a visitor, where it was let go, and not on the strip;
 *   3. the ROOM's own character: dragged out above the ROOM and let go back over it at another spot: it is back in at once
 *      where it was let go, not dropped to the floor to walk and climb home;
 *   4. back to the stream: DROP PAL climbs down out of the ROOM and is on the strip again.
 * Sampled every 100 ms throughout: no character is ever on screen twice.
 * Screenshots in Temp/browse/drop-into-room/.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3317').replace(/\/$/, '');
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) throw new Error('A local mock dev server only.');
const SHOTS = join('Temp', 'browse', 'drop-into-room');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

const READER = { id: 'drop-reader', name: 'DROP READER' };
const PAL = { id: 'drop-pal', name: 'DROP PAL' };
const OWNER = { id: 'drop-owner', name: 'DROP OWNER' };

/** Runs in the page before anything else: the mock stores, filled. */
function seed({ people, readerId }) {
  if (!/^localhost$|^127\.0\.0\.1$/.test(window.location.hostname)) return;
  const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString();
  const user = (person) => ({ id: person.id, email: `${person.id}@debaser.site`, displayName: person.name, createdAt: at(5000), salt: '', secretHash: '', hidden: true });
  window.localStorage.setItem('debaser.lost-account.never.v1', '1');
  window.localStorage.setItem('debaser.tour.v2', 'skipped');
  window.localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ users: people.map(user), sessionUserId: readerId, bannedIds: [] }));
  const profile = (person) => ({
    userId: person.id,
    displayName: person.name,
    bio: '',
    visibility: { showTags: true, showProfileComments: true, showAvatarComments: true, showSongComments: true },
    tags: [],
    comments: [],
    updatedAt: at(10),
    privacySeen: true,
  });
  window.localStorage.setItem('debaser.profile.mock.v1', JSON.stringify({ version: 1, profiles: Object.fromEntries(people.map((person) => [person.id, profile(person)])) }));
  // Stand-in strips: one cell, one plain block of colour each. Test fixtures in this browser only, never on the site.
  const strip = (colour) => {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 24;
    const pen = canvas.getContext('2d');
    pen.fillStyle = colour;
    pen.fillRect(2, 0, 12, 24);
    return canvas.toDataURL('image/png');
  };
  const motion = { facing: 'side', loop: true, ticks: [0] };
  const core = ['stand', 'idle', 'walk', 'dance1', 'dance2', 'dance3', 'wave', 'hop', 'turn', 'sit', 'sleep'];
  const sheet = { v: 1, cell: { w: 16, h: 24 }, columns: 1, cells: 1, fps: 10, floor: 24, head: 0, motions: Object.fromEntries(core.map((id) => [id, motion])) };
  const colours = ['rgb(255,240,0)', 'rgb(255,0,160)', 'rgb(0,200,255)'];
  window.localStorage.setItem(
    'debaser.profile-character.v1',
    JSON.stringify(Object.fromEntries(people.map((person, i) => [person.id, { characterId: `drop-${i}`, mood: 'calm', stripUrl: strip(colours[i]), sheet, bakedAt: at(100) }]))),
  );
}

/** DROP PAL in the room: their presence said on the wire every second, as their own tab would. */
function joinPal({ pal, roomId }) {
  const wire = new BroadcastChannel('debaser-watch');
  const member = { key: 'drop-pal-tab', userId: pal.id, name: pal.name, joinedAt: Date.now() };
  const say = () => wire.postMessage({ type: 'here', roomId, member, companion: { x: 0.25, m: 'stand', r: 0, k: null, c: 'drop-1', p: null } });
  say();
  window.__dropPal = setInterval(say, 1000);
}

/** One look: how many of each person's character are on screen, and where. */
function census(ids) {
  const shown = (el) => el !== null && el.style.visibility === 'visible';
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), bottom: Math.round(r.bottom) };
  };
  const out = {};
  for (const id of ids) {
    const strip = [...document.querySelectorAll(`[data-companion-strip] [data-companion-of="${id}"]`)].filter(shown);
    const room = [...document.querySelectorAll(`[data-profile-room] [data-character-of="${id}"]`)].filter((el) => !el.closest('[data-room-figure-out]'));
    out[id] = { count: strip.length + room.length, strip: strip[0] ? box(strip[0]) : null, room: room[0] ? box(room[0]) : null };
  }
  out.loose = [...document.querySelectorAll('[data-loose-character]')].filter(shown).length;
  out.path = window.location.pathname;
  return out;
}

async function main() {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: !args.includes('--headed'), args: ['--no-first-run'] });
  // Short, so the ROOM at the foot of the profile starts out of sight.
  const context = await browser.newContext({ viewport: { width: 1440, height: 640 } });
  await context.addInitScript(seed, { people: [READER, PAL, OWNER], readerId: READER.id });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  page error: ${String(error).slice(0, 200)}`));
  const ids = [READER.id, PAL.id, OWNER.id];
  const samples = [];
  let sampling = false;
  const sampler = (async () => {
    for (;;) {
      if (sampling) {
        try {
          samples.push(await page.evaluate(census, ids));
        } catch {
          /* between pages */
        }
      }
      await sleep(100);
      if (page.isClosed()) return;
    }
  })();
  const look = () => page.evaluate(census, ids);
  const boxOf = (selector) =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
    }, selector);
  /** Presses a figure, lifts it, runs `between` (still holding), carries it over `to()` and lets go, still. */
  const carry = async (selector, between, to) => {
    const figure = await boxOf(selector);
    assert.ok(figure !== null, `${selector} is on screen to pick up`);
    const hold = { x: figure.left + figure.w / 2, y: figure.top + figure.h * 0.6 };
    await page.mouse.move(hold.x, hold.y);
    await page.mouse.down();
    await page.mouse.move(hold.x + 4, hold.y - 12, { steps: 3 });
    await page.mouse.move(hold.x + 8, hold.y - 40, { steps: 5 });
    await sleep(200);
    if (between) await between();
    const target = await to();
    await page.mouse.move(target.x, target.y, { steps: 12 });
    // Held still a moment, so the let-go is a drop, not a throw.
    await sleep(500);
    await page.mouse.up();
    return { x: target.x - (hold.x - figure.left), at: Date.now() };
  };
  const waitFor = async (test, timeout) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const seen = await look();
      if (test(seen)) return { seen, ms: Date.now() - started };
      await sleep(50);
    }
    return null;
  };

  try {
    await page.goto(`${BASE}/stream`, { waitUntil: 'domcontentloaded' });
    await page.mouse.move(600, 200);

    /* a stream room with DROP PAL in it */
    await page.getByRole('button', { name: /GO LIVE|BACK TO YOUR ROOM/ }).first().click({ timeout: 120000 });
    await sleep(500);
    const startKey = page.locator('[data-go-live-start]');
    if ((await startKey.count()) > 0) await startKey.click();
    await page.waitForFunction(
      (id) => (JSON.parse(window.localStorage.getItem('debaser.watch.v1') ?? '{"rooms":[]}').rooms ?? []).some((room) => room.hostId === id && room.endedAt === null),
      READER.id,
      { timeout: 60000 },
    );
    const roomId = await page.evaluate((id) => JSON.parse(window.localStorage.getItem('debaser.watch.v1')).rooms.find((room) => room.hostId === id && room.endedAt === null).id, READER.id);
    // Your private main room says no presence until it goes live (SPEC-rooms-perpetual.md): live it goes, from its settings.
    await page.evaluate(() => {
      const key = [...document.querySelectorAll('button')].find((button) => /GO LIVE/.test(button.textContent ?? '') && /WHO CAN JOIN/.test(button.parentElement?.parentElement?.textContent ?? ''));
      key?.click();
    });
    await sleep(800);
    await page.keyboard.press('Escape');
    await page.evaluate(joinPal, { pal: PAL, roomId });
    await page.waitForFunction((id) => document.querySelector(`[data-companion="room"][data-companion-of="${id}"]`)?.style.visibility === 'visible', PAL.id, { timeout: 60000 });
    // The stream room's window folded away: everybody's companion is down on the strip over the music bar, as on a page
    // with the window out of the way (on a short screen the open window covers the strip, and they stand on its title bar,
    // where a press goes to the window's keys and edges).
    const fold = page.locator('button[aria-label^="Fold "]').first();
    if ((await fold.count()) > 0) await fold.click();
    else console.log('  --  no fold key on the stream window: the companions may be on its top edge');
    await sleep(3000);

    /* DROP OWNER's profile, its ROOM out of sight */
    sampling = true;
    await page.evaluate((id) => window.next.router.push(`/profile/${id}`), OWNER.id);
    await page.waitForSelector('[data-profile-room-stage]', { timeout: 120000 });
    await page.waitForFunction((id) => document.querySelector(`[data-profile-room] [data-character-of="${id}"]`) !== null, OWNER.id, { timeout: 60000 });
    await sleep(1500);
    const stage0 = await boxOf('[data-profile-room-stage]');
    const own0 = await boxOf('[data-companion="own"]');
    console.log(`  --  the ROOM's floor at ${Math.round(stage0.bottom)} on a screen 640 high; your companion's feet at ${own0 ? Math.round(own0.bottom) : 'none'}`);
    const start = await look();
    assert.equal(start[READER.id].room, null, `your companion has not climbed into the ROOM by itself yet (the ROOM is out of sight): ${JSON.stringify(start)}`);
    assert.ok(start[READER.id].strip !== null, 'your companion is on its strip');
    assert.ok(start[PAL.id].strip !== null, "DROP PAL's companion is on the strip");

    /* 1. your companion */
    const scrollRoom = () => page.evaluate(() => document.querySelector('[data-profile-room]').scrollIntoView({ block: 'center' }));
    const overRoom = (share) => async () => {
      const stage = await boxOf('[data-profile-room-stage]');
      return { x: stage.left + stage.w * share, y: stage.top + 10 };
    };
    const ownGo = await carry('[data-companion="own"]', scrollRoom, overRoom(0.6));
    if (args.includes('--debug')) {
      const frames = await page.evaluate(async () => {
        const out = [];
        const stage = document.querySelector('[data-profile-room-stage]').getBoundingClientRect();
        out.push(`stage ${Math.round(stage.left)}-${Math.round(stage.right)} floor ${Math.round(stage.bottom)}`);
        for (let i = 0; i < 12; i += 1) {
          const own = document.querySelector('[data-companion="own"]');
          out.push(`${own.style.visibility} x${own.dataset.x} feet${own.dataset.feet} ${own.dataset.motion} held${own.dataset.held}`);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return out;
      });
      console.log(`  let go at ${Math.round(ownGo.x)}: ${frames.join(' | ')}`);
    }
    const ownIn = await waitFor((seen) => seen[READER.id].room !== null, 3000);
    await page.screenshot({ path: join(SHOTS, '1-own-dropped.png') });
    assert.ok(ownIn !== null, 'your companion is in the ROOM after being let go over it');
    assert.ok(ownIn.ms <= 1500, `within a moment of the let-go (${ownIn.ms} ms), not after walking and climbing`);
    assert.equal(ownIn.seen[READER.id].strip, null, 'and not on the strip');
    assert.ok(Math.abs(ownIn.seen[READER.id].room.left - ownGo.x) <= 30, `where it was let go (let go at ${Math.round(ownGo.x)}, in the ROOM at ${ownIn.seen[READER.id].room.left})`);
    pass(`your companion, carried over the ROOM and let go, was in it ${ownIn.ms} ms later at ${ownIn.seen[READER.id].room.left} (let go at ${Math.round(ownGo.x)}), and not on the strip`);

    /* 2. somebody else's companion from the stream */
    const palGo = await carry(`[data-companion="room"][data-companion-of="${PAL.id}"]`, null, overRoom(0.3));
    const palIn = await waitFor((seen) => seen[PAL.id].room !== null, 3000);
    await page.screenshot({ path: join(SHOTS, '2-pal-dropped.png') });
    assert.ok(palIn !== null, "DROP PAL's companion is in DROP OWNER's ROOM after being let go over it");
    assert.ok(palIn.ms <= 1500, `within a moment (${palIn.ms} ms)`);
    assert.equal(palIn.seen[PAL.id].strip, null, 'and not on the strip');
    assert.ok(Math.abs(palIn.seen[PAL.id].room.left - palGo.x) <= 30, `where it was let go (let go at ${Math.round(palGo.x)}, in the ROOM at ${palIn.seen[PAL.id].room.left})`);
    await sleep(2000);
    const palStays = await look();
    assert.ok(palStays[PAL.id].room !== null && palStays[PAL.id].count === 1, `it stays, a visitor, one of them (${JSON.stringify(palStays[PAL.id])})`);
    pass(`DROP PAL's companion, picked up off the stream's strip and let go over DROP OWNER's ROOM, was in it ${palIn.ms} ms later where it was let go, and stayed as a visitor`);

    /* 3. the ROOM's own character, out and back in */
    const ownerFrom = (await look())[OWNER.id].room;
    const ownerGo = await carry(
      `[data-profile-room] [data-character-of="${OWNER.id}"]`,
      async () => {
        const stage = await boxOf('[data-profile-room-stage]');
        await page.mouse.move(stage.left + stage.w * 0.5, stage.top - 120, { steps: 8 });
        await sleep(300);
      },
      overRoom(ownerFrom.left > 700 ? 0.15 : 0.85),
    );
    const ownerIn = await waitFor((seen) => seen.loose === 0 && seen[OWNER.id].room !== null, 3000);
    await page.screenshot({ path: join(SHOTS, '3-owner-back.png') });
    assert.ok(ownerIn !== null, "the ROOM's own character is back in it");
    assert.ok(ownerIn.ms <= 1800, `at once (${ownerIn.ms} ms), not after dropping to the floor and climbing home`);
    assert.ok(Math.abs(ownerIn.seen[OWNER.id].room.left - ownerGo.x) <= 40, `where it was let go (let go at ${Math.round(ownerGo.x)}, back at ${ownerIn.seen[OWNER.id].room.left})`);
    pass(`DROP OWNER's character, dragged out of its ROOM and let go back over it, was back in ${ownerIn.ms} ms later where it was let go (${ownerIn.seen[OWNER.id].room.left}, from ${ownerFrom.left})`);

    /* 4. back to the stream */
    await page.evaluate(() => window.next.router.push('/stream'));
    const palBack = await waitFor((seen) => seen.path === '/stream' && seen[PAL.id].strip !== null, 15000);
    assert.ok(palBack !== null, 'DROP PAL is back on the strip after the ROOM goes');
    await sleep(3000);
    const end = await look();
    assert.equal(end[PAL.id].count, 1, `one DROP PAL on the stream (${JSON.stringify(end[PAL.id])})`);
    pass('back on the stream, DROP PAL came out of the ROOM onto the strip');

    sampling = false;
    const twice = samples.filter((one) => ids.some((id) => one[id].count > 1));
    assert.equal(twice.length, 0, `never two of anybody on screen (${twice.length} of ${samples.length} looks had two: ${JSON.stringify(twice.slice(0, 2))})`);
    pass(`nobody's character was on screen twice in ${samples.length} looks, 100 ms apart`);
    console.log(`\n${passed} passed`);
  } catch (error) {
    await page.screenshot({ path: join(SHOTS, 'failed.png') }).catch(() => undefined);
    console.log(`  at ${page.url()}; last looks: ${JSON.stringify(samples.slice(-2))}`);
    throw error;
  } finally {
    sampling = false;
    await context.close();
    await browser.close();
    await sampler.catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
