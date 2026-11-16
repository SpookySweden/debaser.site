/*
 * Luke's second list, COMPANION (2026-11-16), in a real browser against a LOCAL dev server on mock data. Not in
 * `npm run checks`: it needs that server. It never touches the live site or the live database (supabase is blocked), and
 * leaves nothing: everything it makes is in the test browser's own storage.
 *
 *   node Temp/browse/dev-mock-companion.cjs 3318     (every switch on mock, the Supabase address and key empty)
 *   node scripts/drive-companion-grab.cjs --base http://localhost:3318 [--measure-only] [--headed]
 *
 *   a. arriving on a page, the companion climbs up over the edge of its floor from behind it (never just there);
 *   b. picked up and dragged, it stays under the pointer on every move (no frame of lag), leaning back against the drag;
 *      the time between its moves and the gap to the pointer are measured;
 *   c. thrown, it is drawn every display frame in the air, not ten times a second; frame times are measured;
 *   d. on a profile, anybody (signed out here) can drag the ROOM's character out of its window and throw it; let go, it
 *      lands, walks to under its room, climbs back in on its climbing frames and waves;
 *   e. the voice key is a symbol: `[ ♪ ]`, the note struck through while off, no words, its name and tip in words;
 *   f. under reduced motion: no climbing in, and a ROOM's character cannot be taken out (a press is still a hello);
 *   g. one look at phone width: no sideways scroll.
 * `--measure-only` prints the numbers of b and c without judging them (for a before-and-after on the old code).
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3318').replace(/\/$/, '');
const MEASURE = flag('--measure-only');
if (!/localhost|127\.0\.0\.1/.test(BASE)) {
  console.log('This drive is for a local dev server on mock data only (core.md: test locally, not on the live site).');
  process.exit(2);
}
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const OWNER = { id: 'grab-owner', name: 'GRAB OWNER' };
const READER = { id: 'grab-reader', name: 'GRAB READER' };

/** Runs in the page before anything else: the mock stores, filled. */
function seed({ owner, reader, session, companion }) {
  if (!/^localhost$|^127\.0\.0\.1$/.test(window.location.hostname)) return;
  const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString();
  const user = (person) => ({ id: person.id, email: `${person.id}@debaser.site`, displayName: person.name, createdAt: at(5000), salt: '', secretHash: '', hidden: true });
  window.localStorage.setItem('debaser.lost-account.never.v1', '1');
  window.localStorage.setItem('debaser-companion', JSON.stringify({ computer: companion, phone: false }));
  window.localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ users: [user(owner), user(reader)], sessionUserId: session, bannedIds: [] }));
  const comments = [{ id: 'grab-c1', kind: 'profile', author: { id: owner.id, displayName: owner.name }, body: 'Pick me up and throw me.', createdAt: at(20) }];
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
  window.localStorage.setItem('debaser.profile.mock.v1', JSON.stringify({ version: 1, profiles: { [owner.id]: profile(owner, { comments }), [reader.id]: profile(reader) } }));
  // A stand-in strip: one cell, one plain block of colour. A test fixture in this browser only, never on the site.
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 24;
  const pen = canvas.getContext('2d');
  pen.fillStyle = 'rgb(255,240,0)';
  pen.fillRect(2, 0, 12, 24);
  const motion = { facing: 'front', loop: true, ticks: [0] };
  const core = ['stand', 'idle', 'walk', 'dance1', 'dance2', 'dance3', 'wave', 'hop', 'turn', 'sit', 'sleep'];
  const sheet = { v: 1, cell: { w: 16, h: 24 }, columns: 1, cells: 1, fps: 10, floor: 24, head: 0, motions: Object.fromEntries(core.map((id) => [id, motion])) };
  const shown = { characterId: 'grab-test', mood: 'calm', stripUrl: canvas.toDataURL('image/png'), sheet, bakedAt: at(100) };
  window.localStorage.setItem('debaser.profile-character.v1', JSON.stringify({ [owner.id]: shown }));
}

