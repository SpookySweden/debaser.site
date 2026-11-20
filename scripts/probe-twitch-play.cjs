/*
 * Does a Twitch live actually play? (SPEC-live-streams.md; Luke 2026-11-17: "There was a network error. Please try again.
 * (Error #2000)"). Read-only, signed out, no account and nothing written:
 *   node scripts/probe-twitch-play.cjs --base https://debaser-site.vercel.app [--browser chrome|edge] [--headed]
 *
 * Opens MEDIA with the LIVE key, presses PLAY on a Twitch row, presses Twitch's own play if it waits, then reports from inside
 * Twitch's player: its error text (if any), whether its <video> is advancing and decoding frames, and every Twitch request that
 * failed or was refused (usher.ttvnw.net, *.ttvnw.net, gql.twitch.tv, video-weaver...). Exit 0 when the video advanced.
 */
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const BASE = arg('--base', 'https://debaser-site.vercel.app').replace(/\/$/, '');
const which = arg('--browser', 'chrome');
const EXE = {
  chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
}[which];

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `twitch-probe-${which}-`));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: EXE,
    headless: !argv.includes('--headed'),
    viewport: { width: 1440, height: 1000 },
    // `--jitless` stands in for Edge's "Enhance your security on the web" (no fast JavaScript compiler, so no WebAssembly).
    args: ['--autoplay-policy=no-user-gesture-required', ...(argv.includes('--jitless') ? ['--js-flags=--jitless'] : [])],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  // `--block <regex>`: refuse matching requests, as a blocking extension would (to find which refusal Twitch calls #2000).
  const block = arg('--block', null);
  if (block !== null) await context.route(new RegExp(block), (route) => route.abort());
  // `--fake-gate`: our own live list says every channel needs a Twitch sign-in, while the stream really plays: what a viewer signed in
  // to Twitch sees (Luke, 2026-11-18: "remove the error message on twitch streams after already being signed in").
  const fakeGate = argv.includes('--fake-gate');
  if (fakeGate) {
    await context.route(/\/api\/web\/live\?channels=/, async (route) => {
      const answer = await route.fetch();
      const body = await answer.json().catch(() => ({ items: [] }));
      body.items = (body.items ?? []).map((item) => ({ ...item, signInToWatch: true }));
      await route.fulfill({ response: answer, json: body });
    });
  }
  const twitchTrouble = [];
  const isTwitch = (url) => /twitch\.tv|ttvnw\.net|jtvnw\.net/.test(url);
  context.on('requestfailed', (request) => {
    if (isTwitch(request.url())) twitchTrouble.push(`FAILED ${request.failure()?.errorText ?? ''} ${request.url().slice(0, 140)}`);
  });
  context.on('response', (response) => {
    if (isTwitch(response.url()) && response.status() >= 400) twitchTrouble.push(`${response.status()} ${response.url().slice(0, 140)}`);
  });
  const usher = [];
  context.on('response', (response) => {
    if (/usher\.ttvnw\.net|\.m3u8|video-weaver/.test(response.url())) usher.push(`${response.status()} ${response.url().split('?')[0].slice(0, 100)}`);
  });
  let code = 1;
  try {
    // `--q <words>`: a LIVE search instead of the most-watched list, for a stream that embeds and plays signed out.
    const q = arg('--q', null);
    await page.goto(`${BASE}/media?live=1${q === null ? '' : `&in=twitch&q=${encodeURIComponent(q)}`}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    // The lost-account window can arrive a moment after the page: wait for it, answer it, and shut any other window over the page.
    const never = page.getByRole('button', { name: /I NEVER HAD ONE/ });
    await never.waitFor({ timeout: 10_000 }).catch(() => undefined);
    if (await never.isVisible().catch(() => false)) await never.click();
    await page.waitForTimeout(1000);
    for (let tries = 0; tries < 3 && (await page.locator('.z-popout').count()) > 0; tries += 1) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
    const popout = await page.locator('.z-popout').first().innerText().catch(() => '');
    if (popout) console.log(`[${which}] still a window over the page: ${popout.replace(/\s+/g, ' ').slice(0, 160)}`);
    const rows = page.locator('li[data-view]:has([data-live-mark])');
    await rows.first().waitFor({ timeout: 60_000 });
    // A stream Twitch shows signed out (rows marked 18+ · SIGN IN ask for a Twitch sign-in first).
    const row = rows.filter({ hasNotText: /SIGN IN/ }).nth(Number(arg('--row', '0')));
    const title = (await row.innerText()).split('\n')[0];
    await row.getByRole('button', { name: /^Play / }).first().click();
    const frameEl = page.locator('[data-watch-embed="twitch"] iframe, iframe[src*="player.twitch.tv"]').first();
    await frameEl.waitFor({ timeout: 30_000 });
    // The room's sign-in note, read before Twitch has started (the live list is asked as the play goes on).
    await page.waitForTimeout(1500);
    const noteBefore = await page.locator('[data-watch-sign-in]').count();
    const src = await frameEl.getAttribute('src');
    const attrs = await frameEl.evaluate((el) => ({ sandbox: el.getAttribute('sandbox'), allow: el.getAttribute('allow'), referrerpolicy: el.getAttribute('referrerpolicy'), inRoom: Boolean(el.closest('[data-watch-embed]')) }));
    console.log(`[${which}] playing "${title.slice(0, 60)}"`);
    console.log(`[${which}] frame: ${src}`);
    console.log(`[${which}] attrs: ${JSON.stringify(attrs)}`);
    const frame = page.frameLocator('[data-watch-embed="twitch"] iframe, iframe[src*="player.twitch.tv"]').first();
    await page.waitForTimeout(8000);
    await frame.locator('button[data-a-target="player-play-pause-button"][aria-label*="Play"]').click({ timeout: 4000 }).catch(() => undefined);
    const read = async () =>
      frame.locator('body').evaluate(() => {
        const video = document.querySelector('video');
        const quality = video && video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality().totalVideoFrames : null;
        const text = document.body.innerText.replace(/\s+/g, ' ');
        const error = /Error #\d+[^.]*|network error[^.]*/i.exec(text)?.[0] ?? null;
        return { time: video ? video.currentTime : null, ready: video ? video.readyState : null, paused: video ? video.paused : null, frames: quality, error };
      });
    const first = await read();
    await page.waitForTimeout(15_000);
    const second = await read();
    const clock = await page.locator('[data-watch-clock]').first().innerText().catch(() => '');
    console.log(`[${which}] video then: ${JSON.stringify(first)}`);
    console.log(`[${which}] video now:  ${JSON.stringify(second)}`);
    console.log(`[${which}] room clock: "${clock}"`);
    console.log(`[${which}] stream requests: ${usher.length ? usher.slice(0, 6).join(' | ') : 'none'}`);
    console.log(`[${which}] Twitch trouble: ${twitchTrouble.length ? '\n  ' + twitchTrouble.slice(0, 15).join('\n  ') : 'none'}`);
    await page.screenshot({ path: path.join('Temp', 'browse', `twitch-probe-${which}.png`) });
    const advanced = second.time !== null && first.time !== null && second.time > first.time + 2;
    console.log(`[${which}] ${advanced && !second.error ? 'PLAYS' : 'DOES NOT PLAY'}`);
    code = advanced && !second.error ? 0 : 1;
    if (fakeGate) {
      const noteAfter = await page.locator('[data-watch-sign-in]').count();
      const sayAfter = await page.locator('[data-watch-dead], [data-watch-sign-in]').count();
      console.log(`[${which}] sign-in note before it played: ${noteBefore}; once it plays: ${noteAfter} (any note: ${sayAfter})`);
      const clears = noteBefore > 0 && noteAfter === 0 && sayAfter === 0;
      console.log(`[${which}] ${clears ? 'NOTE CLEARS ONCE IT PLAYS' : 'NOTE DOES NOT CLEAR'}`);
      code = advanced && !second.error && clears ? 0 : 1;
    }
    if (argv.includes('--recover') && block !== null) {
      // The room's note while Twitch can't start: where it sits, what it says, and that it lets Twitch's own RELOAD through.
      const note = page.locator('[data-watch-dead]');
      const noteText = (await note.innerText().catch(() => '')).replace(/\s+/g, ' ');
      const link = await note.locator('[data-watch-twitch-page]').getAttribute('href').catch(() => null);
      const stage = await page.locator('[data-watch-embed="twitch"]').boundingBox();
      const noteBox = await note.locator('p').boundingBox().catch(() => null);
      const inTopQuarter = stage !== null && noteBox !== null && noteBox.y < stage.y + stage.height / 4;
      const passes = await note.evaluate((el) => getComputedStyle(el).pointerEvents).catch(() => null);
      console.log(`[${which}] note: "${noteText}" link=${link} top=${inTopQuarter} pointer-events=${passes}`);
      await context.unroute(new RegExp(block));
      const reload = frame.getByText(/Reload Player/i).first();
      const pressed = await reload.click({ timeout: 8000 }).then(() => true).catch((e) => (console.log(`[${which}] reload press: ${e.message.split('\n')[0]}`), false));
      await page.waitForTimeout(6000);
      // After its RELOAD Twitch waits on its own big play key in the middle: pressed where a person would, through the room.
      const box = await page.locator('[data-watch-embed="twitch"] iframe').first().boundingBox();
      if (box !== null) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(3000);
      const r1 = await read();
      await page.waitForTimeout(12_000);
      const r2 = await read();
      const noteLeft = await page.locator('[data-watch-dead]').count();
      await page.screenshot({ path: path.join('Temp', 'browse', `twitch-recover-${which}.png`) });
      const recovered = r2.time !== null && r1.time !== null && r2.time > r1.time + 2 && !r2.error;
      console.log(`[${which}] after RELOAD (pressed through our note: ${pressed}): ${JSON.stringify(r2)}; our note left: ${noteLeft}`);
      console.log(`[${which}] ${recovered && noteLeft === 0 && pressed ? 'RECOVERS' : 'DOES NOT RECOVER'}`);
      code = recovered && noteLeft === 0 && pressed && /COULDN.T START/.test(noteText) && link !== null && inTopQuarter ? 0 : 1;
    }
  } catch (error) {
    console.log(`[${which}] probe broke: ${error && error.message}`);
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
  process.exit(code);
})();
