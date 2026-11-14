/*
 * Companions in a stream room with the room's window OPEN (Luke, 2026-11-14: "the way stream room windows currently are
 * can obscure the characters from view"). In real browsers, as TEST ACCOUNT A (the host) and B. Not in `npm run checks`.
 *
 *   node scripts/drive-companion-room.cjs --base https://debaser-site.vercel.app [--before] [--headed] [--env-test <path>]
 *
 * A starts a room from a MEDIA video and leaves its window open; B joins by the room's link and leaves it open too.
 *   --before   only looks: screenshots each screen and says whether each companion can be seen (what is at its middle),
 *              for the record of how it was. Asserts nothing about that.
 *   otherwise  every companion on each screen is in view (the figure itself is what is at its middle, not a window over
 *              it), standing on the top edge of the room's window (Luke's pick: "Stand on the window's top edge"), over
 *              none of the window's or the music bar's keys, every title bar key still taking a press; while the room's
 *              video plays they sit there; the window folded away, they are back on their strip, and up again when it
 *              is brought back.
 * Also at phone width (A, its phone switch on).
 *
 * It starts one stream room as A, ended at the close: printed so it can be cleared (a delete, so Luke's OK first).
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { findChrome, installSession, loadEnv, signInTestAccount } = require('./browser.cjs');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'https://debaser-site.vercel.app').replace(/\/$/, '');
const BEFORE = flag('--before');
/** Only ends a room a drive that stopped early left live: --end <room id>. */
const END = opt('--end', null);
const TAG = BEFORE ? 'before' : 'after';
const SHOTS = join('Temp', 'browse');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};
const left = [];

