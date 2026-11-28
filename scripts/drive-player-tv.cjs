/*
 * Drives the player bar's TV (SPEC-player-tv.md) in a real browser on a LOCAL dev server with mock data: no sign-in,
 * no database. Not in `npm run checks`: it needs a running site.
 *
 *   node scripts/drive-player-tv.cjs --serve          (starts and stops its own mock dev server on port 3347)
 *   node scripts/drive-player-tv.cjs --base http://localhost:<port>
 *
 * It records its own test clip (left half red, right half blue, a white square crossing the top), so what is on the TV's
 * screen can be compared with a known picture. GUY is baked by the workbench's own bake as the mock account's character,
 * so the way down to the seat is seen as a real character does it. Screenshots go to Temp/browse/player-tv/.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { spawn, execSync } = require('node:child_process');
const { mkdirSync, readFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const join_ = join;
const http = require('node:http');
const sharp = require('sharp');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const SERVE = flag('--serve');
const PORT = 3347;
const BASE = opt('--base', `http://localhost:${PORT}`).replace(/\/$/, '');
if (!/localhost|127\.0\.0\.1/.test(BASE)) {
  console.log('This drive is for a local dev server on mock data only (core.md: test locally, not on the live site).');
  process.exit(2);
}
const SHOTS = join('Temp', 'browse', 'player-tv');
// A part run (`--rest`, `--shots`) keeps the pictures of the run before it.
if (!process.argv.includes('--rest') && !process.argv.includes('--shots')) rmSync(SHOTS, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const failed = [];
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};
/** A check that fails is written down and the drive goes on, so one run tells everything. */
const check = (condition, what, detail = '') => {
  if (condition) pass(what);
  else {
    failed.push(what);
    console.log(`  FAIL ${what} ${detail}`);
  }
};
const note = (what) => console.log(`  NOTE ${what}`);

const PERSON = 'mock-test-account';
const AUTH = {
  users: [{ id: PERSON, email: 'test-mock@debaser.site', displayName: 'TEST ACCOUNT (MOCK)', createdAt: '2026-11-14T00:00:00.000Z', salt: '', secretHash: '', hidden: true }],
  sessionUserId: PERSON,
  bannedIds: [],
};
const CLIP_PATH = '/__tv/clip.webm';

function seed({ auth, shown, item }) {
  window.localStorage.setItem('debaser.lost-account.never.v1', '1');
  window.localStorage.setItem('debaser.tour.v2', 'skipped');
  if (auth !== null) window.localStorage.setItem('debaser.auth.mock.v1', JSON.stringify(auth));
  if (shown !== null) window.localStorage.setItem('debaser.profile-character.v1', JSON.stringify(shown));
  if (item !== null) window.localStorage.setItem('debaser.media.items.v1', JSON.stringify([item]));
  window.__ways = [];
  setInterval(() => {
    const own = document.querySelector('[data-companion="own"]');
    const tv = own?.dataset.tv ?? null;
    if (tv === null) return;
    const r = own.getBoundingClientRect();
    const last = window.__ways[window.__ways.length - 1];
    if (!last || last.tv !== tv || last.y !== Math.round(r.top) || last.x !== Math.round(r.left)) window.__ways.push({ tv, x: Math.round(r.left), y: Math.round(r.top) });
  }, 40);
  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = 'nextjs-portal{display:none !important}';
    document.head.appendChild(style);
  });
}

const ITEM = {
  id: 'drive-video',
  kind: 'video',
  bucket: 'x',
  path: 'x',
  src: `${BASE}${CLIP_PATH}`,
  sha256: 'x',
  bytes: 1000,
  mime: 'video/webm',
  length: '0:25',
  title: 'The TV Test Clip',
  credit: '',
  tags: [],
  source: 'upload',
  uploadedBy: PERSON,
  uploadedByLabel: 'TEST ACCOUNT (MOCK)',
  createdAt: '2026-11-28T00:00:00.000Z',
};

let clip = null;
/** Requests the page tried to make to the live site or a database: refused, and a failure of the drive. */
const reachedOut = [];
const consoleErrors = new Set();

