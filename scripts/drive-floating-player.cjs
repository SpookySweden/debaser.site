/*
 * Drives the floating player and the arrows in a real browser (SPEC-floating-player.md): the proof that a video is never
 * reloaded, which a server render can't give. Not in `npm run checks`: it needs a running site and a network.
 *
 *   node scripts/drive-floating-player.cjs --base http://localhost:3001 --mock
 *   node scripts/drive-floating-player.cjs --base https://debaser-site.vercel.app --env-test <path to .env.test>
 *
 * Signed in as the kept test account on the live site; never signs anybody up. The password is read from the file named,
 * by the tool, and never printed.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome, loadEnv, signInPage } = require('./browser.cjs');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3001');
const MOCK = flag('--mock');
const SHOTS = join('Temp', 'browse');
mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};
const soft = [];
const note = (what) => {
  soft.push(what);
  console.log(`  NOTE ${what}`);
};

/** What is watched on the player, in the page: the element, its address, how often it loaded, what its player last said. */
const WATCH = `(() => {
  window.__watch = { loads: 0, element: null, src: null, said: null };
  window.addEventListener('message', (event) => {
    let data = event.data;
    try { if (typeof data === 'string') data = JSON.parse(data); } catch { return; }
    const t = data && data.info && data.info.currentTime;
    if (typeof t === 'number') window.__watch.said = t;
  });
})()`;

const layerState = (page) =>
  page.evaluate(() => {
    const layer = document.querySelector('[data-floating-player]');
    if (!layer) return null;
    const media = layer.querySelector('iframe, video');
    const rect = layer.getBoundingClientRect();
    return {
      state: layer.getAttribute('data-floating-player'),
      rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
      same: window.__watch.element === media,
      src: media?.getAttribute('src') ?? null,
      sameSrc: window.__watch.src === media?.getAttribute('src'),
      loads: window.__watch.loads,
      said: window.__watch.said,
      time: media?.tagName === 'VIDEO' ? media.currentTime : null,
      paused: media?.tagName === 'VIDEO' ? media.paused : null,
      clip: layer.style.clipPath,
    };
  });

/** Starts watching the element that is in the layer now. */
const mark = (page) =>
  page.evaluate(() => {
    const media = document.querySelector('[data-floating-player] iframe, [data-floating-player] video');
    window.__watch.element = media;
    window.__watch.src = media?.getAttribute('src') ?? null;
    window.__watch.loads = 0;
    media?.addEventListener('load', () => (window.__watch.loads += 1));
    media?.addEventListener('emptied', () => (window.__watch.loads += 1));
  });

const untilState = async (page, wanted, what) => {
  for (let i = 0; i < 60; i += 1) {
    const state = await layerState(page);
    if (state?.state === wanted) return state;
    await sleep(100);
  }
  throw new Error(`never reached ${wanted}: ${what}`);
};

/** Never reloaded: the same element, the same address, no load since it was marked. */
const stillTheSame = async (page, what) => {
  const state = await layerState(page);
  assert.ok(state, `${what}: the player is there`);
  assert.equal(state.same, true, `${what}: the same element`);
  assert.equal(state.sameSrc, true, `${what}: the same address`);
  assert.equal(state.loads, 0, `${what}: no reload`);
  pass(`${what}: same element, same address, no reload`);
  return state;
};

const paneScroll = (page, top) =>
  page.evaluate((to) => {
    const pane = document.querySelector('main [data-scroll-pane="page"]');
    pane.scrollTop = to;
    return pane.scrollTop;
  }, top);
const paneTop = (page) => page.evaluate(() => document.querySelector('main [data-scroll-pane="page"]').scrollTop);

const boxRect = (page, id) =>
  page.evaluate((key) => {
    const box = document.querySelector(`[data-player-box="${key}"]`);
    if (!box) return null;
    const rect = box.getBoundingClientRect();
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
  }, id);

const near = (a, b, tolerance = 2) => Math.abs(a - b) <= tolerance;

async function signIn(page) {
  if (MOCK) {
    await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      const user = { id: 'drive-user', email: 'test-drive@debaser.site', displayName: 'TEST DRIVE', createdAt: new Date().toISOString(), salt: '', secretHash: '', hidden: true };
      localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ users: [user], sessionUserId: user.id, bannedIds: [] }));
    });
    return;
  }
  const account = await signInPage(page);
  if (account.error) throw new Error(`sign-in: ${account.error}`);
  console.log(`  signed in as ${account.who}`);
}

