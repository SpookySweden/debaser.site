/*
 * LIVE (SPEC-live-streams.md), driven on a LOCAL mock dev server (node scripts/dev-mock-live.cjs 3317):
 *   node scripts/drive-live.cjs [--base http://localhost:3317]
 *
 * A visitor's browser, one live room seeded in the mock store, then (Twitch and YouTube are the real ones, through our server):
 * - /media with LIVE on and no words: the key pressed, LIVE ROOMS first (the seeded room, ● LIVE, JOIN), then Twitch rows,
 *   each ● LIVE where a date goes; no count anywhere;
 * - a search with LIVE on: Twitch and YouTube lives only; an ALL search without it: the room first, lives mixed in;
 * - + QUEUE on a Twitch row as a visitor: no "PLAYS IN A LIVE ROOM ONLY";
 * - PLAY on a Twitch row: your room opens with Twitch's own player, told this site (parent=localhost);
 * - the default feed: a LIVE place in the first block;
 * - screenshots at 1440 (dark), no sideways scroll at 390.
 * Any request to Supabase fails the run: this must be the mock site.
 */
const path = require('node:path');
const { open, close } = require('./browser.cjs');

const argv = process.argv.slice(2);
const BASE = (argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : 'http://localhost:3317').replace(/\/$/, '');
const OUT = path.join(__dirname, '..', 'Temp', 'browse');
let failures = 0;
const ok = (condition, message, detail = '') => {
  if (!condition) failures += 1;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${message}${detail ? ` :: ${detail}` : ''}`);
};
const COUNT_TEXT = /\b\d[\d,.]*\s*[KM]?\s*(VIEWERS|WATCHING|FOLLOWERS)\b/i;

/** One live stream room in the mock store, beating now, playing a YouTube video titled for the searches below. */
function seedRoom(now) {
  const at = new Date(now).toISOString();
  const room = {
    id: 'room-live-mia', originalHostId: 'mock-mia', originalHostLabel: 'MIA', hostId: 'mock-mia', forumThreadId: null,
    currentEntryId: 'entry-live-1', positionSeconds: 10, isPlaying: true, startedAt: at, updatedAt: at, endedAt: null,
    origin: 'stream', isPublic: true, privacy: 'open', clearedAt: null, name: null, topic: null, addMode: 'anyone', guestsCanTalk: true,
  };
  const entry = {
    id: 'entry-live-1', roomId: room.id, position: 0, inQueue: true, mediaItemId: null,
    link: { url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', kind: 'youtube', title: 'LOFI CHESS NIGHT' },
    series: null, addedBy: 'mock-mia', addedAt: at, playedAt: at, playIndex: 0,
  };
  return { rooms: [room], queue: [entry], messages: [], crowns: [], members: [], passwords: {}, attempts: [], privateRows: [] };
}

(async () => {
  const session = await open({ size: [1440, 1000], profile: path.join(OUT, 'live-profile') });
  const { page } = session;
  let supabase = 0;
  await page.route(/supabase\.(co|in)\//, (route) => {
    supabase += 1;
    return route.abort();
  });
  const seed = async () => {
    await page.evaluate((tables) => {
      window.localStorage.setItem('debaser.watch.v1', JSON.stringify(tables));
      window.localStorage.setItem('debaser.theme', 'dark');
    }, seedRoom(Date.now()));
  };
  try {
    await page.goto(`${BASE}/forum`, { waitUntil: 'domcontentloaded', timeout: 240_000 });
    const never = page.getByRole('button', { name: /I NEVER HAD ONE/ });
    if (await never.isVisible().catch(() => false)) await never.click();

    /* ------------------------------------------------ LIVE on, no words */
    await seed();
    await page.goto(`${BASE}/media?live=1`, { waitUntil: 'domcontentloaded', timeout: 240_000 });
    await page.waitForSelector('li[data-view] [data-live-mark]', { timeout: 60_000 }).catch(() => null);
    ok((await page.locator('[data-live-key]').getAttribute('aria-pressed')) === 'true', 'the LIVE key is pressed under ?live=1');
    const rooms = page.locator('[data-live-rooms]');
    ok((await rooms.count()) === 1, 'LIVE ROOMS shows');
    const roomText = (await rooms.innerText().catch(() => '')).replace(/\s+/g, ' ');
    ok(/MIA'S ROOM/.test(roomText) && /LOFI CHESS NIGHT/.test(roomText) && /● LIVE/.test(roomText) && /JOIN/.test(roomText), 'the room row: what is on, MIA\'S ROOM, ● LIVE, JOIN', roomText.slice(0, 160));
    const firstRow = page.locator('li[data-view]').first();
    const roomBox = await rooms.boundingBox();
    const rowBox = await firstRow.boundingBox();
    ok(roomBox !== null && rowBox !== null && roomBox.y < rowBox.y, 'the rooms come first, above the lives');
    const liveRows = page.locator('li[data-view]:has([data-live-mark])');
    const liveCount = await liveRows.count();
    const allRows = await page.locator('li[data-view]').count();
    ok(liveCount >= 3, 'Twitch rows, each marked ● LIVE', `${liveCount} of ${allRows}`);
    ok(liveCount === allRows, 'every row under the key is live');
    const rowsText = await page.locator('main').innerText();
    ok(/TWITCH/.test(rowsText), 'TWITCH named as the source');
    ok(!COUNT_TEXT.test(rowsText.replace(/\n/g, ' ')), 'no viewer or follower count on the page');
    const thumbs = await liveRows.locator('img').evaluateAll((imgs) => imgs.map((img) => img.getAttribute('src') ?? ''));
    const twitchThumbs = thumbs.filter((src) => src.includes('jtvnw'));
    ok(
      twitchThumbs.length >= 3 && twitchThumbs.every((src) => /^https:\/\/static-cdn\.jtvnw\.net\/previews-ttv\/live_user_[a-z0-9_]+-640x360\.jpg$/.test(src)),
      'Twitch\'s preview pictures, hotlinked',
      `${twitchThumbs.length} of ${thumbs.length}; others: ${thumbs.filter((src) => !src.includes('jtvnw')).slice(0, 2).join(' ')}`,
    );
    await page.screenshot({ path: path.join(OUT, 'live-key-dark.png') });

    /* ------------------------------------------------ + QUEUE as a visitor */
    const queueKey = liveRows.first().getByRole('button', { name: /^Add .* queue/ }).first();
    if (await queueKey.count()) {
      await queueKey.click();
      await page.waitForTimeout(1500);
      const after = await page.locator('main').innerText();
      ok(!/PLAYS IN A LIVE ROOM ONLY/.test(after), '+ QUEUE on a Twitch row as a visitor is not refused');
    } else ok(false, 'a + QUEUE key on a Twitch row');

    /* ------------------------------------------------ PLAY on a Twitch row */
    const play = liveRows.nth(1).getByRole('button', { name: /^Play / }).first();
    await play.click();
    const frame = page.locator('iframe[src*="player.twitch.tv"]');
    await frame.first().waitFor({ timeout: 30_000 }).catch(() => null);
    const src = await frame.first().getAttribute('src').catch(() => null);
    ok(src !== null && /parent=localhost/.test(src) && /channel=[a-z0-9_]+/.test(src), 'PLAY opens Twitch\'s own player, told this site (parent=localhost)', src ?? 'no Twitch frame');
    console.log(`info page errors before PLAY: ${session.log.errors.length}`);
    ok((await page.locator('[data-watch-embed="twitch"]').count()) > 0, '... in your room\'s stage (the room\'s Twitch player)');
    // Headless Edge may not let Twitch start by itself: press Twitch's own play, in its frame, as a viewer would.
    await page.waitForTimeout(6_000);
    const twitchFrame = page.frameLocator('iframe[src*="player.twitch.tv"]').first();
    await twitchFrame.locator('button[data-a-target="player-play-pause-button"]').click({ timeout: 10_000 }).catch(() => console.log('info no Twitch play key to press'));
    await page.waitForTimeout(15_000);
    const clock = await page.locator('[data-watch-clock]').first().innerText().catch(() => '');
    ok(/LIVE/.test(clock), 'once Twitch plays, the room says LIVE where the time goes (no seek bar)', clock);
    await page.screenshot({ path: path.join(OUT, 'live-room-dark.png') });

    /* ------------------------------------------------ a search with LIVE on */
    await seed();
    await page.goto(`${BASE}/media?q=lofi&live=1`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForFunction(() => /EVERY SOURCE HAS ANSWERED/.test(document.body.innerText), null, { timeout: 60_000 }).catch(() => null);
    const searched = page.locator('li[data-view]');
    const sources = await searched.evaluateAll((rows) => rows.map((row) => row.innerText.replace(/\s+/g, ' ')));
    ok(sources.length > 0 && sources.every((text) => /● LIVE/.test(text)), 'a search under LIVE: only lives', `${sources.length} rows`);
    ok(sources.some((text) => /YOUTUBE/.test(text)), 'YouTube lives among them');
    ok(/LOFI CHESS NIGHT/.test(await page.locator('[data-live-rooms]').innerText().catch(() => '')), 'the room matching the words comes first');

    /* ------------------------------------------------ an ALL search without LIVE */
    await seed();
    await page.goto(`${BASE}/media?q=chess`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForFunction(() => /EVERY SOURCE HAS ANSWERED/.test(document.body.innerText), null, { timeout: 90_000 }).catch(() => null);
    const mixed = await page.locator('li[data-view]').evaluateAll((rows) => rows.map((row) => /● LIVE/.test(row.innerText)));
    ok(mixed.includes(true) && mixed.includes(false), 'an ALL search mixes lives in with everything else', `${mixed.filter(Boolean).length} live of ${mixed.length}`);
    ok((await page.locator('[data-live-rooms]').count()) === 1, 'the matching room comes first there too');
    await page.screenshot({ path: path.join(OUT, 'live-all-search-dark.png') });

    /* ------------------------------------------------ the default feed */
    await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForSelector('[data-feed-lane="live"]', { timeout: 45_000 }).catch(() => null);
    const lanes = await page.locator('[data-feed-lane]').evaluateAll((rows) => rows.slice(0, 36).map((row) => row.getAttribute('data-feed-lane')));
    ok(lanes.includes('live'), 'the default feed has LIVE places (from the first block drawn after the lives answered)', lanes.join(','));

    /* ------------------------------------------------ phone width */
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`${BASE}/media?live=1`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForTimeout(4000);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(sideways <= 1, 'no sideways scroll at 390', String(sideways));

    ok(supabase === 0, 'nothing was asked of Supabase (the mock site)', String(supabase));
    console.log(`page errors: ${session.log.errors.length}${session.log.errors.length ? ` :: ${session.log.errors.slice(0, 3).join(' | ')}` : ''}`);
  } catch (error) {
    ok(false, 'the drive ran to its end', error && error.message);
  } finally {
    await close(session);
  }
  console.log(failures === 0 ? 'DRIVE PASSED' : `DRIVE FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
})();