async function openPage(browser, shown, { width = 1440, height = 900, reduced = false, signedOut = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await context.addInitScript(seed, { auth: signedOut ? null : AUTH, shown, item: ITEM });
  await context.route(/^https?:\/\/([^/]*\.)?(debaser\.site|supabase\.co)(:\d+)?\//, (route) => {
    reachedOut.push(new URL(route.request().url()).host);
    return route.abort();
  });
  if (clip !== null) await context.route(`**${CLIP_PATH}`, (route) => route.fulfill({ status: 200, contentType: 'video/webm', body: clip }));
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  page error: ${String(error).slice(0, 300)}`));
  page.on('console', (message) => message.type() === 'error' && consoleErrors.add(message.text().slice(0, /hydrat/.test(message.text()) ? 2500 : 220)));
  return { context, page };
}

async function go(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.mouse.move(700, 300);
  await sleep(2500);
  const close = page.locator('[data-dock-window="privacy-first-look"]').getByRole('button', { name: /^Close / });
  if ((await close.count()) > 0) await close.first().click().catch(() => undefined);
}

/** The test clip, recorded here from a canvas: 25 s at 160 x 90. */
async function record(browser) {
  const { context, page } = await openPage(browser, null);
  await page.goto(`${BASE}/__tv/blank`, { waitUntil: 'domcontentloaded', timeout: 180000 }).catch(() => undefined);
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const g = canvas.getContext('2d');
    let step = 0;
    const draw = () => {
      g.fillStyle = '#e00000';
      g.fillRect(0, 0, 80, 90);
      g.fillStyle = '#0000e0';
      g.fillRect(80, 0, 80, 90);
      g.fillStyle = '#ffffff';
      g.fillRect((step * 8) % 140, 0, 20, 20);
      step += 1;
    };
    draw();
    const timer = setInterval(draw, 100);
    const recorder = new MediaRecorder(canvas.captureStream(20), { mimeType: 'video/webm;codecs=vp8' });
    const parts = [];
    recorder.ondataavailable = (event) => parts.push(event.data);
    const done = new Promise((resolve) => (recorder.onstop = resolve));
    recorder.start(500);
    await new Promise((resolve) => setTimeout(resolve, 25000));
    recorder.stop();
    await done;
    clearInterval(timer);
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.readAsDataURL(new Blob(parts, { type: 'video/webm' }));
    });
  });
  await context.close();
  return Buffer.from(base64, 'base64');
}

/** GUY, baked by the dev workbench's own bake. */
async function bake(browser) {
  const { context, page } = await openPage(browser, null);
  await go(page, `/profile/${PERSON}`);
  await page.getByRole('button', { name: '[ EDIT PROFILE ]' }).first().click({ timeout: 120000 });
  await page.getByRole('button', { name: '[ CHAR 🐰 ]' }).click({ timeout: 120000 });
  await page.waitForFunction(() => window.__characterBakeProof !== undefined, null, { timeout: 180000 });
  const baked = await page.evaluate(async () => {
    const hook = window.__characterBakeProof;
    hook.applyPreset('guy');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const made = await hook.bakeCharacter(hook.figure(), 'guy');
    const stripUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(made.strip);
    });
    return { stripUrl, sheet: made.sheet };
  });
  await context.close();
  return baked;
}

const readOwn = () => {
  const own = document.querySelector('[data-companion="own"]');
  if (own === null) return null;
  const box = own.getBoundingClientRect();
  const layer = own.closest('[data-companion-strip]');
  const seat = [...document.querySelectorAll('[data-tv-seat]')].map((el) => el.getBoundingClientRect()).find((r) => r.width > 0) ?? null;
  return {
    visible: own.style.visibility === 'visible',
    figure: own.querySelector('[data-companion-figure]')?.getAttribute('data-companion-figure') ?? null,
    tv: own.dataset.tv ?? null,
    half: own.dataset.half === 'true',
    x: Math.round(box.left),
    y: Math.round(box.top),
    w: Math.round(box.width),
    h: Math.round(box.height),
    over: layer?.dataset.over ?? null,
    z: layer === null || layer === undefined ? null : Number(getComputedStyle(layer).zIndex),
    seat: seat === null ? null : { x: Math.round(seat.left), y: Math.round(seat.top), w: Math.round(seat.width), h: Math.round(seat.height) },
  };
};

const readTv = () => {
  const tv = document.querySelector('[data-player-tv]');
  const led = document.querySelector('[data-bar-led]');
  const canvas = tv?.querySelector('[data-tv-picture]') ?? null;
  const pixel = (x, y) => (canvas === null ? null : [...canvas.getContext('2d').getImageData(x, y, 1, 1).data]);
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  };
  let strip = null;
  try {
    strip = canvas === null ? null : Array.from({ length: 12 }, (_, i) => pixel(5 + i * 10, 6)[1] > 150 ? 1 : 0).join('');
  } catch {
    strip = 'tainted';
  }
  const blocks = {};
  for (const el of tv?.querySelectorAll('[data-tv-block]') ?? []) blocks[el.dataset.tvBlock] = (blocks[el.dataset.tvBlock] ?? 0) + 1;
  let left = null;
  let right = null;
  try {
    left = pixel(30, 45);
    right = pixel(90, 45);
  } catch {
    left = 'tainted';
  }
  return {
    shows: tv?.getAttribute('data-player-tv') ?? null,
    count: document.querySelectorAll('[data-player-tv]').length,
    inRoomBar: tv?.closest('[data-stream-bar-screen]') !== null && tv !== null,
    box: box(tv),
    led: box(led),
    bar: box(led?.closest('.fixed') ?? null),
    screens: tv?.querySelectorAll('[data-tv-screen]').length ?? 0,
    blocks,
    frames: Number(canvas?.dataset.tvFrames ?? 0),
    still: canvas?.dataset.tvStill ?? null,
    left,
    right,
    strip,
    sideScroll: document.documentElement.scrollWidth - window.innerWidth,
  };
};

/** The screen's four corners where the page really puts them. */
const readCorners = () => {
  const screen = document.querySelector('[data-tv-screen]');
  if (screen === null) return null;
  const marks = [['0', '0'], ['100%', '0'], ['100%', '100%'], ['0', '100%']].map(([left, top]) => {
    const mark = document.createElement('i');
    mark.style.cssText = `position:absolute;left:${left};top:${top};width:0;height:0`;
    screen.appendChild(mark);
    return mark;
  });
  const corners = marks.map((mark) => {
    const r = mark.getBoundingClientRect();
    mark.remove();
    return [Number(r.left.toFixed(1)), Number(r.top.toFixed(1))];
  });
  return corners;
};

/** Bar keys, and which of them a click at the middle would not reach because the companion is on top. */
const readKeys = () => {
  const own = document.querySelector('[data-companion="own"]');
  const led = document.querySelector('[data-bar-led]');
  const bar = led?.closest('.fixed') ?? null;
  const keys = [...(bar?.querySelectorAll('button, input') ?? [])].filter((key) => key.getBoundingClientRect().width > 0);
  const covered = keys.filter((key) => {
    const r = key.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return at !== null && own !== null && own.contains(at);
  });
  return { keys: keys.length, covered: covered.map((key) => key.getAttribute('aria-label') || key.textContent.trim()) };
};

async function barShot(page, name, label) {
  const view = page.viewportSize();
  if (label) {
    await page.evaluate((words) => {
      const tag = document.createElement('div');
      tag.id = 'drive-label';
      tag.textContent = words;
      tag.style.cssText = 'position:fixed;left:8px;bottom:150px;z-index:99999;background:#fff;color:#000;border:2px solid #000;padding:4px 8px;font:bold 14px monospace';
      document.body.appendChild(tag);
    }, label);
  }
  await page.screenshot({ path: join(SHOTS, `${name}.png`), clip: { x: 0, y: view.height - 200, width: view.width, height: 200 } });
  if (label) await page.evaluate(() => document.getElementById('drive-label')?.remove());
}

/** A close look at the TV and its seat, twice the size. */
async function closeShot(page, name) {
  const tv = await page.evaluate(readTv);
  if (tv.box === null) return;
  const view = page.viewportSize();
  const clipBox = { x: Math.max(0, tv.box.x - 60), y: Math.max(0, tv.box.y - 80), width: Math.min(220, view.width), height: 0 };
  clipBox.height = Math.min(170, view.height - clipBox.y);
  const shot = await page.screenshot({ clip: clipBox });
  await sharp(shot).resize({ width: clipBox.width * 3, kernel: 'nearest' }).toFile(join(SHOTS, `${name}.png`));
}

async function pressPlay(page) {
  await go(page, '/files?kind=video');
  await sleep(1500);
  // The shelf, then the file's own fold: whichever `[+]` is first, until its PLAY shows.
  const plays = page.getByRole('button', { name: /^Play ".*" here$/ });
  for (let i = 0; i < 3 && (await plays.count()) === 0; i += 1) {
    await page.locator('main button', { hasText: '[+]' }).first().click();
    await sleep(700);
  }
  await plays.first().click();
}

/** Signed in: your room opens on the clip. The clip is looped, so it outlasts the drive. */
async function playInRoom(page) {
  await pressPlay(page);
  const join = page.getByRole('button', { name: /JOIN PLAYBACK/ });
  await join.first().click({ timeout: 8000 }).catch(() => undefined);
  const found = await page.waitForFunction(() => document.querySelector('video') !== null, null, { timeout: 30000 }).then(() => true).catch(() => false);
  await sleep(2000);
  if ((await join.count()) > 0) await join.first().click({ timeout: 3000 }).catch(() => undefined);
  await page.evaluate(() => {
    for (const video of document.querySelectorAll('video')) {
      video.loop = true;
      video.muted = true;
      void video.play().catch(() => undefined);
    }
  });
  await sleep(1500);
  console.log(`  in the room: ${JSON.stringify(await page.evaluate(() => ({ strip: document.querySelector('[data-stream-bar-screen]') !== null, videos: [...document.querySelectorAll('video')].map((v) => [v.paused, v.readyState, v.videoWidth, Math.round(v.currentTime * 10) / 10]) })))}`);
  await page.screenshot({ path: join_(SHOTS, 'room-playing.png') });
  return found;
}

/** Signed out: the floating player. */
async function playFloat(page) {
  await pressPlay(page);
  await sleep(2500);
  await page.screenshot({ path: join_(SHOTS, 'float-playing.png') });
  const found = await page.waitForSelector('[data-floating-player] video', { state: 'attached', timeout: 20000 }).then(() => true).catch(() => false);
  if (found) {
    await page.evaluate(() => {
      const video = document.querySelector('[data-floating-player] video');
      video.loop = true;
      video.muted = true;
      void video.play().catch(() => undefined);
    });
  }
  return found;
}

async function openBar(page) {
  if ((await page.locator('[data-bar-led]').count()) > 0) return;
  const tile = page.locator('span[data-companion-avoid] > button').first();
  if ((await tile.count()) > 0) await tile.click();
  await sleep(500);
}

/** Main-thread time spent over some seconds, as the browser counts it: percent of one core. */
async function cost(page, session, seconds) {
  const task = async () => (await session.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration').value;
  const before = await task();
  await sleep(seconds * 1000);
  return (((await task()) - before) / seconds) * 100;
}

/** A YouTube video played from /media: the room's strip, and the TV showing its stills. */
async function mediaRoom(browser, shown) {
  console.log("A video in your room: the room's strip");
  {
    const { context: roomContext, page: room } = await openPage(browser, shown);
    await go(room, '/media');
    const row = room.locator('li').filter({ hasText: '▶ PLAY' }).filter({ hasText: 'real YouTube video' }).first();
    const found = await row.waitFor({ timeout: 90000 }).then(() => true).catch(() => false);
    if (!found) note(`no mock YouTube row on /media here; rows: ${JSON.stringify((await room.locator('li').filter({ hasText: '▶ PLAY' }).allInnerTexts()).slice(0, 4).map((t) => t.slice(0, 80)))}`);
    else {
      await sleep(1500);
      await row.getByRole('button', { name: /^Play "/ }).click();
      const strip = await room.waitForSelector('[data-stream-bar-screen]', { timeout: 30000 }).then(() => true).catch(() => false);
      check(strip, "the room's strip takes the bar");
      await room.getByRole('button', { name: /JOIN PLAYBACK/ }).first().click({ timeout: 8000 }).catch(() => undefined);
      await room.waitForSelector('[data-stream-bar-screen] [data-player-tv]', { timeout: 30000 }).catch(() => undefined);
      await sleep(9000);
      const seen = await room.evaluate(readTv);
      const own = await room.evaluate(readOwn);
      console.log(`  room strip: ${JSON.stringify({ shows: seen.shows, still: seen.still, bar: seen.bar, tv: seen.box, own: own?.tv })}`);
      check(seen.inRoomBar && seen.count === 1, 'one TV, in the room strip', JSON.stringify({ count: seen.count, inRoomBar: seen.inRoomBar }));
      check(seen.shows === 'stills' && seen.still !== null, 'a YouTube video shows a still on the screen', JSON.stringify({ shows: seen.shows, still: seen.still }));
      check(own?.tv === 'seat', 'and the character sits by it', JSON.stringify(own));
      check((await room.evaluate(readKeys)).covered.length === 0, "no key of the room's bar is covered");
      await barShot(room, 'room-strip');
      await closeShot(room, 'room-strip-close');
    }
    await roomContext.close();
  }
}

async function main(browser) {
  console.log('The test clip and GUY');
  clip = await record(browser);
  console.log(`  clip: ${clip.length} bytes`);
  const baked = await bake(browser);
  check(baked.sheet.motions.crawl !== undefined, 'the baked strip holds the crawl');
  const shown = { [PERSON]: { characterId: 'tv-drive', mood: 'calm', stripUrl: baked.stripUrl, sheet: baked.sheet, bakedAt: new Date().toISOString() } };

  // `--rest`: only the phone width and the /media room, so the long part is not run again for them.
  if (!flag('--rest')) {
  console.log('Your room, playing the test clip');
  const { context, page } = await openPage(browser, shown);
  await go(page, '/forum');
  await openBar(page);
  await page.waitForFunction(() => document.querySelector('[data-companion="own"]')?.style.visibility === 'visible', null, { timeout: 120000 });
  const before = await page.evaluate(readTv);
  check(before.count === 0, 'no video: no TV');
  check((await page.evaluate(readOwn)).figure === 'character', 'the character is out, wearing its picture');
  console.log(`  bar with no video: bar ${JSON.stringify(before.bar)}, black ${JSON.stringify(before.led)}`);

  let playing = true;
  const pictures = (async () => {
    for (let shot = 0; playing && shot < 8; ) {
      const state = await page.evaluate(() => document.querySelector('[data-companion="own"]')?.dataset.tv ?? null).catch(() => null);
      if (state === 'down') await barShot(page, `crawl-${(shot += 1)}`).catch(() => undefined);
      else if (state === 'seat') break;
      await sleep(40);
    }
  })();
  await playInRoom(page);
  await page.waitForFunction(() => document.querySelector('[data-companion="own"]')?.dataset.tv === 'seat', null, { timeout: 30000 }).catch(() => undefined);
  playing = false;
  await pictures;
  const ways = await page.evaluate(() => window.__ways);
  console.log(`  the way down: ${ways.filter((w) => w.tv === 'down').length} places, ${JSON.stringify(ways.slice(0, 4))}`);
  const seated = await page.evaluate(readOwn);
  check(ways.filter((w) => w.tv === 'down').length >= 3 && ways[0].tv === 'down', 'it goes down to the TV step by step', JSON.stringify(ways.slice(0, 3)));
  check(seated.tv === 'seat' && seated.half, 'it sits by the TV at half size', JSON.stringify(seated));
  if (seated.seat !== null) {
    const middle = seated.x + seated.w / 2;
    const feet = seated.y + seated.h;
    check(middle > seated.seat.x - 8 && middle < seated.seat.x + seated.seat.w + 8 && feet <= seated.seat.y + seated.seat.h + 2 && feet > seated.seat.y, 'it is inside the seat beside the TV', JSON.stringify(seated));
  } else check(false, 'there is a seat');
  check(seated.over === 'bar' && seated.z >= 50, 'its layer is over the bar while seated', JSON.stringify({ over: seated.over, z: seated.z }));

  await sleep(800);
  const tv = await page.evaluate(readTv);
  console.log(`  bar with the TV: bar ${JSON.stringify(tv.bar)}, black ${JSON.stringify(tv.led)}, tv ${JSON.stringify(tv.box)}`);
  check(tv.shows === 'video' && tv.count === 1, 'one TV, showing the video', JSON.stringify({ shows: tv.shows, count: tv.count }));
  check(tv.screens === 1 && tv.blocks.case === 1 && tv.blocks.knob === 1 && tv.blocks.aerial === 2 && tv.blocks.foot === 2 && Object.keys(tv.blocks).length === 4, 'the set is one case, one screen, two aerials, two feet and one knob', JSON.stringify(tv.blocks));
  check(Array.isArray(tv.left) && tv.left[0] > 150 && tv.left[2] < 90 && tv.right[2] > 150 && tv.right[0] < 90, "the screen holds the clip's red left and blue right", JSON.stringify({ left: tv.left, right: tv.right }));
  const strips = [tv.strip];
  for (let i = 0; i < 4; i += 1) {
    await sleep(350);
    strips.push((await page.evaluate(readTv)).strip);
  }
  const later = await page.evaluate(readTv);
  check(later.frames > tv.frames && new Set(strips).size > 1, 'the picture moves with the clip', JSON.stringify({ frames: [tv.frames, later.frames], strips }));

  const corners = await page.evaluate(readCorners);
  if (corners !== null) {
    const [tl, tr, br, bl] = corners;
    const leftSide = Math.hypot(bl[0] - tl[0], bl[1] - tl[1]);
    const rightSide = Math.hypot(br[0] - tr[0], br[1] - tr[1]);
    check(Math.abs(tr[1] - tl[1]) >= 1.5 && Math.abs(leftSide - rightSide) >= 0.5, 'the screen is seen at an angle, its far side shorter', JSON.stringify({ corners, leftSide: leftSide.toFixed(1), rightSide: rightSide.toFixed(1) }));
    // What a person sees: the page's own pixels a quarter and three quarters of the way across the screen.
    const at = (u, v) => [
      (tl[0] * (1 - u) + tr[0] * u) * (1 - v) + (bl[0] * (1 - u) + br[0] * u) * v,
      (tl[1] * (1 - u) + tr[1] * u) * (1 - v) + (bl[1] * (1 - u) + br[1] * u) * v,
    ];
    const shot = await page.screenshot();
    const { data, info } = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const seen = ([x, y]) => {
      const i = (Math.round(y) * info.width + Math.round(x)) * 3;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const l = seen(at(0.25, 0.65));
    const r = seen(at(0.75, 0.65));
    check(l[0] > 150 && l[2] < 100 && r[2] > 150 && r[0] < 100, 'and on the page itself the screen reads red on the left, blue on the right', JSON.stringify({ l, r }));
  }
  const keys = await page.evaluate(readKeys);
  check(keys.keys > 3 && keys.covered.length === 0, `none of the bar's ${keys.keys} keys is covered`, JSON.stringify(keys.covered));
  await barShot(page, 'seated-bar');
  await closeShot(page, 'seated-close');
  await page.screenshot({ path: join(SHOTS, 'seated-whole.png') });

  console.log('Cost, and dropped frames');
  const session = await context.newCDPSession(page);
  await session.send('Performance.enable');
  const dropped = () => page.evaluate(() => {
    const q = [...document.querySelectorAll('video')].find((v) => v.videoWidth > 0).getVideoPlaybackQuality();
    return { dropped: q.droppedVideoFrames, total: q.totalVideoFrames };
  });
  const d0 = await dropped();
  const withTv = await cost(page, session, 6);
  const d1 = await dropped();
  const hide = await page.addStyleTag({ content: '[data-player-tv]{display:none !important}' });
  await sleep(4000);
  const hiddenNow = await page.evaluate(readTv);
  const framesHidden = hiddenNow.frames;
  check(tv.bar.h <= hiddenNow.bar.h, 'the TV fits inside the bar: the bar is no taller with it', `without ${hiddenNow.bar.h} (black ${hiddenNow.led.h}), with ${tv.bar.h} (black ${tv.led.h})`);
  const without = await cost(page, session, 6);
  check((await page.evaluate(readTv)).frames === framesHidden, 'nothing is drawn while the TV is not on screen');
  console.log(`  main thread: ${withTv.toFixed(1)}% of one core with the TV and the character watching, ${without.toFixed(1)}% with the TV hidden (headless, software graphics)`);
  console.log(`  video frames dropped with the TV on: ${d1.dropped - d0.dropped} of ${d1.total - d0.total}`);
  await hide.evaluate((el) => el.remove());

  console.log('Full size beside half size (a picture for Luke only; half size is what is built)');
  await page.waitForFunction(() => document.querySelector('[data-companion="own"]')?.dataset.tv === 'seat', null, { timeout: 30000 });
  await barShot(page, 'size-half', 'HALF SIZE (as built)');
  const now = await page.evaluate(readOwn);
  const full = await page.addStyleTag({
    content: `[data-companion="own"]{transform:translate3d(${Math.round(now.seat.x + (now.seat.w - now.w * 2) / 2)}px,${now.seat.y + now.seat.h - 2 - now.h * 2}px,0) !important}`,
  });
  await barShot(page, 'size-full', 'FULL SIZE (for comparison, not built)');
  await full.evaluate((el) => el.remove());
  // `--shots`: only as far as the pictures.
  if (flag('--shots')) {
    await context.close();
    return mediaRoom(browser, shown);
  }

  console.log('Paused from the bar, then nothing on');
  const barKey = (name) => page.locator('[data-bar-led]').locator('xpath=ancestor::div[contains(@class,"fixed")][1]').locator('button', { hasText: name }).first();
  await barKey('❚❚').click({ timeout: 8000 }).catch((error) => note(`no pause key pressed: ${String(error.message).split('\n')[0]}`));
  await sleep(1500);
  const paused = await page.evaluate(readTv);
  const stopped = await page.evaluate(() => [...document.querySelectorAll('video')].filter((v) => v.videoWidth > 0).every((v) => v.paused));
  await sleep(1000);
  check(stopped, "the bar's pause key still pauses the video");
  check(paused.shows === 'video' && (await page.evaluate(readTv)).frames === paused.frames, 'paused: the TV holds its picture and copies nothing');
  console.log("The music bar's black");
  await page.locator('[data-stream-bar] [data-stream-bar-swap]').first().click({ timeout: 8000 }).catch((error) => note(`no key to the music bar pressed: ${String(error.message).split('\n')[0]}`));
  await sleep(2500);
  const music = await page.evaluate(readTv);
  check(music.count === 1 && !music.inRoomBar && music.shows === 'video', "one TV in the music bar's black too", JSON.stringify({ count: music.count, inRoomBar: music.inRoomBar, shows: music.shows }));
  const musicHide = await page.addStyleTag({ content: '[data-player-tv]{display:none !important}' });
  await sleep(600);
  const musicWithout = await page.evaluate(readTv);
  await musicHide.evaluate((el) => el.remove());
  check(music.bar !== null && music.bar.h <= musicWithout.bar.h, 'the music bar is no taller with it', `without ${musicWithout.bar?.h}, with ${music.bar?.h}`);
  await page.waitForFunction(() => document.querySelector('[data-companion="own"]')?.dataset.tv === 'seat', null, { timeout: 30000 }).catch(() => undefined);
  await barShot(page, 'music-bar');

  console.log('The video ends');
  await page.evaluate(() => {
    window.__ways = [];
    for (const video of document.querySelectorAll('video')) {
      video.loop = false;
      void video.play().catch(() => undefined);
    }
  });
  const gone = await page.waitForFunction(() => document.querySelector('[data-player-tv]') === null, null, { timeout: 45000 }).then(() => true).catch(() => false);
  await page.waitForFunction(() => document.querySelector('[data-companion="own"]')?.dataset.tv === undefined, null, { timeout: 20000 }).catch(() => undefined);
  const way = await page.evaluate(() => window.__ways.map((w) => w.tv));
  const after = await page.evaluate(readOwn);
  await page.screenshot({ path: join_(SHOTS, 'ended.png') });
  check(gone, 'the video ends: the TV goes', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('video')].map((v) => [v.paused, v.ended, Math.round(v.currentTime), v.duration]))));
  check(way.includes('up') && after.tv === null && !after.half && after.over === null, 'and it climbs back up to its strip, full size, under the bar again', JSON.stringify({ way: [...new Set(way)], after }));
  await context.close();

  console.log('Reduced motion');
  {
    const { context: still, page: calm } = await openPage(browser, shown, { reduced: true });
    await playInRoom(calm);
    await openBar(calm);
    await calm.waitForFunction(() => document.querySelector('[data-companion="own"]')?.dataset.tv === 'seat', null, { timeout: 30000 }).catch(() => undefined);
    await sleep(1500);
    const own = await calm.evaluate(readOwn);
    const one = await calm.evaluate(readTv);
    await sleep(1500);
    const two = await calm.evaluate(readTv);
    check(own?.tv === 'seat', 'it is simply seated, with no crawl', JSON.stringify(own));
    check(one.frames === 1 && two.frames === 1, 'and the screen holds one still', JSON.stringify([one.frames, two.frames]));
    await still.close();
  }
  }

  console.log('A smaller desktop, and phone width');
  for (const [width, height] of flag('--rest') ? [[390, 844]] : [[1366, 768], [390, 844]]) {
    const { context: other, page: small } = await openPage(browser, shown, { width, height });
    await playInRoom(small);
    // At phone width the room's window lies over the folded bar's tile (the site's phone layout, not the TV's), so the
    // tile is pressed through it.
    if (width === 390) await small.locator('span[data-companion-avoid] > button').first().dispatchEvent('click').catch(() => undefined);
    else await openBar(small);
    await sleep(7000);
    const seen = await small.evaluate(readTv);
    console.log(`  at ${width}: bar ${JSON.stringify(seen.bar)}, tv ${JSON.stringify(seen.box)}`);
    check(seen.sideScroll <= 0, `no sideways scroll at ${width}`, String(seen.sideScroll));
    if (width === 390) check(seen.box === null || seen.box.w === 0, 'no TV at phone width');
    else {
      check((await small.evaluate(readKeys)).covered.length === 0, `no bar key covered at ${width}`);
      await barShot(small, 'seated-1366');
    }
    await other.close();
  }

  await mediaRoom(browser, shown);
}

