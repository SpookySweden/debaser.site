/*
 * Two people in one stream room, each seeing the other's companion say a chat line (SPEC-character-speech.md phase 3).
 * The one thing about character speech that cannot be proved on mock data: real-time between two accounts. Short, on
 * the deployed site, as kept TEST ACCOUNT A and B. Luke's OK for one run: 2026-11-15 ("Yes, one short test").
 *
 *   node "<notes>\heavy-step.cjs" PROFILE --live -- node scripts/drive-speech-room-live.cjs [--base <site>] [--headed]
 *
 * A goes live (PRIVATE, as offered), B opens the room's address and presses JOIN at its door, B says a line and then A does:
 *   - on A's screen B's companion says B's words in a bubble that is wholly on the screen; on B's own screen too;
 *   - on B's screen A's companion says A's words;
 *   - the audio key is in the room, beside the chat, and off.
 * No watching windows: each wait ends the moment the thing is seen. The room is ended at the close, whatever happened.
 * IT LEAVES: one ended stream room with its board thread, and two chat lines in it. Clearing them is a delete: Luke's OK.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { findChrome, installSession, signInTestAccount } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'https://debaser-site.vercel.app').replace(/\/$/, '');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

async function person(browser, letter) {
  const account = await signInTestAccount(letter);
  if (account.error) throw new Error(`sign-in ${letter}: ${account.error}`);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => window.localStorage.setItem('debaser.lost-account.never.v1', '1'));
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  page error (${letter}): ${String(error).slice(0, 200)}`));
  await installSession(page, account);
  return { page, account };
}

async function clearWindows(page) {
  for (const id of ['privacy-first-look', 'preferences']) {
    const close = page.locator(`[data-dock-window="${id}"]`).getByRole('button', { name: /^Close / });
    if ((await close.count()) > 0) await close.first().click().catch(() => undefined);
  }
}

async function unfold(page) {
  const up = page.locator('[data-watch-tv-box] button');
  if ((await up.count()) > 0 && (await up.first().isVisible().catch(() => false))) await up.first().click();
}

const chatOf = (page) => page.getByPlaceholder('Say something...').last();

/** Waits for a bubble under `figure`, then reads it until its words are `line` (pages read as they go by). */
async function hears(page, figure, line, what) {
  const bubble = `${figure} [data-speech-bubble]`;
  await page.waitForSelector(bubble, { state: 'attached', timeout: 20000 }).catch(() => {
    throw new Error(`${what}: no bubble appeared within 20 s`);
  });
  const where = await page.evaluate((selector) => {
    const box = document.querySelector(selector).getBoundingClientRect();
    return { onScreen: box.top >= 0 && box.left >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight, top: Math.round(box.top), left: Math.round(box.left) };
  }, bubble);
  const byPage = {};
  for (let look = 0; look < 120; look += 1) {
    const now = await page.evaluate((selector) => {
      const el = document.querySelector(selector);
      return el === null ? null : { page: el.getAttribute('data-speech-page'), typed: [...el.querySelectorAll('[data-speech-typed]')].map((part) => part.textContent).join(' ') };
    }, bubble);
    if (now === null) break;
    if ((byPage[now.page] ?? '').length < now.typed.length) byPage[now.page] = now.typed;
    const said = Object.keys(byPage).sort().map((key) => byPage[key]).join(' ');
    if (said.replace(/ /g, '') === line.replace(/ /g, '')) break;
    await sleep(100);
  }
  const said = Object.keys(byPage).sort().map((key) => byPage[key]).join(' ');
  assert.equal(said.replace(/ /g, ''), line.replace(/ /g, ''), `${what}: the bubble says the words that were typed (${JSON.stringify(byPage)})`);
  assert.ok(where.onScreen, `${what}: the bubble is wholly on the screen (${JSON.stringify(where)})`);
  pass(`${what}: "${said}", wholly on the screen`);
}