async function mediaRun(page) {
  console.log('MEDIA: a YouTube row');
  await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(WATCH);
  // A row with a YouTube player.
  await page.waitForFunction(() => [...document.querySelectorAll('li')].some((row) => /YOUTUBE/.test(row.innerText) && /\[ ▶ PLAY \]/.test(row.innerText)), null, { timeout: 45000 });
  await sleep(1500);
  // (Stream rooms are driven with --room, on the mock site only.)
  const before = await page.evaluate(() => document.querySelector('[data-floating-player]'));
  assert.equal(before, null, 'nothing from a platform loads until PLAY');
  assert.equal(await page.locator('iframe').count(), 0, 'no frame on the page before PLAY');
  pass('nothing from a platform loads until PLAY');

  await paneScroll(page, 0);
  const row = page.locator('li', { hasText: 'YOUTUBE' }).filter({ hasText: '[ ▶ PLAY ]' }).first();
  await row.getByRole('button', { name: /^Play / }).click();
  await page.waitForSelector('[data-floating-player] iframe');
  // After the first load has come and gone: from here on, any load is a reload.
  await sleep(5000);
  await mark(page);
  const id = await page.evaluate(() => document.querySelector('[data-player-box]').getAttribute('data-player-box'));
  let state = await untilState(page, 'in-box', 'after PLAY');
  let box = await boxRect(page, id);
  assert.ok(near(state.rect.x, box.x) && near(state.rect.y, box.y) && near(state.rect.w, box.w) && near(state.rect.h, box.h), `the layer sits exactly over its box: ${JSON.stringify([state.rect, box])}`);
  pass('PLAY: the player sits exactly over its box');
  assert.match(state.src, /youtube-nocookie\.com\/embed\/.*autoplay=1/);
  assert.match(state.src, /enablejsapi=1/);
  pass('the platform\'s own embed, asked to autoplay');
  assert.ok((await row.innerText()).includes('[ ADD TO ROOM ]') && !(await row.innerText()).includes('[ WATCH ]'), 'the key reads ADD TO ROOM');
  pass('the key on the row reads [ ADD TO ROOM ]');
  await page.screenshot({ path: join(SHOTS, 'float-in-box.png') });

  // Scrolled past.
  const top = await paneTop(page);
  const bottomBefore = await page.evaluate(() => document.querySelector('main [data-scroll-pane="page"]').scrollHeight);
  await page.evaluate((key) => {
    const box = document.querySelector(`[data-player-box="${key}"]`);
    box.scrollIntoView({ block: 'end' });
  }, id);
  const place = await paneTop(page);
  await paneScroll(page, place + 1400);
  state = await untilState(page, 'floating', 'scrolled past');
  await stillTheSame(page, 'scrolled past');
  await sleep(300);
  await page.screenshot({ path: join(SHOTS, 'float-scrolled.png') });
  const clear = await page.evaluate(() => {
    const layer = document.querySelector('[data-floating-player]').getBoundingClientRect();
    const start = [...document.querySelectorAll('button')].find((button) => button.innerText.includes('[ START ]'))?.getBoundingClientRect();
    const music = document.documentElement.style.getPropertyValue('--music-top');
    return { layerBottom: layer.bottom, startTop: start?.top ?? null, musicTop: window.innerHeight - parseFloat(music || '0'), right: layer.right, width: window.innerWidth };
  });
  assert.ok(clear.layerBottom <= clear.musicTop, `clear of the music bar: ${JSON.stringify(clear)}`);
  if (clear.startTop !== null) assert.ok(clear.layerBottom <= clear.startTop, `clear of the START bar: ${JSON.stringify(clear)}`);
  pass('floating: clear of the music bar and the START bar');
  assert.equal(await page.getByRole('button', { name: /^Pop out/ }).count(), 0, 'no pop-out for a platform\'s player');
  pass('no POP OUT for an outside player');

  // Back in view.
  await paneScroll(page, place);
  state = await untilState(page, 'in-box', 'scrolled back');
  await stillTheSame(page, 'scrolled back');
  box = await boxRect(page, id);
  assert.ok(near(state.rect.y, box.y, 40), 'back over its box');

  // A partly hidden box is cut to the pane rather than drawn over the window's title.
  await paneScroll(page, place + (box.h > 0 ? Math.round(box.h / 2) : 100));
  await sleep(200);
  const part = await layerState(page);
  if (part.state === 'in-box') assert.ok(/inset/.test(part.clip) || part.clip === 'none', 'cut to what the page shows');
  await paneScroll(page, place);
  await sleep(200);

  // The wheel over the video itself scrolls the page, as it did when the frame was in the page.
  const overBox = await boxRect(page, id);
  await paneScroll(page, place);
  await sleep(200);
  const topBeforeWheel = await paneTop(page);
  await page.mouse.move(overBox.x + overBox.w / 2, Math.max(overBox.y, 120) + 80);
  await page.mouse.wheel(0, -60);
  await sleep(500);
  await page.mouse.wheel(0, 120);
  await sleep(500);
  const topAfterWheel = await paneTop(page);
  assert.notEqual(topAfterWheel, topBeforeWheel, 'the wheel over the video moves the page');
  pass(`the wheel over the video scrolls the page (${topBeforeWheel}px to ${topAfterWheel}px)`);
  await stillTheSame(page, 'the wheel');
  await paneScroll(page, place);
  await sleep(200);

  // Scrolling up past the point where the video goes back in its box (Luke, 2026-11-05: it stuck there, pushed back each
  // time). The wheel, then the keyboard, then the wheel with the pointer on the float.
  const scrollsThrough = async (what, step) => {
    await paneScroll(page, place + 1400);
    await untilState(page, 'floating', `${what}: scrolled past`);
    const seen = [await paneTop(page)];
    for (let i = 0; i < 28; i += 1) {
      await step();
      await sleep(80);
      seen.push(await paneTop(page));
    }
    const backwards = seen.filter((value, i) => i > 0 && value > seen[i - 1] + 2);
    assert.deepEqual(backwards, [], `${what}: it never jumps back: ${seen.join(' ')}`);
    assert.ok(seen.at(-1) < seen[0] - 800, `${what}: it gets up the page: ${seen.join(' ')}`);
    pass(`${what}: scrolling up runs straight through (${seen[0]}px to ${seen.at(-1)}px)`);
  };
  await page.mouse.move(overBox.x + 120, 500);
  await scrollsThrough('the wheel on the page', () => page.mouse.wheel(0, -100));
  await stillTheSame(page, 'scrolling up');
  await page.mouse.click(overBox.x + 120, 500);
  await scrollsThrough('the keyboard', () => page.keyboard.press('PageUp').then(() => sleep(250)));
  await paneScroll(page, place + 1400);
  await untilState(page, 'floating', 'for the wheel on the float');
  await sleep(100);
  const floatAt = (await layerState(page)).rect;
  const beforeFloatWheel = await paneTop(page);
  await page.mouse.move(floatAt.x + floatAt.w / 2, floatAt.y + floatAt.h / 2);
  await page.mouse.wheel(0, -100);
  await sleep(400);
  assert.ok((await paneTop(page)) < beforeFloatWheel, 'the wheel on the float scrolls the page');
  pass('the wheel on the float scrolls the page');
  await paneScroll(page, place);
  await untilState(page, 'in-box', 'after scrolling up');

  // A double press on the picture itself: fullscreen, then back, the video carrying on (Luke, 2026-11-05).
  const fullIs = () => page.evaluate(() => document.fullscreenElement?.tagName ?? 'none');
  const dbl = async (x, y) => {
    await page.mouse.move(x, y);
    await sleep(200);
    await page.mouse.dblclick(x, y, { delay: 30 });
    await sleep(1500);
  };
  const pictureAt = await page.evaluate((key) => {
    const b = document.querySelector(`[data-player-box="${key}"]`).getBoundingClientRect();
    return { x: b.left + b.width / 2, y: Math.max(b.top, 130) + 150 };
  }, id);
  await dbl(pictureAt.x, pictureAt.y);
  assert.equal(await fullIs(), 'IFRAME', 'a double press on YouTube\'s picture goes fullscreen');
  await stillTheSame(page, 'a double press: in');
  await page.screenshot({ path: join(SHOTS, 'float-fullscreen.png') });
  await dbl(720, 400);
  assert.equal(await fullIs(), 'none', 'another comes back');
  await stillTheSame(page, 'a double press: back');
  pass('a double press on YouTube\'s picture goes fullscreen, and another comes back');
  await page.getByRole('button', { name: /^Fullscreen:/ }).first().click();
  await sleep(800);
  assert.equal(await fullIs(), 'IFRAME', '[ FULL ] goes fullscreen');
  await page.evaluate(() => document.exitFullscreen());
  await sleep(800);
  await stillTheSame(page, '[ FULL ]');
  pass('[ FULL ] beside [ PIP ] does the same');
  await paneScroll(page, place);
  await sleep(200);

  // PIP.
  const pip = page.getByRole('button', { name: /^PIP:/ });
  await pip.click();
  await untilState(page, 'floating', '[ PIP ]');
  await stillTheSame(page, '[ PIP ]');
  await page.screenshot({ path: join(SHOTS, 'float-pip.png') });
  const placeholder = await page.evaluate((key) => document.querySelector(`[data-player-box="${key}"]`).innerText, id);
  assert.match(placeholder, /BACK HERE/);
  const boxAfter = await boxRect(page, id);
  assert.ok(near(boxAfter.h, box.h, 1), 'the box keeps its size');
  pass('[ PIP ]: floats with its box in view, and the box keeps its size');
  await page.getByRole('button', { name: /^Back here/ }).click();
  await untilState(page, 'in-box', 'BACK HERE');
  await stillTheSame(page, 'BACK HERE');

  // A float in fullscreen comes back as it was: by a double press on the picture, and on its title line.
  await pip.click();
  await untilState(page, 'floating', 'for fullscreen');
  await sleep(200);
  const floatBefore = (await layerState(page)).rect;
  await dbl(floatBefore.x + 40, floatBefore.y + 15);
  assert.equal(await fullIs(), 'IFRAME', 'a double press on the float\'s title line goes fullscreen');
  await page.evaluate(() => document.exitFullscreen());
  await sleep(800);
  const floatTitleBack = (await layerState(page)).rect;
  assert.deepEqual(floatTitleBack, floatBefore, 'back as it was');
  await dbl(floatBefore.x + floatBefore.w / 2, floatBefore.y + floatBefore.h / 2 + 20);
  assert.equal(await fullIs(), 'IFRAME', 'a double press on the floating picture goes fullscreen');
  await dbl(720, 400);
  assert.equal(await fullIs(), 'none', 'another comes back');
  await sleep(300);
  assert.deepEqual((await layerState(page)).rect, floatBefore, 'back as it was');
  await stillTheSame(page, 'a float in fullscreen and back');
  pass('a float goes fullscreen and comes back exactly as it was');
  await pip.click();
  await untilState(page, 'in-box', 'after the float\'s fullscreen');

  // Drag and resize.
  await pip.click();
  await untilState(page, 'floating', '[ PIP ] again');
  await sleep(100);
  const start = (await layerState(page)).rect;
  await page.mouse.move(start.x + 40, start.y + 15);
  await page.mouse.down();
  await page.mouse.move(start.x - 200, start.y - 150, { steps: 6 });
  await page.mouse.up();
  await sleep(100);
  const moved = (await layerState(page)).rect;
  assert.ok(near(moved.x, start.x - 240, 3) && near(moved.y, start.y - 165, 3), `dragged: ${JSON.stringify([start, moved])}`);
  pass('the float drags by its title line');
  await page.mouse.move(moved.x + moved.w - 1, moved.y + moved.h + 1);
  await page.mouse.down();
  await page.mouse.move(moved.x + moved.w + 79, moved.y + moved.h + 41, { steps: 6 });
  await page.mouse.up();
  await sleep(100);
  const sized = (await layerState(page)).rect;
  assert.ok(sized.w > moved.w + 40 && sized.h > moved.h + 20, `resized: ${JSON.stringify([moved, sized])}`);
  pass('the float resizes by its edge');
  await stillTheSame(page, 'dragged and resized');
  // Dragged off the foot: it stays clear.
  await page.mouse.move(sized.x + 40, sized.y + 15);
  await page.mouse.down();
  await page.mouse.move(sized.x + 40, 5000, { steps: 4 });
  await page.mouse.up();
  await sleep(100);
  const pushed = await page.evaluate(() => {
    const layer = document.querySelector('[data-floating-player]').getBoundingClientRect();
    const music = parseFloat(document.documentElement.style.getPropertyValue('--music-top') || '0');
    return { bottom: layer.bottom, limit: window.innerHeight - music };
  });
  assert.ok(pushed.bottom <= pushed.limit, `dragged at the music bar, it stops above it: ${JSON.stringify(pushed)}`);
  pass('dragged at the music bar, it stops above it');
  await page.getByRole('button', { name: /^PIP:/ }).click();
  await untilState(page, 'in-box', 'PIP off');

  // Another page: the float carries it. The nav is the reader's way, not a page load.
  // (The robot's clicks scroll keys into view, so the page is put back first.)
  await paneScroll(page, place);
  await untilState(page, 'in-box', 'before walking away');
  await page.getByRole('navigation', { name: 'Site pages' }).getByRole('link', { name: 'FORUM' }).click();
  await page.waitForURL(/\/forum/);
  await untilState(page, 'floating', 'another page');
  await sleep(1500);
  const onForum = await stillTheSame(page, 'walked to FORUM');
  await page.screenshot({ path: join(SHOTS, 'float-other-page.png') });
  const said = onForum.said;
  await sleep(2500);
  const saidLater = (await layerState(page)).said;
  if (said !== null && saidLater !== null && saidLater > said) pass(`it plays on across the walk (${said.toFixed(1)}s, then ${saidLater.toFixed(1)}s)`);
  else note(`could not see YouTube's clock move (${said}, ${saidLater}): headless autoplay, or a blocked embed`);

  // The arrows.
  const arrows = async () => ({
    back: await page.getByRole('button', { name: 'Back', exact: true }).isDisabled(),
    forward: await page.getByRole('button', { name: 'Forward', exact: true }).isDisabled(),
  });
  assert.deepEqual(await arrows(), { back: false, forward: true }, 'after one walk: back works, forward is quiet');
  pass('the arrows: back lit, forward quiet');
  const forumPaneMax = await page.evaluate(() => {
    const pane = document.querySelector('main [data-scroll-pane="page"]');
    return pane.scrollHeight - pane.clientHeight;
  });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.waitForURL(/\/media/);
  await untilState(page, 'in-box', 'back on MEDIA');
  await stillTheSame(page, 'the back arrow');
  await sleep(500);
  // Read in one go, after a frame: rows still arriving move the box between two separate reads.
  let lined = null;
  for (let i = 0; i < 40; i += 1) {
    lined = await page.evaluate(
      (key) =>
        new Promise((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const box = document.querySelector(`[data-player-box="${key}"]`)?.getBoundingClientRect();
              const layer = document.querySelector('[data-floating-player]');
              const rect = layer?.getBoundingClientRect();
              resolve({ state: layer?.getAttribute('data-floating-player'), box: box && [box.left, box.top, box.width], rect: rect && [rect.left, rect.top, rect.width] });
            }),
          ),
        ),
      id,
    );
    if (lined.state === 'in-box' && lined.box && near(lined.box[0], lined.rect[0]) && near(lined.box[1], lined.rect[1]) && near(lined.box[2], lined.rect[2])) break;
    await sleep(250);
    lined.bad = true;
  }
  assert.ok(lined && !lined.bad, `coming back puts it back in its box: ${JSON.stringify(lined)}`);
  pass('coming back puts it back in its box');
  assert.equal((await arrows()).forward, false, 'gone back: forward is lit');
  pass('the arrows: forward lit after going back');

  // Forward, and scroll on the other page, and back again.
  await page.getByRole('button', { name: 'Forward', exact: true }).click();
  await page.waitForURL(/\/forum/);
  await untilState(page, 'floating', 'forward');
  await stillTheSame(page, 'the forward arrow');
  if (forumPaneMax > 100) {
    await paneScroll(page, 90);
    await sleep(500);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.waitForURL(/\/media/);
    await sleep(800);
    await page.getByRole('button', { name: 'Forward', exact: true }).click();
    await page.waitForURL(/\/forum/);
    await sleep(1200);
    assert.ok(near(await paneTop(page), 90, 3), `each entry keeps its own place: ${await paneTop(page)}`);
    pass('each history entry keeps its own place');
  }

  // [ BACK ] on the float, from another page.
  await page.locator('[data-floating-player]').getByRole('button', { name: /^Back to where/ }).click();
  await page.waitForURL(/\/media/);
  await untilState(page, 'in-box', 'the float\'s BACK');
  await stillTheSame(page, 'the float\'s [ BACK ]');
  pass('[ BACK ] on the float goes to where it came from');

  // Closed, it keeps its place; played again it starts from there.
  await sleep(1500);
  const lastSaid = (await layerState(page)).said;
  await page.getByRole('button', { name: /^Close the YOUTUBE player/ }).click();
  await sleep(200);
  assert.equal(await page.locator('[data-floating-player]').count(), 0, 'closed: gone');
  assert.equal(await page.locator('iframe').count(), 0, 'closed: no frame left');
  pass('CLOSE stops it');
  const again = page.locator('li', { hasText: 'YOUTUBE' }).filter({ has: page.locator(`button[aria-label^="Play"]`) }).first();
  await again.getByRole('button', { name: /^Play / }).click();
  await page.waitForSelector('[data-floating-player] iframe');
  const resumed = await page.evaluate(() => document.querySelector('[data-floating-player] iframe').getAttribute('src'));
  if (lastSaid !== null && lastSaid >= 1) {
    assert.match(resumed, /[?&]start=\d+/, `resumes: ${resumed}`);
    pass(`played again it resumes from ${/[?&]start=(\d+)/.exec(resumed)[1]}s`);
  } else note('no clock heard from YouTube here, so resuming was not proved in this run');

  // Your place, with no video to keep in view: MEDIA's rows arrive late, and the page is read again from nothing.
  await page.locator('button[aria-label^="Close the YOUTUBE player"]').click();
  await sleep(200);
  await paneScroll(page, 700);
  await sleep(600);
  const placeNoVideo = await paneTop(page);
  assert.ok(placeNoVideo > 300, `a long enough page to test: ${placeNoVideo}`);
  await page.getByRole('navigation', { name: 'Site pages' }).getByRole('link', { name: 'STREAM' }).click();
  await page.waitForURL(/\/stream/);
  await sleep(1200);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.waitForURL(/\/media/);
  for (let i = 0; i < 100; i += 1) {
    if (near(await paneTop(page), placeNoVideo, 2)) break;
    await sleep(100);
  }
  assert.ok(near(await paneTop(page), placeNoVideo, 2), `your place comes back: ${await paneTop(page)} of ${placeNoVideo}`);
  pass(`the back arrow: your place on the page comes back (${placeNoVideo}px), rows arriving late and all`);
  await paneScroll(page, 0);
  await page.locator('li', { hasText: 'YOUTUBE' }).filter({ has: page.locator('button[aria-label^="Play"]') }).first().getByRole('button', { name: /^Play / }).click();
  await page.waitForSelector('[data-floating-player] iframe');
  await sleep(500);
  await mark(page);

  // A second PLAY replaces.
  await mark(page);
  const firstSrc = (await layerState(page)).src;
  const rows = page.locator('li', { hasText: 'YOUTUBE' }).filter({ has: page.locator('button[aria-label^="Play"]') });
  if ((await rows.count()) > 1) {
    const nowFrame = await page.evaluate(() => document.querySelector('[data-floating-player] iframe').title);
    const labels = await rows.evaluateAll((list) => list.map((row) => row.querySelector('button[aria-label^="Play"]')?.getAttribute('aria-label')));
    console.log(`  playing: ${nowFrame}`);
    const other = labels.findIndex((label) => label && !nowFrame.includes(label.replace(/^Play "/, '').replace(/" \(.*$/, '')));
    console.log(`  pressing PLAY on row ${other}: ${labels[other]}`);
    await rows.nth(other).locator('button[aria-label^="Play"]').first().click();
    await sleep(800);
    const second = await layerState(page);
    console.log(`  first ${firstSrc}\n  then  ${second.src}`);
    assert.equal(await page.locator('[data-floating-player] iframe').count(), 1, 'still one player');
    assert.equal(await page.locator('iframe').count(), 1, 'one frame on the whole page');
    assert.notEqual(second.src, firstSrc, 'the second video');
    assert.equal(second.same, false, 'a new element for the new video');
    pass('a second PLAY replaces the video playing');
  } else note('only one YouTube row to play');
  await page.locator('button[aria-label^="Close the YOUTUBE player"]').click();
}