async function open(browser, path, { session = null, companion = false, reduced = false, viewport = { width: 1440, height: 900 } } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  // Cut off from the live database, whatever the server was started with.
  await context.route(/supabase\.co/, (route) => route.abort());
  await context.addInitScript(seed, { owner: OWNER, reader: READER, session, companion });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  page error: ${String(error).slice(0, 200)}`));
  // A headless browser reports no mouse until it moves, and the site would take it for a phone.
  await page.mouse.move(700, 300);
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await page.mouse.move(700, 310);
  return { context, page };
}

/** The companion as the page draws it, and where the rules have it this frame. */
const readOwn = () => {
  const own = document.querySelector('[data-companion="own"]');
  if (own === null || own.style.visibility !== 'visible') return null;
  const box = own.getBoundingClientRect();
  const bar = Number.parseFloat(document.documentElement.style.getPropertyValue('--bottom-bar')) || 0;
  return {
    left: box.left,
    bottom: box.bottom,
    w: box.width,
    h: box.height,
    feet: Number(own.dataset.feet),
    floor: Math.round(window.innerHeight - bar),
    motion: own.dataset.motion,
    held: own.dataset.held,
    stage: own.dataset.throw ?? '',
    body: own.querySelector('[data-companion-figure]')?.style.transform ?? '',
  };
};

/** Watches a figure's place in the page: every change of its transform, timed, and every display frame's place. */
function watchPlace(selector) {
  const place = document.querySelector(selector);
  const seen = { moves: [], frames: [], stop: false };
  window.__watch = seen;
  new MutationObserver(() => seen.moves.push(performance.now())).observe(place, { attributes: true, attributeFilter: ['style'] });
  const frame = (t) => {
    if (seen.stop) return;
    const box = place.getBoundingClientRect();
    seen.frames.push({ t, x: box.left, y: box.bottom, stage: place.dataset.throw ?? '' });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? NaN : sorted[Math.floor(sorted.length / 2)];
};
const pct = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? NaN : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};

async function companionSteps(browser) {
  const { context, page } = await open(browser, '/forum', { session: READER.id, companion: true });
  // a. Arriving: it climbs up over its floor's edge from behind it.
  const sightings = [];
  for (let i = 0; i < 400; i += 1) {
    const own = await page.evaluate(readOwn);
    if (own !== null) {
      sightings.push(own);
      if (own.feet === own.floor && own.motion !== 'climb' && sightings.length > 1) break;
    }
    await sleep(25);
  }
  const first = sightings[0];
  assert.ok(first !== undefined, 'the companion is out');
  if (!MEASURE) {
    assert.ok(first.feet > first.floor, `first seen below its floor, coming up (feet ${first.feet}, floor ${first.floor})`);
    assert.ok(sightings.some((seen) => seen.motion === 'climb'), 'on its climbing frames');
    const climbing = sightings.filter((seen) => seen.motion === 'climb').map((seen) => seen.feet);
    assert.ok(climbing.every((feet, i) => i === 0 || feet <= climbing[i - 1]), 'only ever up');
    assert.equal(sightings[sightings.length - 1].feet, first.floor, 'and stands on its floor');
    pass(`a. arriving, it climbs up over the edge of its floor from behind it (${climbing.length} climbing frames seen, from ${first.feet - first.floor}px below)`);
  }
  await sleep(600);

  // b. Picked up and dragged.
  const own = await page.evaluate(readOwn);
  const grabX = own.left + own.w / 2;
  const grabY = own.bottom - own.h / 2;
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.mouse.move(grabX, grabY - 20, { steps: 2 });
  await sleep(150);
  await page.evaluate(watchPlace, '[data-companion="own"]');
  const lags = [];
  const leans = [];
  let px = grabX;
  let py = grabY - 20;
  for (let i = 0; i < 40; i += 1) {
    px += i < 20 ? -14 : 14;
    py -= i < 10 ? 6 : i < 30 ? -3 : 3;
    await page.mouse.move(px, py);
    const at = await page.evaluate(readOwn);
    // Where it hangs from: the point taken hold of, as far from its left edge and foot as when it was picked up.
    lags.push(Math.round(Math.hypot(at.left + own.w / 2 - px, at.bottom - own.h / 2 - py + 0)));
    leans.push(at.body);
    await sleep(16);
  }
  const moves = await page.evaluate(() => {
    const t = window.__watch.moves;
    window.__watch.stop = true;
    return t.slice(1).map((now, i) => now - t[i]).filter((gap) => gap > 1);
  });
  const lagMax = Math.max(...lags);
  const lagMedian = median(lags);
  console.log(`  measure: dragging, its place changed every ${median(moves).toFixed(1)} ms (median, ${moves.length} changes); gap to the pointer median ${lagMedian}px, worst ${lagMax}px`);
  if (!MEASURE) {
    assert.ok(lagMax <= 2, `under the pointer on every move (worst gap ${lagMax}px)`);
    assert.ok(leans.some((text) => /matrix\(/.test(text)), 'leaning back against the drag (its own frame sheared)');
    pass(`b. dragged, it stays under the pointer on every move (worst gap ${lagMax}px) and leans back against the drag`);
  }

  // c. Thrown: drawn every display frame in the air.
  await page.evaluate(watchPlace, '[data-companion="own"]');
  for (let i = 0; i < 5; i += 1) {
    px += 45;
    py -= 30;
    await page.mouse.move(px, py);
    await sleep(10);
  }
  await page.mouse.up();
  await sleep(2500);
  const flight = await page.evaluate(() => {
    window.__watch.stop = true;
    return window.__watch.frames;
  });
  const flying = flight.filter((seen) => seen.stage === 'fly');
  const frameTimes = flight.slice(1).map((seen, i) => seen.t - flight[i].t);
  let places = 0;
  let jump = 0;
  for (let i = 1; i < flying.length; i += 1) {
    const step = Math.hypot(flying[i].x - flying[i - 1].x, flying[i].y - flying[i - 1].y);
    if (step > 0) places += 1;
    jump = Math.max(jump, step);
  }
  const spanMs = flying.length > 1 ? flying[flying.length - 1].t - flying[0].t : 0;
  const perSecond = spanMs > 0 ? Math.round((places / spanMs) * 1000) : 0;
  console.log(
    `  measure: thrown, ${places} places in ${Math.round(spanMs)} ms of flight (${perSecond} a second), biggest step between display frames ${Math.round(jump)}px; display frame times median ${median(frameTimes).toFixed(1)} ms, 95th ${pct(frameTimes, 0.95).toFixed(1)} ms`,
  );
  if (!MEASURE) {
    assert.ok(flying.length > 5, 'it flew');
    assert.ok(perSecond >= 25, `drawn far more often than ten times a second in the air (${perSecond})`);
    pass(`c. thrown, it is drawn ${perSecond} times a second in the air (was ten)`);
  }
  await context.close();
}

async function roomSteps(browser) {
  // d. Signed out: anybody may take the ROOM's character out.
  const { context, page } = await open(browser, `/profile/${OWNER.id}`);
  await page.waitForSelector('[data-profile-room] [data-profile-character="owner"]', { timeout: 120_000 });
  // e. The voice key, while it is here.
  const key = page.locator('[data-profile-room] [data-speech-audio]');
  if (!MEASURE && (await key.count()) > 0) {
    const off = await key.evaluate((el) => ({ text: el.textContent.trim(), struck: window.getComputedStyle(el.querySelector('span')).textDecorationLine, label: el.getAttribute('aria-label'), tip: el.getAttribute('title') }));
    assert.equal(off.text, '[ ♪ ]', 'a symbol, no words');
    assert.match(off.struck, /line-through/, 'the note struck through while off');
    assert.ok(off.label.length > 0 && off.tip.length > 0, 'a name and a tip in words');
    await key.click();
    const on = await key.evaluate((el) => ({ text: el.textContent.trim(), struck: window.getComputedStyle(el.querySelector('span')).textDecorationLine, pressed: el.getAttribute('aria-pressed') }));
    assert.equal(on.text, '[ ♪ ]');
    assert.equal(on.pressed, 'true');
    assert.doesNotMatch(on.struck, /line-through/, 'on: not struck through');
    await key.click();
    pass('e. the voice key is `[ ♪ ]`, struck through while off, filled while on, with its name and tip in words');
  } else if (!MEASURE) console.log('  (e. skipped: nobody in the room has something to say)');

  await page.locator('[data-profile-room]').evaluate((room) => room.scrollIntoView({ block: 'center' }));
  await sleep(500);
  const figure = page.locator('[data-profile-room] [data-profile-character="owner"]');
  const box = await figure.boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 10, startY - 20, { steps: 3 });
  await page.waitForSelector('[data-loose-character]', { timeout: 5000 });
  assert.equal(await page.locator('[data-room-figure-out="true"]').count(), 1, 'its place in the room is empty while it is out');
  // Carried: under the pointer.
  let px = startX - 10;
  let py = startY - 20;
  const lags = [];
  for (let i = 0; i < 15; i += 1) {
    px += 12;
    py -= 8;
    await page.mouse.move(px, py);
    const at = await page.locator('[data-loose-character]').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, bottom: r.bottom };
    });
    lags.push(Math.round(Math.hypot(at.x + box.width / 2 - px, at.bottom - box.height / 2 - py)));
    await sleep(16);
  }
  // Thrown to the left.
  for (let i = 0; i < 5; i += 1) {
    px -= 40;
    py -= 10;
    await page.mouse.move(px, py);
    await sleep(10);
  }
  await page.mouse.up();
  const story = [];
  for (let i = 0; i < 600; i += 1) {
    const now = await page.evaluate(() => {
      const loose = document.querySelector('[data-loose-character]');
      const back = document.querySelector('[data-profile-room] [data-profile-character="owner"]');
      const bar = Number.parseFloat(document.documentElement.style.getPropertyValue('--bottom-bar')) || 0;
      if (loose === null) return { out: false, back: back?.getAttribute('data-motion') ?? null };
      return { out: true, motion: loose.dataset.motion, stage: loose.dataset.throw ?? '', feet: Number(loose.dataset.feet), floor: Math.round(window.innerHeight - bar) };
    });
    story.push(now);
    if (!now.out) break;
    await sleep(50);
  }
  const last = story[story.length - 1];
  if (!MEASURE) {
    console.log(`  (room gaps: ${lags.join(" ")})`);
    assert.ok(Math.max(...lags) <= 2, `carried out of the room, it stays under the pointer (worst gap ${Math.max(...lags)}px)`);
    assert.ok(story.some((seen) => seen.out && seen.stage === 'fly'), 'thrown, it flies');
    assert.ok(story.some((seen) => seen.out && seen.stage === '' && seen.feet === seen.floor), 'down on the floor');
    // It walks only when it came down beyond the ends of its room; under it, it climbs at once.
    const walked = story.filter((seen) => seen.out && seen.motion === 'walk' && seen.feet === seen.floor).length;
    console.log(`  (it walked ${walked} frames along the floor before climbing)`);
    const climbing = story.filter((seen) => seen.out && seen.motion === 'climb');
    assert.ok(climbing.length >= 3, `then climbs (${climbing.length} climbing frames seen)`);
    assert.ok(climbing[climbing.length - 1].feet < climbing[0].feet, 'up');
    assert.equal(last.out, false, 'and is back in its room');
    assert.equal(last.back, 'wave', 'waving as it steps in');
    assert.equal(await page.locator('[data-room-figure-out="true"]').count(), 0);
    pass(`d. signed out, the ROOM's character is dragged out (worst gap ${Math.max(...lags)}px), thrown, walks, climbs ${climbing.length} frames back up into its room and waves`);
  }
  // A press without a drag is still a hello, not a grab: right after it came back too (its release never reached the key).
  await page.waitForFunction(() => {
    const back = document.querySelector('[data-profile-room] [data-profile-character="owner"]');
    return back !== null && !['wave', 'hop', 'turn'].includes(back.getAttribute('data-motion'));
  }, null, { timeout: 15_000 });
  // A press while it is saying something is left alone on purpose (it would cut its bubble off): press between lines.
  let hello = false;
  for (let tries = 0; tries < 6 && !hello; tries += 1) {
    await page.waitForFunction(() => document.querySelector('[data-profile-room] [data-speech-bubble]') === null, null, { timeout: 30_000 });
    await figure.click();
    hello = await page
      .waitForFunction(() => ['wave', 'hop', 'turn'].includes(document.querySelector('[data-profile-room] [data-profile-character="owner"]')?.getAttribute('data-motion')), null, { timeout: 1000 })
      .then(() => true, () => false);
    // Tried again only when it started talking in that moment; a press that was simply swallowed is the failure.
    if (!hello && (await page.locator('[data-profile-room] [data-speech-bubble]').count()) === 0) break;
  }
  if (!MEASURE) {
    assert.equal(await page.locator('[data-loose-character]').count(), 0, 'a press is not a grab');
    assert.ok(hello, 'and the first press after it came back says hello (it was swallowed once)');
    pass('d. a press without a drag is still a hello, the first one after it came back included');
  }
  await context.close();
}