async function main() {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: !args.includes('--headed'), args: ['--no-first-run'] });
  let a = null;
  let roomId = null;
  let started = false;
  try {
    a = await person(browser, 'A');
    const seen = [];
    a.page.on('request', (request) => {
      const url = request.url();
      if (!/\/rest\/v1\/watch_/.test(url)) return;
      const inUrl = url.match(new RegExp(`room_id=eq\\.(${UUID.source})`));
      if (inUrl) seen.push(inUrl[1]);
      if (request.method() === 'POST' && /\/rest\/v1\/watch_rooms\b/.test(url)) {
        try {
          const body = JSON.parse(request.postData() ?? '{}');
          if (typeof body.id === 'string') seen.push(body.id);
        } catch {
          // Not the row.
        }
      }
    });
    await a.page.goto(`${BASE}/stream`, { waitUntil: 'domcontentloaded' });
    await a.page.mouse.move(700, 300);
    await clearWindows(a.page);
    await a.page.getByRole('button', { name: /GO LIVE|BACK TO YOUR ROOM/ }).first().click({ timeout: 60000 });
    await sleep(500);
    seen.length = 0;
    // The room is left PRIVATE, as GO LIVE offers it: nobody else on the site sees more than that a room is on.
    const startKey = a.page.locator('[data-go-live-start]');
    if ((await startKey.count()) > 0) await startKey.click();
    started = true;
    // The chat is what says the room has opened: an empty room draws no picture until something is queued.
    await a.page.waitForSelector('[data-room-picture], [data-watch-tv-box], [placeholder="Say something..."]', { state: 'attached', timeout: 45000 });
    await unfold(a.page);
    await chatOf(a.page).waitFor({ timeout: 30000 });
    await sleep(1500);
    roomId = seen.at(-1) ?? new URL(a.page.url()).searchParams.get('watch');
    assert.ok(roomId && UUID.test(roomId), `the room's id was seen (${roomId})`);
    console.log(`  --  A is live in room ${roomId}`);

    const b = await person(browser, 'B');
    await b.page.goto(`${BASE}/forum?watch=${roomId}`, { waitUntil: 'domcontentloaded' });
    await b.page.mouse.move(700, 300);
    // Somebody who is not a member yet gets the room's door (`RoomDoor.tsx`): pressing JOIN is what lets them in. The
    // first run of this check (2026-11-15) waited for the room itself here and stopped: it had never pressed JOIN.
    await b.page.waitForSelector('[data-room-door-join], [data-room-picture], [data-watch-tv-box], [placeholder="Say something..."]', { state: 'attached', timeout: 45000 });
    await clearWindows(b.page);
    const join = b.page.locator('[data-room-door-join]');
    if ((await join.count()) > 0) await join.first().click();
    await b.page.waitForSelector('[data-room-picture], [data-watch-tv-box], [placeholder="Say something..."]', { state: 'attached', timeout: 45000 });
    await unfold(b.page);
    await chatOf(b.page).waitFor({ timeout: 30000 });
    const bOnA = `[data-companion="room"][data-companion-of="${b.account.userId}"]`;
    const aOnB = `[data-companion="room"][data-companion-of="${a.account.userId}"]`;
    await a.page.waitForSelector(bOnA, { state: 'attached', timeout: 30000 }).catch(() => {
      throw new Error("B's companion never appeared on A's screen (is B's companion switched on?)");
    });
    await b.page.waitForSelector(aOnB, { state: 'attached', timeout: 30000 }).catch(() => {
      throw new Error("A's companion never appeared on B's screen (is A's companion switched on?)");
    });
    pass('A and B are in one room, each with the other\'s companion on screen');

    const key = a.page.locator('[data-dock-window="stream"] [data-speech-audio]');
    assert.ok((await key.count()) >= 1, 'the audio key is in the room');
    assert.equal(await key.first().getAttribute('data-speech-audio'), 'off', 'and it starts off');
    pass('the audio key is in the room, beside the chat, and off');

    // A listener that fails is kept as its error, to be thrown once the line has been sent and both have been waited for.
    const settled = (listening) => listening.then(() => null, (error) => error);
    const FROM_B = 'Live check, B speaking.';
    const onA = settled(hears(a.page, bOnA, FROM_B, "on A's screen, B's companion"));
    const onB = settled(hears(b.page, '[data-companion="own"]', FROM_B, "on B's own screen, B's companion"));
    await chatOf(b.page).fill(FROM_B);
    await chatOf(b.page).press('Enter');
    const fromB = [await onA, await onB].filter((error) => error !== null);

    const FROM_A = 'Live check, A speaking.';
    const onB2 = settled(hears(b.page, aOnB, FROM_A, "on B's screen, A's companion"));
    await chatOf(a.page).fill(FROM_A);
    await chatOf(a.page).press('Enter');
    const fromA = [await onB2].filter((error) => error !== null);
    const failures = [...fromB, ...fromA];
    if (failures.length > 0) throw new Error(failures.map((error) => error.message).join(' | '));

    console.log(`${passed} proofs passed`);
  } catch (error) {
    console.error(`FAILED after ${passed} proofs: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (a !== null && started) {
      try {
        await unfold(a.page);
        await a.page.getByRole('button', { name: '[ END STREAM ]' }).last().click({ timeout: 10000 });
        await a.page.getByRole('button', { name: '[ END FOR EVERYBODY ]' }).last().click({ timeout: 10000 });
        await sleep(1500);
        console.log(`  the room ${roomId ?? '(id never seen)'} was ended`);
      } catch (error) {
        console.log(`  COULD NOT END THE ROOM ${roomId ?? '(id never seen)'}: ${String(error).slice(0, 160)}`);
      }
      console.log(`Left to clear (a delete: Luke's OK first): stream room ${roomId ?? '(id never seen)'}, its board thread, and the chat lines said in it`);
    }
    await browser.close();
  }
}

main();