async function filesRun(page) {
  console.log('FILES: one of the site\'s own videos');
  if (MOCK) {
    await page.evaluate(() => {
      const item = {
        id: 'drive-video',
        kind: 'video',
        bucket: 'x',
        path: 'x',
        src: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm',
        sha256: 'x',
        bytes: 1000,
        mime: 'video/webm',
        length: '0:05',
        title: 'A Driven Video',
        credit: '',
        tags: [],
        source: 'upload',
        uploadedBy: 'drive-user',
        uploadedByLabel: 'TEST DRIVE',
        createdAt: new Date().toISOString(),
      };
      for (const key of Object.keys(localStorage)) if (key.includes('media') && key.includes('items')) localStorage.setItem(key, JSON.stringify([item]));
      localStorage.setItem('debaser.media.items.v1', JSON.stringify([item]));
    });
  }
  await page.goto(`${BASE}/files?kind=video`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(WATCH);
  await sleep(4000);
  const folds = page.locator('main li button', { hasText: '[+]' });
  if ((await folds.count()) === 0) {
    const shelf = page.locator('main button', { hasText: '[+]' }).first();
    if ((await shelf.count()) > 0) await shelf.click();
    await sleep(500);
  }
  const fold = page.locator('main li button', { hasText: '[+]' }).first();
  if ((await fold.count()) === 0) {
    note('no video in the catalogue to play here');
    return;
  }
  await fold.click();
  await sleep(300);
  assert.equal(await page.locator('main video').count(), 0, 'a fold alone loads no player');
  await page.getByRole('button', { name: /^Play ".*" here$/ }).first().click();
  await page.waitForSelector('[data-floating-player] video');
  await mark(page);
  await sleep(2000);
  await untilState(page, 'in-box', 'FILES PLAY');
  pass('FILES: PLAY sits over its box');
  const media = await layerState(page);
  if (media.paused) note('the video did not start by itself here');

  // A double press on our own file: the browser's own player does it, both ways.
  const fileAt = await page.evaluate(() => {
    const b = document.querySelector('[data-floating-player] video').getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 - 30 };
  });
  await page.mouse.dblclick(fileAt.x, fileAt.y, { delay: 30 });
  await sleep(1200);
  assert.equal(await page.evaluate(() => document.fullscreenElement?.tagName ?? 'none'), 'VIDEO', 'a double press on our own file goes fullscreen');
  await page.mouse.dblclick(720, 500, { delay: 30 });
  await sleep(1200);
  assert.equal(await page.evaluate(() => document.fullscreenElement?.tagName ?? 'none'), 'none', 'another comes back');
  await stillTheSame(page, 'FILES: a double press');
  pass('FILES: a double press goes fullscreen, and another comes back');

  await page.getByRole('button', { name: /^PIP:/ }).click();
  await untilState(page, 'floating', 'FILES PIP');
  await stillTheSame(page, 'FILES [ PIP ]');
  assert.equal(await page.getByRole('button', { name: /^Pop out/ }).count(), 1, 'our own file has the browser\'s pop-out');
  pass('[ POP OUT ] is offered for our own file');
  await page.screenshot({ path: join(SHOTS, 'float-file.png') });
  const popped = await page.evaluate(async () => {
    try {
      await document.querySelector('[data-floating-player] video').requestPictureInPicture();
      const ok = document.pictureInPictureElement !== null;
      await document.exitPictureInPicture();
      return ok;
    } catch (error) {
      return String(error);
    }
  });
  if (popped === true) pass('the browser\'s real pop-out opens and closes');
  else note(`pop-out not available here: ${popped}`);
  await page.getByRole('button', { name: /^PIP:/ }).click();
  await untilState(page, 'in-box', 'FILES PIP off');

  const t0 = (await layerState(page)).time;
  await page.getByRole('navigation', { name: 'Site pages' }).getByRole('link', { name: 'MEDIA' }).click();
  await page.waitForURL(/\/media/);
  await untilState(page, 'floating', 'FILES to MEDIA');
  await stillTheSame(page, 'FILES: walked to MEDIA');
  await sleep(1000);
  const t1 = (await layerState(page)).time;
  pass(`FILES: the clock carries on across the walk (${t0?.toFixed(1)}s, then ${t1?.toFixed(1)}s)`);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.waitForURL(/\/files/);
  await untilState(page, 'in-box', 'back on FILES');
  await stillTheSame(page, 'FILES: the back arrow');
  pass('FILES: coming back opens its fold and puts it back in its box');
  await page.getByRole('button', { name: /^Close the player/ }).first().click();
}