(async () => {
  let server = null;
  let browser = null;
  try {
    if (SERVE) {
      // Cut off from the live site, as `scripts/dev-mock-live.cjs` does it: mock sign-in, every data switch on mock, and
      // the database's address and key EMPTY, so nothing that missed a switch can reach it.
      const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_ANON_KEY: '', NEXT_PUBLIC_AUTH_BACKEND: 'mock' };
      for (const name of 'AQUARIUM BEATBOX BOOKS COMMS DOCS FORUM GAMES HISTORY LETTERS LORE MEDIA MUSIC NOTIFICATIONS PROFILE_CHARACTER PROFILE RECOMMENDATIONS SEEING WATCH WEB WINDOWS'.split(' ')) {
        env[`NEXT_PUBLIC_${name}_DATA_SOURCE`] = 'mock';
      }
      server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '-p', String(PORT)], { env, stdio: 'ignore' });
      let status = 0;
      for (let i = 0; i < 90 && status !== 200; i += 1) {
        status = await new Promise((resolve) => {
          http.get(`${BASE}/forum`, { timeout: 180000 }, (res) => (res.resume(), resolve(res.statusCode))).on('error', () => resolve(0));
        });
        if (status !== 200) await sleep(2000);
      }
      assert.equal(status, 200, 'the dev server answers');
    }
    browser = await chromium.launch({
      executablePath: findChrome(),
      headless: !flag('--headed'),
      args: ['--no-first-run', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
    });
    await main(browser);
    check(reachedOut.length === 0, 'nothing asked the live site or a database', JSON.stringify([...new Set(reachedOut)]));
  } catch (error) {
    failed.push(String(error.message ?? error).split('\n')[0]);
    console.log(`  STOPPED ${String(error.stack ?? error).slice(0, 1200)}`);
  } finally {
    if (browser !== null) await browser.close();
    if (server !== null) {
      try {
        execSync(`taskkill /PID ${server.pid} /T /F`, { stdio: 'ignore' });
      } catch {}
    }
  }
  for (const line of [...consoleErrors].slice(0, 8)) console.log(`  console error: ${line}`);
  console.log(`\n${passed} passed, ${failed.length} failed. Screenshots in ${SHOTS}`);
  for (const what of failed) console.log(`  failed: ${what}`);
  process.exitCode = failed.length === 0 ? 0 : 1;
})();
