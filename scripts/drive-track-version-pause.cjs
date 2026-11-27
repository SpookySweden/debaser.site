/*
 * A profile track's version history: the key that reads "pause" pauses (Luke, 2026-11-27, to "Fix the profile track key that says
 * "pause" but restarts the track?": "Yes, fix it"). Driven on a LOCAL mock dev server only (`node scripts/dev-mock-live.cjs <port>`:
 * every switch on mock, mock sign-in, Supabase address empty). Not in `npm run checks`.
 *
 *   node scripts/drive-track-version-pause.cjs --base http://localhost:<port> [--headed]
 *
 * A mock account with two track versions (M1, M2), both a tone the drive serves itself. On its own profile: open the track's
 * history, press M1's "play": the tone plays and the key reads "pause". Press "pause": the tone stops where it is, stays there, and
 * the key reads "play". Press "play": it carries on from the same place (not from the start). The key's hover words say so.
 * Before the fix the second press left the tone playing, so the drive stops there.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { findChrome } = require('./browser.cjs');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const BASE = opt('--base', 'http://localhost:3351').replace(/\/$/, '');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
const pass = (what) => {
  passed += 1;
  console.log(`  ok  ${what}`);
};

const ME = { id: 'track-pause-me', name: 'TRACKPAUSER' };

/** A quiet 40-second tone: long enough that it is still going at the end of the drive. */
function toneWav(seconds = 40, rate = 8000) {
  const samples = seconds * rate;
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + samples * 2, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 3000), 44 + i * 2);
  return data;
}

function seed({ me }) {
  const at = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
  window.localStorage.setItem('debaser.lost-account.never.v1', '1');
  window.localStorage.setItem('debaser.tour.v2', 'skipped');
  // LOVE BUZZ on arrival stays out of it, and the shelf is empty: the only song is the profile's.
  window.sessionStorage.setItem('debaser.audio.love-buzz.v1', 'skipped');
  if (window.localStorage.getItem('track-pause-seeded') !== null) return;
  window.localStorage.setItem('track-pause-seeded', '1');
  window.localStorage.setItem('debaser.audio.mock.v1', JSON.stringify({ version: 1, tracks: [] }));
  const user = { id: me.id, email: `${me.id}@debaser.site`, displayName: me.name, createdAt: at(1000), salt: '', secretHash: '', hidden: true };
  window.localStorage.setItem('debaser.auth.mock.v1', JSON.stringify({ users: [user], sessionUserId: me.id, bannedIds: [] }));
  const version = (number, minutes) => ({
    id: `drive-song-${number}`,
    version: number,
    src: `${window.location.origin}/drive-audio/track-pause-m${number}.wav`,
    title: `DRIVE TONE ${number}`,
    credit: me.name,
    note: '',
    createdAt: at(minutes),
  });
  const profile = {
    userId: me.id,
    displayName: me.name,
    bio: '',
    tags: [],
    comments: [],
    updatedAt: at(1),
    privacySeen: true,
    song: { versions: [version(1, 300), version(2, 100)], currentVersionId: 'drive-song-2' },
  };
  window.localStorage.setItem('debaser.profile.mock.v1', JSON.stringify({ version: 1, profiles: { [me.id]: profile } }));
}

/** Keeps the bar's `new Audio()` in reach (the provider makes it outside the page's tree). */
const KEEP_AUDIO = `
  (() => {
    const Orig = window.Audio;
    window.__audios = [];
    window.Audio = function (...a) { const made = new Orig(...a); window.__audios.push(made); return made; };
    window.Audio.prototype = Orig.prototype;
  })();
`;

/** The bar's audio element carrying M1's tone (strict mode makes the element twice: the last one carrying the file is it). */
const tone = (page) =>
  page.evaluate(() => {
    const found = (window.__audios ?? []).filter((a) => a.src.includes('track-pause-m1')).pop();
    return found ? { paused: found.paused, time: found.currentTime } : null;
  });