/** A stream room on the mock site only: going live on the real one would leave a stream on the board. */
async function roomRun(page) {
  console.log('A stream room');
  const fullIs = () => page.evaluate(() => document.fullscreenElement?.tagName ?? 'none');
  const clock = () => page.evaluate(() => Number(document.querySelector('[data-watch-clock]')?.getAttribute('data-watch-clock') ?? 'NaN'));
  const dbl = async (x, y) => {
    await page.mouse.move(x, y);
    await sleep(200);
    await page.mouse.dblclick(x, y, { delay: 30 });
    await sleep(1200);
  };
  const addLink = async (link) => {
    await page.getByRole('button', { name: '[ QUEUE ]' }).last().click();
    await sleep(500);
    const field = page.getByPlaceholder('SEARCH MEDIA OR PASTE A VIDEO LINK');
    await field.fill(link);
    await field.press('Enter');
    await sleep(5000);
    const expand = page.locator('button:has-text("[+]")').last();
    if ((await expand.count()) > 0) await expand.click().catch(() => undefined);
    await sleep(300);
    await page.locator('button:has-text("←")').first().click();
    await sleep(500);
    await page.getByRole('button', { name: 'Close window' }).last().click();
    await sleep(500);
  };
  await page.goto(`${BASE}/stream`, { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  await page.getByRole('button', { name: /GO LIVE|BACK TO YOUR ROOM/ }).first().click();
  await page.waitForSelector('[data-room-picture]');
  await sleep(1500);
  await addLink('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
  await page.waitForSelector('[data-room-picture] iframe');
  await sleep(6000);
  await page.evaluate(() => {
    window.__room = { frame: document.querySelector('[data-room-picture] iframe'), loads: 0 };
    window.__room.src = window.__room.frame.src;
    window.__room.frame.addEventListener('load', () => (window.__room.loads += 1));
  });
  const stillRoom = async (what) => {
    const same = await page.evaluate(() => {
      const now = document.querySelector('[data-room-picture] iframe');
      return now === window.__room.frame && now.src === window.__room.src && window.__room.loads === 0;
    });
    assert.equal(same, true, `${what}: the same player, not reloaded`);
  };
  const stage = await page.evaluate(() => {
    const r = document.querySelector('[data-room-picture]').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const t0 = await clock();
  await dbl(stage.x, stage.y);
  assert.notEqual(await fullIs(), 'none', 'a double press on the room\'s YouTube picture goes fullscreen');
  await page.screenshot({ path: join(SHOTS, 'float-room-full.png') });
  await dbl(stage.x, stage.y);
  assert.equal(await fullIs(), 'none', 'another comes back');
  await stillRoom('the room, in and out of fullscreen');
  const t1 = await clock();
  assert.ok(t1 > t0, `the room's clock carries on: ${t0} then ${t1}`);
  pass(`a room's YouTube picture: a double press goes fullscreen and comes back, in step (${t0}s, then ${t1}s)`);

  await page.getByRole('button', { name: 'Fullscreen', exact: true }).first().click();
  await sleep(800);
  assert.notEqual(await fullIs(), 'none', 'the room\'s FULL key still works');
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.evaluate(() => document.exitFullscreen().catch(() => undefined));
  await sleep(800);
  pass('the room\'s own FULL key still works');

  await page.getByRole('button', { name: /^Picture in picture: floats/ }).first().click();
  await page.waitForSelector('[data-room-picture="floating"]');
  await sleep(800);
  const float = await page.evaluate(() => document.querySelector('[data-room-picture]').getBoundingClientRect().toJSON());
  await dbl(float.left + float.width / 2, float.top + float.height / 2 + 20);
  assert.equal(await fullIs(), 'DIV', 'a double press on the floating room picture goes fullscreen');
  const full = await page.evaluate(() => document.querySelector('[data-room-picture]').getBoundingClientRect().toJSON());
  assert.ok(full.width > 1000, `it fills the screen: ${full.width}`);
  await page.screenshot({ path: join(SHOTS, 'float-room-float-full.png') });
  await dbl(720, 500);
  assert.equal(await fullIs(), 'none', 'another comes back');
  await sleep(300);
  const back = await page.evaluate(() => document.querySelector('[data-room-picture]').getBoundingClientRect().toJSON());
  assert.ok(near(back.left, float.left) && near(back.top, float.top) && near(back.width, float.width) && near(back.height, float.height), `back as it was: ${JSON.stringify([float, back])}`);
  await dbl(float.left + 40, float.top + 15);
  assert.equal(await fullIs(), 'DIV', 'a double press on its title line goes fullscreen');
  await page.evaluate(() => document.exitFullscreen());
  await sleep(600);
  await stillRoom('the room\'s float, in and out of fullscreen');
  pass('a room\'s floating picture goes fullscreen and comes back exactly as it was');
  await page.locator('[data-room-float]').getByRole('button', { name: 'Back to the room' }).click();
  await sleep(800);

  // A plain file on the stage: our own <video> with no controls of its own.
  await addLink('https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm');
  await page.getByRole('button', { name: 'Skip to the next video' }).first().click();
  await page.waitForSelector('[data-room-picture] video');
  await sleep(1500);
  await page.evaluate(() => {
    window.__video = document.querySelector('[data-room-picture] video');
  });
  await dbl(stage.x, stage.y);
  assert.notEqual(await fullIs(), 'none', 'a double press on the room\'s own <video> goes fullscreen');
  await dbl(stage.x, stage.y);
  assert.equal(await fullIs(), 'none', 'another comes back');
  assert.equal(await page.evaluate(() => window.__video === document.querySelector('[data-room-picture] video')), true, 'the same element');
  pass('a room\'s own video file: a double press goes fullscreen and comes back');
}

(async () => {
  if (!MOCK) {
    loadEnv();
    process.loadEnvFile('.env.production');
    process.loadEnvFile(opt('--env-test', '.env.test'));
  }
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: !flag('--headed'),
    args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  try {
    await signIn(page);
    // A new tab's first page of the site: nowhere to go either way, however much history it had before the site.
    const fresh = await context.newPage();
    await fresh.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded' });
    await fresh.getByRole('button', { name: 'Back', exact: true }).waitFor();
    await fresh.waitForTimeout(1500);
    assert.equal(await fresh.getByRole('button', { name: 'Back', exact: true }).isDisabled(), true, 'first page: back is quiet');
    assert.equal(await fresh.getByRole('button', { name: 'Forward', exact: true }).isDisabled(), true, 'first page: forward is quiet');
    pass('the first page of a tab: both arrows quiet');
    await fresh.close();
    if (flag('--room')) {
      if (!MOCK) throw new Error('--room goes live, so it runs on the mock site only');
      await roomRun(page);
      return;
    }
    if (!flag('--files-only')) await mediaRun(page);
    if (!flag('--media-only')) await filesRun(page);
    // Phone width: the site gives a phone its 1280 layout, zoomed out.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const small = await phone.newPage();
    await signIn(small);
    await small.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded' });
    await small.waitForFunction(() => [...document.querySelectorAll('li')].some((row) => /YOUTUBE/.test(row.innerText) && /\[ ▶ PLAY \]/.test(row.innerText)), null, { timeout: 45000 });
    await small.locator('li', { hasText: 'YOUTUBE' }).filter({ hasText: '[ ▶ PLAY ]' }).first().getByRole('button', { name: /^Play / }).click();
    await small.waitForSelector('[data-floating-player] iframe');
    await small.waitForTimeout(2500);
    await small.screenshot({ path: join(SHOTS, 'float-phone-box.png') });
    await small.getByRole('navigation', { name: 'Site pages' }).getByRole('link', { name: 'FORUM' }).click();
    await small.waitForURL(/\/forum/);
    await small.waitForTimeout(2000);
    await small.screenshot({ path: join(SHOTS, 'float-phone-float.png') });
    assert.equal(await small.locator('[data-floating-player]').getAttribute('data-floating-player'), 'floating');
    const scroll = await small.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    assert.ok(scroll, 'no sideways scroll on a phone');
    const arrowSize = await small.getByRole('button', { name: 'Back', exact: true }).boundingBox();
    assert.ok(arrowSize.height >= 44 && arrowSize.width >= 44, `a finger's size on a phone: ${JSON.stringify(arrowSize)}`);
    pass('phone: floats, no sideways scroll, the arrows are a full tap size');
    await phone.close();
  } finally {
    console.log(`\n${passed} proved. ${soft.length} noted. Page errors: ${errors.length}`);
    for (const error of errors.slice(0, 8)) console.log(`  page error: ${error.slice(0, 300)}`);
    await browser.close();
  }
})().catch((error) => {
  console.error(`FAILED: ${error.message}`);
  process.exit(1);
});
