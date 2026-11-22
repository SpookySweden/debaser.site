/*
 * One of each character on screen (Luke, 2026-11-22: "when viewing someones profile while in a stream with them, there is
 * one version of their character in the profile box and one above the bottom player bar ... just one of each character on
 * the screen at a time and ideally have them be the same one for real"), in a real browser on a LOCAL dev server running
 * on MOCK data. It touches no database: the accounts and the character are seeded into that browser's own storage, and the
 * second person in the stream room is a member said onto the mock room's own wire (a BroadcastChannel) from the page.
 * Not in `npm run checks` (it needs a running server).
 *
 *   npx cross-env NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= next dev -p 3317      (the mock server)
 *   node scripts/drive-one-character.cjs [--base http://localhost:3317] [--headed]
 *
 * What it does and holds:
 *   1. the reader goes live in a stream room; ONE PAL joins it (on the wire) wearing a shown character: their companion
 *      climbs onto the strip;
 *   2. the reader opens ONE PAL's profile, inside the site (the room stays joined): sampled every 100 ms from then on,
 *      ONE PAL's character is never on screen twice (strip figure shown + figures in the ROOM + one taken out);
 *   3. scrolled to the ROOM, ONE PAL's companion climbs into it (seen climbing), and is then the one figure of them, in
 *      the ROOM, starting where it stepped in;
 *   4. the reader goes back to the stream: the companion climbs down from where it stood in the ROOM (its first frame
 *      back is at that spot), and reaches the strip; still never two.
 * Screenshots in Temp/browse/one-character/.
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
const SHOTS = join('Temp', 'browse', 'one-character');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

const READER = { id: 'one-reader', name: 'ONE READER' };
const PAL = { id: 'one-pal', name: 'ONE PAL' };

/** Runs in the page before anything else: the mock stores, filled, and an ear on the room's wire. */
function seed({ reader, pal }) {
  if (!/^localhost$|^127\.0\.0\.1$/.test(window.location.hostname)) return;
  const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString();
  const user = (person) => ({ id: person.id, email: `${person.id}@debaser.site`, displayName: person.name, createdAt: at(5000), salt: '', secretHash: '', hidden: true });
  window.localStorage.setItem('debaser.lost-account.never.v1', '1');
  window.localStorage.setItem('debaser.tour.v2', 'skipped');
  window.localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ users: [user(reader), user(pal)], sessionUserId: reader.id, bannedIds: [] }));
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
  window.localStorage.setItem('debaser.profile.mock.v1', JSON.stringify({ version: 1, profiles: { [reader.id]: profile(reader), [pal.id]: profile(pal) } }));
  // A stand-in strip: one cell, one plain block of colour. A test fixture in this browser only, never on the site.
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 24;
  const pen = canvas.getContext('2d');
  pen.fillStyle = 'rgb(255,0,160)';
  pen.fillRect(2, 0, 12, 24);
  const motion = { facing: 'side', loop: true, ticks: [0] };
  const core = ['stand', 'idle', 'walk', 'dance1', 'dance2', 'dance3', 'wave', 'hop', 'turn', 'sit', 'sleep'];
  const sheet = { v: 1, cell: { w: 16, h: 24 }, columns: 1, cells: 1, fps: 10, floor: 24, head: 0, motions: Object.fromEntries(core.map((id) => [id, motion])) };
  window.localStorage.setItem('debaser.profile-character.v1', JSON.stringify({ [pal.id]: { characterId: 'one-test', mood: 'busy', stripUrl: canvas.toDataURL('image/png'), sheet, bakedAt: at(100) } }));
  // The room this tab is in, heard off the mock room's wire.
  const ear = new BroadcastChannel('debaser-watch');
  ear.onmessage = (event) => {
    if (event.data && event.data.type === 'here' && event.data.member && event.data.member.userId === reader.id) window.__oneRoom = event.data.roomId;
  };
}

/** ONE PAL in the room: their presence said on the wire every second, as their own tab would. */
function joinPal({ pal, roomId }) {
  const wire = new BroadcastChannel('debaser-watch');
  const member = { key: 'one-pal-tab', userId: pal.id, name: pal.name, joinedAt: Date.now() };
  const say = () => wire.postMessage({ type: 'here', roomId, member, companion: { x: 0.3, m: 'stand', r: 0, k: null, c: 'one-test', p: null } });
  say();
  window.__onePal = setInterval(say, 1000);
}