async function main() {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error(`a local mock server only, not ${BASE}`);
  const TONE = toneWav();
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: !args.includes('--headed'),
    args: ['--no-first-run', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route('**/drive-audio/track-pause-m*.wav', (route) =>
      route.fulfill({ status: 200, body: TONE, headers: { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'none' } }),
    );
    // Cut off from the live database, whatever the server was started with.
    await context.route(/supabase\.co|api\.debaser\.site/, (route) => route.abort());
    await context.addInitScript(seed, { me: ME });
    await context.addInitScript(KEEP_AUDIO);
    const page = await context.newPage();
    page.on('pageerror', (error) => console.log(`  page error: ${String(error).slice(0, 200)}`));

    await page.goto(`${BASE}/profile/${ME.id}`, { waitUntil: 'domcontentloaded' });
    const history = page.getByRole('button', { name: 'history (2)' });
    await history.waitFor({ timeout: 120000 });
    await history.click();

    // M1's row (the older version, not the one on the page) and its play key.
    const row = page.locator('li').filter({ hasText: 'M1' }).filter({ has: page.getByRole('button', { name: 'read M1' }) });
    const key = row.locator('button').first();
    assert.equal((await key.textContent()).trim(), 'play', 'M1 starts with a "play" key');
    assert.match((await key.getAttribute('data-explain')) ?? '', /^Plays /, 'its hover words say it plays');
    await key.click();
    await page.waitForFunction(
      () => (window.__audios ?? []).some((a) => a.src.includes('track-pause-m1') && !a.paused && a.currentTime > 1.5),
      null,
      { timeout: 30000 },
    );
    assert.equal((await key.textContent()).trim(), 'pause', 'while M1 plays its key reads "pause"');
    pass('press "play" on M1 in the history: the tone plays and the key reads "pause"');

    const words = (await key.getAttribute('data-explain')) ?? '';
    const why = (await key.getAttribute('data-explain-why')) ?? '';

    /* The press this is about: "pause" pauses. */
    await key.click();
    await sleep(700);
    const paused = await tone(page);
    assert.ok(paused !== null && paused.paused, `pressing "pause" pauses the tone (still playing at ${paused?.time.toFixed(2)} s)`);
    assert.ok(paused.time > 1.5, `it stops where it is, not back at the start (${paused.time.toFixed(2)} s)`);
    assert.equal((await key.textContent()).trim(), 'play', 'paused, the key reads "play"');
    await sleep(1200);
    const held = await tone(page);
    assert.ok(held.paused && Math.abs(held.time - paused.time) < 0.05, `and it stays there (${paused.time.toFixed(2)} s -> ${held.time.toFixed(2)} s)`);
    pass(`press "pause": the tone stops at ${paused.time.toFixed(2)} s, stays there, and the key reads "play"`);

    /* And the next press carries on from the same place. */
    await key.click();
    await sleep(900);
    const resumed = await tone(page);
    assert.ok(resumed !== null && !resumed.paused, 'pressing "play" again plays it');
    assert.ok(
      resumed.time >= held.time && resumed.time < held.time + 2,
      `from the same place (paused at ${held.time.toFixed(2)} s, now ${resumed.time.toFixed(2)} s)`,
    );
    assert.equal((await key.textContent()).trim(), 'pause', 'and the key reads "pause" again');
    pass(`press "play" again: it carries on from the same place (${held.time.toFixed(2)} s -> ${resumed.time.toFixed(2)} s), key "pause"`);

    /* The hover words on the "pause" key say what it does. */
    assert.match(words, /^Pauses /, `the "pause" key's hover words say it pauses ("${words}")`);
    assert.match(why, /same place/, `and that a second press carries on ("${why}")`);
    pass(`the "pause" key's hover words: "${words}" / "${why}"`);

    console.log(`${passed} proofs passed`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`FAILED after ${passed} proofs: ${error.message}`);
  process.exit(1);
});
