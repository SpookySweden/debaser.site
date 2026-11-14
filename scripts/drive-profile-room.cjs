/*
 * A profile's room and your companion climbing up into it (Luke, 2026-11-13), in a real browser. Not in `npm run checks`:
 * it signs in as the kept test accounts. Writes nothing to the database.
 *
 *   node scripts/drive-profile-room.cjs --base https://debaser-site.vercel.app [--headed]
 *
 * As TEST ACCOUNT A (a shown character, PROFILE DRIVE, and its companion switched on), desktop width:
 *   a. on B's profile, scrolled to the room: A's companion walks over, climbs up from its strip (its feet seen above the
 *      strip) and is then in B's room, standing on its floor, beside B's character when B has one;
 *   b. on A's own profile: for 20 s, never more than one figure on screen wearing A's strip (the companion on its strip,
 *      climbing, or in the room; the room draws no copy of its own), and at the end the one in the room;
 *   c. leaving A's profile while the companion is still climbing up: it vanishes, the portal opens on its strip, and it is
 *      back on its strip within a few seconds; leaving once it is settled in the room, it climbs back down;
 *   d. reduced motion: nothing climbs; the companion is simply in B's room, standing still.
 * (2026-11-14) It climbs on its climbing frames (its back to you), and waves hello as it steps into the room; and
 *   e. as TEST ACCOUNT B (no character: its companion is the placeholder field), on A's profile: B's companion climbs into
 *      A's room and A's character waves back.
 * Screenshots in Temp/browse/profile-room-*.png.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome, installSession, signInTestAccount } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'https://debaser-site.vercel.app').replace(/\/$/, '');
const SHOTS = join('Temp', 'browse');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

async function open(browser, account, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  await context.addInitScript(() => window.localStorage.setItem('debaser.lost-account.never.v1', '1'));
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  page error: ${String(error).slice(0, 200)}`));
  await installSession(page, account);
  return page;
}

async function clearPrivacyWindow(page) {
  const close = page.locator('[data-dock-window="privacy-first-look"]').getByRole('button', { name: /^Close / });
  if ((await close.count()) > 0) await close.first().click().catch(() => undefined);
}

/** The page scrolled to its foot, where the room is. */
async function toRoom(page) {
  await page.waitForSelector('[data-profile-room-stage]', { timeout: 60000 });
  // The board, letters and comments arrive after the page: scroll again as it grows.
  for (let i = 0; i < 6; i += 1) {
    await page.evaluate(() => {
      const pane = document.querySelector('[data-scroll-pane="page"]');
      if (pane) pane.scrollTop = pane.scrollHeight;
    });
    await sleep(500);
  }
}

/** One look: the companion, the room, and every figure on screen wearing `person`'s strip. */
function look(person) {
  const bar = Number.parseFloat(document.documentElement.style.getPropertyValue('--bottom-bar')) || 0;
  const floor = window.innerHeight - bar;
  const shows = (el) => {
    let at = el;
    while (at && at !== document.body) {
      const style = window.getComputedStyle(at);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      at = at.parentElement;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
  };
  const wears = (el) => [el, ...el.querySelectorAll('*')].some((node) => (node.style?.backgroundImage ?? '').includes(person));
  const figures = [...document.querySelectorAll('[data-companion], [data-profile-character]')].filter((el) => shows(el) && wears(el));
  const own = document.querySelector('[data-companion="own"]');
  const ownBox = own && own.style.visibility === 'visible' ? own.getBoundingClientRect() : null;
  const visitor = document.querySelector('[data-companion="visiting"]');
  const stage = document.querySelector('[data-profile-room-stage]');
  const stageBox = stage ? stage.getBoundingClientRect() : null;
  const visitorBox = visitor ? visitor.getBoundingClientRect() : null;
  const portal = document.querySelector('[data-companion-portal]');
  return {
    floor: Math.round(floor),
    wearing: figures.length,
    kinds: figures.map((el) => el.getAttribute('data-companion') ?? 'profile-character'),
    own: ownBox === null ? null : { bottom: Math.round(ownBox.bottom), left: Math.round(ownBox.left), motion: own.dataset.motion ?? null },
    visitor: visitorBox === null ? null : { bottom: Math.round(visitorBox.bottom), left: Math.round(visitorBox.left), motion: visitor.getAttribute('data-motion') },
    stage: stageBox === null ? null : { bottom: Math.round(stageBox.bottom), left: Math.round(stageBox.left), right: Math.round(stageBox.right) },
    owner: document.querySelectorAll('[data-profile-room] [data-profile-character]').length,
    ownerMotion: document.querySelector('[data-profile-room] [data-profile-character]')?.getAttribute('data-motion') ?? null,
    portalOpen: portal?.getAttribute('data-open') === 'true',
    path: window.location.pathname,
  };
}

/** Watches until `done(seen)` or `ms` runs out; returns every look. */
async function watch(page, person, ms, done = () => false, every = 100) {
  const seen = [];
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const now = { at: Date.now(), ...(await page.evaluate(look, person)) };
    seen.push(now);
    if (done(now)) break;
    await sleep(every);
  }
  return seen;
}