/** One look: how many of ONE PAL's character are on screen, and where. */
function census(palId) {
  const strip = document.querySelector(`[data-companion="room"][data-companion-of="${palId}"]`);
  const stripShown = strip !== null && strip.style.visibility === 'visible';
  const inRoom = [...document.querySelectorAll(`[data-profile-room] [data-character-of="${palId}"]`)].filter((el) => !el.closest('[data-room-figure-out]'));
  const taken = document.querySelectorAll('[data-loose-character]').length;
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), bottom: Math.round(r.bottom), top: Math.round(r.top) };
  };
  return {
    count: (stripShown ? 1 : 0) + inRoom.length + taken,
    strip: stripShown ? { ...box(strip), motion: strip.dataset.motion, x: Number(strip.dataset.x), feet: Number(strip.dataset.feet) } : null,
    room: inRoom.length > 0 ? { ...box(inRoom[0]), motion: inRoom[0].getAttribute('data-motion') } : null,
    path: window.location.pathname,
  };
}

async function main() {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: !args.includes('--headed'), args: ['--no-first-run'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(seed, { reader: READER, pal: PAL });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  page error: ${String(error).slice(0, 200)}`));
  const samples = [];
  let sampling = false;
  const sampler = (async () => {
    for (;;) {
      if (sampling) {
        try {
          samples.push(await page.evaluate(census, PAL.id));
        } catch {
          /* between pages */
        }
      }
      await sleep(100);
      if (page.isClosed()) return;
    }
  })();
  try {
    await page.goto(`${BASE}/stream`, { waitUntil: 'domcontentloaded' });
    await page.mouse.move(600, 200);

    /* 1. a stream room with ONE PAL in it */
    await page.getByRole('button', { name: /GO LIVE|BACK TO YOUR ROOM/ }).first().click({ timeout: 120000 });
    await sleep(500);
    const startKey = page.locator('[data-go-live-start]');
    if ((await startKey.count()) > 0) await startKey.click();
    // The room the reader hosts, out of the mock's own record.
    await page.waitForFunction(
      (id) => (JSON.parse(window.localStorage.getItem('debaser.watch.v1') ?? '{"rooms":[]}').rooms ?? []).some((room) => room.hostId === id && room.endedAt === null),
      READER.id,
      { timeout: 60000 },
    );
    const roomId = await page.evaluate((id) => JSON.parse(window.localStorage.getItem('debaser.watch.v1')).rooms.find((room) => room.hostId === id && room.endedAt === null).id, READER.id);
    // Your private main room says no presence until it goes live (SPEC-rooms-perpetual.md): live it goes, from its settings.
    const wentLive = await page.evaluate(() => {
      const key = [...document.querySelectorAll('button')].find((button) => /GO LIVE/.test(button.textContent ?? '') && /WHO CAN JOIN/.test(button.parentElement?.parentElement?.textContent ?? ''));
      key?.click();
      return key !== undefined;
    });
    if (!wentLive) console.log('  --  no GO LIVE in the room settings: the room may be live already');
    await sleep(800);
    await page.keyboard.press('Escape');
    await page.evaluate(joinPal, { pal: PAL, roomId });
    if (args.includes('--debug')) {
      const heard = await page.evaluate(async () => {
        const ear = new BroadcastChannel('debaser-watch');
        const got = [];
        ear.onmessage = (event) => got.push(`${event.data.type}:${event.data.roomId ?? ''}:${event.data.member?.userId ?? ''}`);
        
        await new Promise((resolve) => setTimeout(resolve, 3000));
        return got;
      });
      console.log(`  room ${roomId}; heard on the wire: ${JSON.stringify(heard)}`);
    }
    await page.waitForFunction((id) => document.querySelector(`[data-companion="room"][data-companion-of="${id}"]`)?.style.visibility === 'visible', PAL.id, { timeout: 60000 });
    // Settled on its floor (its first frames are a climb up over the edge).
    await sleep(3000);
    const onStream = await page.evaluate(census, PAL.id);
    await page.screenshot({ path: join(SHOTS, '1-stream.png') });
    assert.equal(onStream.count, 1, `one ONE PAL in the stream room (${JSON.stringify(onStream)})`);
    pass(`ONE PAL is in the stream room with the reader: one companion of theirs on screen, at x ${onStream.strip.x}, feet ${onStream.strip.feet}`);

    /* 2. their profile, opened inside the site */
    sampling = true;
    await page.evaluate((id) => window.next.router.push(`/profile/${id}`), PAL.id);
    await page.waitForSelector('[data-profile-room-stage]', { timeout: 120000 });
    await page.locator('[data-profile-room]').scrollIntoViewIfNeeded();

    /* 3. the ROOM on screen: up it climbs */
    await page.waitForFunction((id) => document.querySelector(`[data-profile-room] [data-character-of="${id}"]`) !== null, PAL.id, { timeout: 60000 });
    await sleep(400);
    const onProfile = samples.filter((one) => one.path === `/profile/${PAL.id}`);
    const firstUp = onProfile.findIndex((one) => one.room !== null);
    const beforeUp = onProfile.slice(0, firstUp);
    assert.ok(beforeUp.length >= 3 && beforeUp.every((one) => one.room === null), `the ROOM drew no copy of ONE PAL while their companion was on the strip (${beforeUp.length} looks before it stepped in)`);
    pass(`ONE PAL's profile opened inside the site (the room still joined): for ${beforeUp.length} looks the ROOM drew no copy of them while their companion was still on the strip`);
    const climbing = beforeUp.filter((one) => one.strip !== null && one.strip.motion === 'climb');
    assert.ok(climbing.length >= 2, `it was seen climbing up to the ROOM (${climbing.length} climbing frames)`);
    const up = await page.evaluate(census, PAL.id);
    await page.screenshot({ path: join(SHOTS, '3-profile-room.png') });
    assert.equal(up.count, 1, `exactly one ONE PAL on screen, in the ROOM (${JSON.stringify(up)})`);
    assert.equal(up.strip, null, 'the strip figure is not drawn while it is up in the ROOM');
    const lastClimb = climbing[climbing.length - 1];
    const stepIn = onProfile[firstUp];
    assert.ok(Math.abs(stepIn.room.left - lastClimb.strip.x) <= 8 && Math.abs(stepIn.room.bottom - lastClimb.strip.feet) <= 8, `the ROOM's figure starts where it stepped in (climbed in at ${lastClimb.strip.x},${lastClimb.strip.feet}; in the ROOM at ${stepIn.room.left},${stepIn.room.bottom})`);
    assert.equal(stepIn.room.motion, 'wave', 'waving as it steps in');
    pass(`it climbed up into the ROOM (${climbing.length} climbing frames) and is the one figure of ONE PAL there, starting where it stepped in (${stepIn.room.left},${stepIn.room.bottom}), waving`);

    // Let it walk about a little up there, then note where it stands.
    await sleep(4000);
    const spot = await page.evaluate(census, PAL.id);
    assert.equal(spot.count, 1);

    /* 4. back to the stream: it climbs down from where it stood */
    const leaveStart = samples.length;
    await page.evaluate(() => window.next.router.push('/stream'));
    await page.waitForFunction((id) => document.querySelector(`[data-companion="room"][data-companion-of="${id}"]`)?.style.visibility === 'visible', PAL.id, { timeout: 60000 });
    const firstBack = await page.evaluate(census, PAL.id);
    await sleep(3500);
    const back = await page.evaluate(census, PAL.id);
    await page.screenshot({ path: join(SHOTS, '4-stream-again.png') });
    const down = samples.slice(leaveStart).filter((one) => one.strip !== null);
    const firstSeen = down[0] ?? firstBack;
    assert.ok(Math.abs(firstSeen.strip.x - spot.room.left) <= 24, `its first frame back is where it stood in the ROOM (stood at ${spot.room.left}, back at ${firstSeen.strip.x})`);
    assert.ok(down.some((one) => one.strip.motion === 'climb'), 'it climbed down');
    assert.equal(back.count, 1, `one ONE PAL on the stream again (${JSON.stringify(back)})`);
    pass(`back on the stream it climbed down from where it stood in the ROOM (x ${spot.room.left} -> first frame ${firstSeen.strip.x}, feet ${firstSeen.strip.feet} -> ${back.strip.feet})`);

    sampling = false;
    const twice = samples.filter((one) => one.count > 1);
    assert.equal(twice.length, 0, `never two of ONE PAL on screen (${twice.length} of ${samples.length} samples had two: ${JSON.stringify(twice.slice(0, 3))})`);
    pass(`never two of ONE PAL on screen in ${samples.length} samples, 100 ms apart, from opening the profile to back on the stream`);
    console.log(`\n${passed} passed`);
  } catch (error) {
    await page.screenshot({ path: join(SHOTS, 'failed.png') }).catch(() => undefined);
    console.log(`  at ${page.url()}; last looks: ${JSON.stringify(samples.slice(-3))}`);
    console.log(
      `  figures: ${await page
        .evaluate(() => JSON.stringify({ strip: document.querySelector('[data-companion-strip]') !== null, figures: [...document.querySelectorAll('[data-companion]')].map((el) => [el.dataset.companion, el.dataset.companionOf, el.style.visibility, el.dataset.x, el.dataset.feet]), pal: document.body.innerText.includes('ONE PAL') }))
        .catch((e) => String(e))}`,
    );
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