async function reducedSteps(browser) {
  const { context, page } = await open(browser, `/profile/${OWNER.id}`, { session: READER.id, companion: true, reduced: true });
  await page.waitForSelector('[data-profile-room] [data-profile-character="owner"]', { timeout: 120_000 });
  const motions = [];
  for (let i = 0; i < 40; i += 1) {
    const own = await page.evaluate(readOwn);
    if (own !== null) motions.push(own.motion);
    await sleep(25);
  }
  assert.ok(!motions.includes('climb'), 'no climbing in under reduced motion');
  await page.locator('[data-profile-room]').evaluate((room) => room.scrollIntoView({ block: 'center' }));
  const box = await page.locator('[data-profile-room] [data-profile-character="owner"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 60, box.y - 80, { steps: 4 });
  await page.mouse.up();
  await sleep(300);
  assert.equal(await page.locator('[data-loose-character]').count(), 0, 'a ROOM character is not taken out under reduced motion');
  pass('f. under reduced motion: no climbing in, and a ROOM character stays in its room');
  await context.close();
}

async function phoneStep(browser) {
  const { context, page } = await open(browser, `/profile/${OWNER.id}`, { viewport: { width: 390, height: 844 } });
  await page.waitForSelector('[data-profile-room]', { timeout: 120_000 });
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(wide <= 0, `no sideways scroll at phone width (${wide}px)`);
  pass('g. phone width: no sideways scroll');
  await context.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: !flag('--headed') });
  try {
    await companionSteps(browser);
    if (!MEASURE) await roomSteps(browser);
    if (!MEASURE) {
      await reducedSteps(browser);
      await phoneStep(browser);
    }
    console.log(`\n${passed} passed`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