(async () => {
  const a = await signInTestAccount('A');
  if (a.error) throw new Error(`sign-in A: ${a.error}`);
  const b = await signInTestAccount('B');
  if (b.error) throw new Error(`sign-in B: ${b.error}`);
  const A = a.userId;
  const B = b.userId;
  const browser = await chromium.launch({ executablePath: findChrome(), headless: !args.includes('--headed'), args: ['--no-first-run'] });
  try {
    /* a. B's profile */
    const page = await open(browser, a);
    await page.goto(`${BASE}/profile/${B}`, { waitUntil: 'domcontentloaded' });
    await clearPrivacyWindow(page);
    await page.waitForSelector('[data-companion="own"]', { state: 'attached', timeout: 60000 });
    await toRoom(page);
    const climbA = await watch(page, A, 40000, (s) => s.visitor !== null);
    const arrived = climbA[climbA.length - 1];
    const climbed = climbA.filter((s) => s.own !== null && s.own.bottom < s.floor - 10);
    assert.ok(arrived.visitor !== null, `A's companion reached B's room (last look ${JSON.stringify(arrived)})`);
    assert.ok(climbed.length >= 3, `its feet were seen above its strip while it climbed (${climbed.length} looks)`);
    assert.ok(climbed.every((s) => s.own.motion === 'climb'), `climbing on its climbing frames (saw ${[...new Set(climbed.map((s) => s.own.motion))].join(' ')})`);
    assert.equal(arrived.visitor.motion, 'wave', 'it waves hello as it steps into the room');
    await sleep(600);
    const inRoom = await page.evaluate(look, A);
    assert.ok(inRoom.visitor && inRoom.stage, 'still in the room');
    assert.ok(Math.abs(inRoom.visitor.bottom - inRoom.stage.bottom) <= 1, `standing on the room's floor (${inRoom.visitor.bottom} vs ${inRoom.stage.bottom})`);
    assert.ok(inRoom.visitor.left >= inRoom.stage.left - 1 && inRoom.visitor.left < inRoom.stage.right, 'inside the room');
    assert.equal(inRoom.own, null, 'and no longer on its strip');
    const lowest = Math.min(...climbed.map((s) => s.own.bottom));
    console.log(
      `  climb: ${climbed.length} looks above the strip (feet from ${climbed[0].own.bottom} up to ${lowest}px; strip at ${arrived.floor}px), ` +
        `${((arrived.at - climbA[0].at) / 1000).toFixed(1)} s from scrolling to arriving; B's own character in the room: ${inRoom.owner}`,
    );
    await page.screenshot({ path: join(SHOTS, 'profile-room-visit.png') });
    pass(`(a) on B's profile, A's companion climbed into B's room${inRoom.owner > 0 ? ', next to B\'s character' : ' (B has no shown character, so it is alone there)'}`);

    /* b. A's own profile */
    await page.goto(`${BASE}/profile/${A}`, { waitUntil: 'domcontentloaded' });
    await clearPrivacyWindow(page);
    await page.waitForSelector('[data-companion="own"]', { state: 'attached', timeout: 60000 });
    await toRoom(page);
    const own = await watch(page, A, 20000, () => false, 150);
    const most = Math.max(...own.map((s) => s.wearing));
    const counts = {};
    for (const s of own) counts[s.wearing] = (counts[s.wearing] ?? 0) + 1;
    const end = own[own.length - 1];
    assert.ok(most <= 1, `never two of A's character on screen (most at once ${most})`);
    assert.equal(own.filter((s) => s.owner > 0).length, 0, "the room never drew A's own copy");
    assert.ok(end.visitor !== null && end.wearing === 1, `the one at the end is the companion in the room (${JSON.stringify(end.kinds)})`);
    console.log(`  ${own.length} looks over 20 s; figures wearing A's strip per look: ${JSON.stringify(counts)}`);
    await page.screenshot({ path: join(SHOTS, 'profile-room-own.png') });
    pass("(b) on A's own profile, at most one of A's character on screen in every look, and it ends up in the room");

    /* c. leaving mid-climb, and leaving once settled */
    await page.goto(`${BASE}/profile/${A}`, { waitUntil: 'domcontentloaded' });
    await clearPrivacyWindow(page);
    await page.waitForSelector('[data-companion="own"]', { state: 'attached', timeout: 60000 });
    await toRoom(page);
    const rising = await watch(page, A, 30000, (s) => s.own !== null && s.own.bottom < s.floor - 40);
    assert.ok(rising[rising.length - 1].own !== null && rising[rising.length - 1].visitor === null, 'caught it climbing');
    // A client-side change of page (the layout, and the companion in it, stays): the board link in the window's tabs.
    await page.evaluate(() => document.querySelector('a[href="/forum"]').click());
    const left = Date.now();
    const back = await watch(page, A, 8000, (s) => s.path === '/forum' && s.own !== null && Math.abs(s.own.bottom - s.floor) <= 1 && !s.portalOpen, 50);
    const gone = back.filter((s) => s.own === null && !s.portalOpen);
    const portalAt = back.find((s) => s.portalOpen);
    const outAt = back.find((s) => s.portalOpen && s.own !== null);
    const home = back[back.length - 1];
    assert.ok(gone.length > 0, 'it vanished');
    assert.ok(portalAt !== undefined, 'the portal opened');
    assert.ok(home.own !== null && Math.abs(home.own.bottom - home.floor) <= 1, 'and it is back on its strip');
    const portalSecs = ((portalAt.at - left) / 1000).toFixed(1);
    const homeSecs = ((home.at - left) / 1000).toFixed(1);
    console.log(`  left mid-climb: gone, the portal open ${portalSecs} s later, stepped out ${outAt ? ((outAt.at - left) / 1000).toFixed(1) : '?'} s, back on the strip ${homeSecs} s`);
    assert.ok(home.at - left < 5000, 'within a few seconds');
    pass(`(c) leaving mid-climb, it vanished and came back out of the portal on its strip (${homeSecs} s)`);

    // Portal screenshot: once more, caught with the portal open.
    await page.goto(`${BASE}/profile/${A}`, { waitUntil: 'domcontentloaded' });
    await clearPrivacyWindow(page);
    await toRoom(page);
    await watch(page, A, 30000, (s) => s.own !== null && s.own.bottom < s.floor - 40);
    await page.evaluate(() => document.querySelector('a[href="/forum"]').click());
    await watch(page, A, 6000, (s) => s.portalOpen && s.own !== null, 50);
    await page.screenshot({ path: join(SHOTS, 'profile-room-portal.png') });

    // Settled in the room, then leaving: it climbs down from where it stood.
    await page.goto(`${BASE}/profile/${A}`, { waitUntil: 'domcontentloaded' });
    await clearPrivacyWindow(page);
    await toRoom(page);
    const settle = await watch(page, A, 40000, (s) => s.visitor !== null);
    assert.ok(settle[settle.length - 1].visitor !== null, 'in the room');
    await sleep(800);
    await page.evaluate(() => document.querySelector('a[href="/forum"]').click());
    const down = await watch(page, A, 12000, (s) => s.path === '/forum' && s.own !== null && Math.abs(s.own.bottom - s.floor) <= 1, 50);
    const descending = down.filter((s) => s.own !== null && s.own.bottom < s.floor - 10);
    const bottoms = descending.map((s) => s.own.bottom);
    assert.ok(descending.length >= 3, `seen climbing down (${descending.length} looks)`);
    assert.ok(bottoms.every((value, i) => i === 0 || value >= bottoms[i - 1]), 'only ever downward');
    assert.ok(!down.some((s) => s.portalOpen), 'no portal needed');
    console.log(`  left settled: climbed down over ${descending.length} looks, feet ${bottoms[0]} to ${down[down.length - 1].own.bottom}px`);
    pass('(c) leaving once settled in the room, it climbed back down to its strip');
    await page.context().close();

    /* d. reduced motion */
    const still = await open(browser, a, { reducedMotion: 'reduce' });
    await still.goto(`${BASE}/profile/${B}`, { waitUntil: 'domcontentloaded' });
    await clearPrivacyWindow(still);
    await still.waitForSelector('[data-companion-strip]', { state: 'attached', timeout: 60000 });
    await still.waitForSelector('[data-companion="visiting"]', { state: 'attached', timeout: 30000 });
    await toRoom(still);
    const calm = await watch(still, A, 8000, () => false, 200);
    const aboveStrip = calm.filter((s) => s.own !== null && s.own.bottom < s.floor - 1);
    assert.equal(aboveStrip.length, 0, 'nothing climbed');
    assert.ok(calm.every((s) => s.visitor !== null && s.visitor.motion === 'idle'), 'in the room throughout, standing still');
    assert.equal(new Set(calm.map((s) => s.visitor.left)).size, 1, 'not moving');
    await still.screenshot({ path: join(SHOTS, 'profile-room-reduced.png') });
    pass(`(d) reduced motion: no climbing; it was simply in B's room, still, in all ${calm.length} looks`);
    await still.context().close();

    /* e. B's companion on A's profile: A's character waves back */
    const guest = await open(browser, b);
    await guest.goto(`${BASE}/profile/${A}`, { waitUntil: 'domcontentloaded' });
    // Headless Chrome reports no mouse until the first move, and the site would take it for a phone.
    await guest.mouse.move(700, 300);
    await clearPrivacyWindow(guest);
    await guest.waitForSelector('[data-companion="own"]', { state: 'attached', timeout: 60000 });
    await toRoom(guest);
    const before = await watch(guest, A, 40000, (s) => s.visitor !== null);
    const stepped = before[before.length - 1];
    assert.ok(stepped.visitor !== null, `B's companion reached A's room (last look ${JSON.stringify(stepped)})`);
    assert.equal(stepped.owner, 1, "A's character is in its room");
    assert.equal(stepped.visitor.motion, 'wave', "B's companion waves hello as it steps in");
    const hello = await watch(guest, A, 4000, (s) => s.ownerMotion === 'wave');
    assert.equal(hello[hello.length - 1].ownerMotion, 'wave', `A's character waves back (saw ${[...new Set(hello.map((s) => s.ownerMotion))].join(' ')})`);
    await guest.screenshot({ path: join(SHOTS, 'profile-room-hello.png') });
    pass(`(e) B's companion climbed into A's room and waved; A's character waved back ${((hello[hello.length - 1].at - stepped.at) / 1000).toFixed(1)} s later`);
    await guest.context().close();
  } finally {
    await browser.close();
  }
  console.log(`\n${passed} passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