async function person(browser, letter, { phone = false } = {}) {
  const account = await signInTestAccount(letter);
  if (account.error) throw new Error(`sign-in ${letter}: ${account.error}`);
  const context = await browser.newContext(
    phone
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 } },
  );
  await context.addInitScript(() => window.localStorage.setItem('debaser.lost-account.never.v1', '1'));
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  page error (${letter}): ${String(error).slice(0, 200)}`));
  await installSession(page, account);
  return { page, account, context };
}

async function clearPrivacyWindow(page) {
  const close = page.locator('[data-dock-window="privacy-first-look"]').getByRole('button', { name: /^Close / });
  if ((await close.count()) > 0) await close.first().click().catch(() => undefined);
}

/** Every companion on the screen: whose, where, what it plays, and whether the figure is what a look at its middle finds. */
function readCompanions() {
  const room = document.querySelector('[data-dock-window="stream"]');
  const roomBox = room === null || room.dataset.minimized === 'true' ? null : room.getBoundingClientRect();
  const keys = [...document.querySelectorAll('[data-dock-window] button, [data-stream-bar] button, .fixed.bottom-0 button, [data-dock-window] input, [data-dock-window] textarea, [data-dock-window] a')].filter((key) => {
    const r = key.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(key).visibility !== 'hidden';
  });
  const bar = Number.parseFloat(document.documentElement.style.getPropertyValue('--bottom-bar')) || 0;
  // The title bar's own keys (fold, close): each must be what a press at its middle lands on.
  const titleKeys = room === null ? [] : [...room.querySelectorAll('button[aria-label^="Fold "], button[aria-label^="Close "]')];
  return {
    window: roomBox === null ? null : { left: Math.round(roomBox.left), top: Math.round(roomBox.top), right: Math.round(roomBox.right), bottom: Math.round(roomBox.bottom) },
    screen: { w: window.innerWidth, h: window.innerHeight },
    strip: Math.round(window.innerHeight - bar),
    titleKeys: titleKeys.length,
    titleKeysBlocked: titleKeys
      .filter((key) => {
        const r = key.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return top === null || !key.contains(top);
      })
      .map((key) => key.getAttribute('aria-label')),
    companions: [...document.querySelectorAll('[data-companion="own"], [data-companion="room"]')].map((figure) => {
      const box = figure.getBoundingClientRect();
      const shown = figure.style.visibility === 'visible';
      const at = shown ? document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) : null;
      const covers = keys
        .filter((key) => {
          const r = key.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return top !== null && figure.contains(top);
        })
        .map((key) => key.getAttribute('aria-label') || key.textContent.trim().slice(0, 30));
      return {
        who: figure.getAttribute('aria-label'),
        shown,
        // In view: the figure itself is what is there, or another companion standing in front of it (they may overlap).
        // Or it is letting presses through to a key of the page behind it (it is still drawn in front; only the press goes
        // past it): then what matters is that no window is over it.
        inView:
          shown &&
          at !== null &&
          (figure.contains(at) || at.closest('[data-companion]') !== null || (getComputedStyle(figure).pointerEvents === 'none' && at.closest('[data-dock-window]') === null)),
        under: at === null || figure.contains(at) || at.closest('[data-companion]') !== null ? null :(at.closest('[data-dock-window]')?.getAttribute('data-dock-window') ?? at.tagName.toLowerCase()),
        left: Math.round(box.left),
        right: Math.round(box.right),
        top: Math.round(box.top),
        bottom: Math.round(box.bottom),
        mood: figure.dataset.mood,
        motion: figure.dataset.motion ?? null,
        covers,
      };
    }),
  };
}

function describe(read) {
  return read.companions.map((c) => `${c.who}: ${!c.shown ? 'not drawn' : c.inView ? `in view at ${c.left},${c.bottom} (${c.motion})` : `HIDDEN under ${c.under}`}`).join('; ');
}

(async () => {
  loadEnv();
  process.loadEnvFile('.env.production');
  process.loadEnvFile(opt('--env-test', '.env.test'));
  const browser = await chromium.launch({ executablePath: findChrome(), headless: !flag('--headed'), args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let a = null;
  let live = null;
  try {
    if (END !== null) {
      a = await person(browser, 'A');
      await a.page.goto(`${BASE}/forum?watch=${END}`, { waitUntil: 'domcontentloaded' });
      await a.page.mouse.move(700, 300);
      await a.page.waitForSelector('[data-room-picture], [data-watch-tv-box]', { state: 'attached', timeout: 45000 });
      live = END;
      return;
    }
    console.log(`A starts a room and leaves its window open (${TAG})`);
    a = await person(browser, 'A');
    const rooms = [];
    a.page.on('request', (request) => {
      if (request.method() === 'POST' && /\/rest\/v1\/watch_rooms\b/.test(request.url())) {
        try {
          const body = JSON.parse(request.postData() ?? '{}');
          if (typeof body.id === 'string') rooms.push(body.id);
        } catch {
          // Not the row.
        }
      }
    });
    await a.page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded' });
    await a.page.mouse.move(700, 300);
    await a.page.waitForFunction(() => document.querySelector('[data-watch-in-room="start"]') !== null || document.querySelector('button[aria-label^="Play"]') !== null, null, { timeout: 45000 });
    await clearPrivacyWindow(a.page);
    const row = a.page.locator('li').filter({ hasText: 'YOUTUBE' }).filter({ hasText: '[ ▶ PLAY ]' }).first();
    const title = await row.locator('p').first().innerText();
    await row.locator('button[aria-label^="Play"]').first().click();
    await a.page.waitForSelector('[data-floating-player] iframe', { timeout: 20000 });
    await sleep(3000);
    await a.page.locator('li').filter({ hasText: title }).first().locator('[data-watch-in-room="start"]').click();
    const dialog = a.page.getByRole('dialog', { name: 'WATCH IN ROOM' });
    await dialog.waitFor();
    await dialog.locator('[data-go-live-name]').fill('COMPANION ROOM DRIVE');
    await dialog.locator('[data-go-live-topic]').fill('A test room, to be deleted');
    await dialog.locator('[data-room-privacy="open"]').click();
    await dialog.locator('[data-go-live-start]').click();
    // From here a room may be live: it is ended at the close whether or not its id was seen.
    live = 'started';
    await a.page.waitForSelector('[data-room-picture]', { timeout: 30000 });
    const roomId = rooms.at(-1) ?? null;
    assert.ok(roomId, 'the room was written');
    live = roomId;
    left.push(`stream room ${roomId} (ended at the close; its record and board thread stay)`);
    // The site remembers a folded room: unfold it if it came up folded.
    const up = a.page.locator('[data-watch-tv-box] button');
    if ((await up.count()) > 0 && (await up.first().isVisible().catch(() => false))) await up.first().click();
    await sleep(1500);

    console.log('B joins by the link, window open');
    const b = await person(browser, 'B');
    await b.page.goto(`${BASE}/forum?watch=${roomId}`, { waitUntil: 'domcontentloaded' });
    await b.page.mouse.move(700, 300);
    await b.page.waitForSelector('[data-room-picture], [data-watch-tv-box]', { state: 'attached', timeout: 45000 });
    await clearPrivacyWindow(b.page);
    const upB = b.page.locator('[data-watch-tv-box] button');
    if ((await upB.count()) > 0 && (await upB.first().isVisible().catch(() => false))) await upB.first().click();
    await b.page.waitForSelector('[data-companion="room"]', { state: 'attached', timeout: 30000 });
    await a.page.waitForSelector('[data-companion="room"]', { state: 'attached', timeout: 30000 });
    await a.page.mouse.move(700, 300);
    await sleep(4000);

    const onA = await a.page.evaluate(readCompanions);
    const onB = await b.page.evaluate(readCompanions);
    await a.page.screenshot({ path: join(SHOTS, `companion-room-open-a-${TAG}.png`) });
    await b.page.screenshot({ path: join(SHOTS, `companion-room-open-b-${TAG}.png`) });
    console.log(`  A's screen: window ${JSON.stringify(onA.window)} of ${onA.screen.w} x ${onA.screen.h}; ${describe(onA)}`);
    console.log(`  B's screen: window ${JSON.stringify(onB.window)} of ${onB.screen.w} x ${onB.screen.h}; ${describe(onB)}`);

    if (!BEFORE) {
      /** One screen, looked at: both there, in view, feet on the window's top edge between its corners, over no key. */
      const onTheWindow = (who, read, when) => {
        assert.ok(read.window, `${who}'s screen${when}: the room's window is open`);
        assert.equal(read.companions.length, 2, `${who}'s screen${when} draws both companions (there: ${describe(read) || 'none'})`);
        for (const c of read.companions) {
          assert.ok(c.inView, `${who}'s screen${when}: ${c.who} is in view with the room's window open (${c.shown ? `under ${c.under}` : 'not drawn'})`);
          assert.ok(Math.abs(c.bottom - read.window.top) <= 1, `${who}'s screen${when}: ${c.who} stands on the window's top edge (feet ${c.bottom}, edge ${read.window.top})`);
          assert.ok(c.top >= 0, `${who}'s screen${when}: ${c.who} is whole on the screen (top ${c.top})`);
          assert.ok(c.left >= read.window.left - 1 && c.right <= read.window.right + 1, `${who}'s screen${when}: ${c.who} is between the window's corners`);
          assert.deepEqual(c.covers, [], `${who}'s screen${when}: ${c.who} covers a key`);
        }
        assert.ok(read.titleKeys >= 2, `${who}'s screen${when}: the title bar has its fold and close keys`);
        assert.deepEqual(read.titleKeysBlocked, [], `${who}'s screen${when}: a title bar key would not take a press`);
      };
      onTheWindow('A', onA, '');
      onTheWindow('B', onB, '');
      pass(`the room's window open on both screens: both companions in view on its top edge (feet at ${onA.window.top}, the window drawn ${onA.window.top}px down to make room), over no key, the title bar's keys all pressable`);

      // Watched for half a minute as they move about: always up there in view, never over a key.
      const places = new Set();
      for (let i = 0; i < 30; i += 1) {
        if (i % 6 === 0) await a.page.mouse.move(200 + ((i * 131) % 1000), i % 12 === 0 ? 880 : 300);
        for (const [who, page] of [['A', a.page], ['B', b.page]]) {
          const read = await page.evaluate(readCompanions);
          onTheWindow(who, read, `, reading ${i}`);
          for (const c of read.companions) places.add(`${who}:${c.who}:${c.left}`);
        }
        await sleep(1000);
      }
      pass(`watched for 30 s on both screens: always in view on the window's top edge, never over a key (${places.size} places seen)`);

      // While the room's video plays, they sit along the edge.
      const sitting = async (page) => (await page.evaluate(readCompanions)).companions.map((c) => c.motion);
      let sat = null;
      for (let i = 0; i < 40 && sat === null; i += 1) {
        await a.page.mouse.move(700, 300);
        const [ma, mb] = [await sitting(a.page), await sitting(b.page)];
        if ([...ma, ...mb].every((motion) => motion === 'sit')) sat = { ma, mb };
        else await sleep(500);
      }
      if (sat === null) console.log(`  (motions now: A's screen ${await sitting(a.page)}, B's screen ${await sitting(b.page)})`);
      assert.ok(sat, 'while the video plays every companion sits on the edge');
      await a.page.screenshot({ path: join(SHOTS, 'companion-room-sitting-a.png') });
      await b.page.screenshot({ path: join(SHOTS, 'companion-room-sitting-b.png') });
      pass('the video playing: every companion on both screens sits on the edge of the window');

      // Folded away, the window is gone from over the strip: they are back on it. Brought back, they are up again.
      await a.page.locator('[data-dock-window="stream"]').getByRole('button', { name: /^Fold / }).click();
      let down = null;
      for (let i = 0; i < 20 && down === null; i += 1) {
        await sleep(400);
        const read = await a.page.evaluate(readCompanions);
        if (read.companions.length === 2 && read.companions.every((c) => c.shown && Math.abs(c.bottom - read.strip) <= 1)) down = read;
      }
      assert.ok(down, 'the window folded away: both are back on the strip');
      for (const c of down.companions) assert.deepEqual(c.covers, [], `on the strip: ${c.who} covers a key`);
      await a.page.screenshot({ path: join(SHOTS, 'companion-room-folded-a.png') });
      pass(`the window folded away: both are back on the strip above the music bar (feet at ${down.strip})`);
      await a.page.locator('[data-watch-tv-box] button').first().click();
      let up = null;
      for (let i = 0; i < 20 && up === null; i += 1) {
        await sleep(400);
        const read = await a.page.evaluate(readCompanions);
        if (read.window !== null && read.companions.length === 2 && read.companions.every((c) => c.shown && Math.abs(c.bottom - read.window.top) <= 1)) up = read;
      }
      assert.ok(up, 'the window brought back: both are up on its top edge again');
      pass('the window brought back: both are up on its top edge again');
    }

    console.log('Phone width (A, its phone switch on)');
    const phone = await person(browser, 'A', { phone: true });
    await phone.page.goto(`${BASE}/forum?watch=${roomId}`, { waitUntil: 'domcontentloaded' });
    await phone.page.waitForSelector('[data-room-picture], [data-watch-tv-box]', { state: 'attached', timeout: 45000 });
    await clearPrivacyWindow(phone.page);
    const upP = phone.page.locator('[data-watch-tv-box] button');
    if ((await upP.count()) > 0 && (await upP.first().isVisible().catch(() => false))) await upP.first().click();
    await sleep(5000);
    const onPhone = await phone.page.evaluate(readCompanions);
    await phone.page.screenshot({ path: join(SHOTS, `companion-room-open-phone-${TAG}.png`) });
    console.log(`  phone: window ${JSON.stringify(onPhone.window)} of ${onPhone.screen.w} x ${onPhone.screen.h}; ${describe(onPhone) || 'no companions drawn'}`);
    if (!BEFORE) {
      const drawn = onPhone.companions.filter((one) => one.shown);
      assert.ok(drawn.length >= 1, 'phone: a companion is drawn');
      for (const c of drawn) {
        assert.ok(c.inView, `phone: ${c.who} is in view (under ${c.under})`);
        // A phone's screen is tall and the window is at its top, not over the strip: they are on their strip, in view.
        assert.ok(Math.abs(c.bottom - onPhone.strip) <= 1 || Math.abs(c.bottom - onPhone.window.top) <= 1, `phone: ${c.who} stands on its strip or on the window (feet ${c.bottom}, strip ${onPhone.strip}, window top ${onPhone.window.top})`);
        assert.deepEqual(c.covers, [], `phone: ${c.who} covers a key`);
      }
      assert.deepEqual(onPhone.titleKeysBlocked, [], 'phone: a title bar key would not take a press');
      assert.ok(onPhone.window.top <= 16, `phone: the window is not moved down for nothing (top ${onPhone.window.top})`);
      pass(`phone width: ${drawn.length} companion(s) in view on their strip (the window, at the top of a tall screen, is not over it and stays put), over no key`);
    }
    await phone.context.close();

    await b.context.close();
    console.log(`\n${BEFORE ? 'looked (--before): nothing asserted about the view' : `${passed} passed`}. Screenshots in ${SHOTS}/companion-room-*.png`);
  } catch (error) {
    if (a !== null) await a.page.screenshot({ path: join(SHOTS, 'companion-room-failed.png') }).catch(() => undefined);
    console.error(error);
    process.exitCode = 1;
  } finally {
    // The room ends, for everybody, however the drive went.
    if (a !== null && live !== null) {
      try {
        if (live === 'started') console.log('  (the room id was never seen: ending whatever room is on screen)');
        const up = a.page.locator('[data-watch-tv-box] button');
        if ((await up.count()) > 0 && (await up.first().isVisible().catch(() => false))) await up.first().click();
        await a.page.getByRole('button', { name: '[ END STREAM ]' }).last().click({ timeout: 10000 });
        await a.page.getByRole('button', { name: '[ END FOR EVERYBODY ]' }).last().click({ timeout: 10000 });
        await sleep(1500);
        console.log(`  the room ${live} ended`);
      } catch (error) {
        console.log(`  COULD NOT END THE ROOM ${live}: ${String(error).slice(0, 160)}`);
      }
    }
    if (left.length > 0) console.log(`Left to clear:\n  ${left.join('\n  ')}`);
    await browser.close();
  }
})();
