/*
 * The sound graph behind the music bar (Luke, 2026-11-16): every word on the black display stays 4.5:1 in every theme
 * whatever the graph draws; the colours are the theme's own; the bars spread by pitch; which sound it listens to; the
 * tab is heard only as sound (the picture stopped at once); the YouTube relay hands out a slice at a time from YouTube's
 * own file servers only, and never to another site's page.
 * Run from the root:
 *   npx tsc app/lib/audio/sound-graph.ts app/lib/audio/room-screen-sound.ts app/lib/audio/tab-listen.ts app/lib/audio/youtube-relay.ts app/lib/ui/themes.ts app/api/audio/relay/[id]/route.ts --rootDir app --outDir Temp/sound-graph-out --module commonjs --target es2020 --lib es2021,dom --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
 *   node Temp/check-sound-graph.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const graph = require('./sound-graph-out/lib/audio/sound-graph.js');
const { THEMES } = require('./sound-graph-out/lib/ui/themes.js');
const relay = require('./sound-graph-out/lib/audio/youtube-relay.js');
const route = require('./sound-graph-out/api/audio/relay/[id]/route.js');

(async () => {
  /* 1. Every word on the display stays 4.5:1 over every colour, in every theme ------------------------------------ */
  assert.ok(THEMES.length >= 3, 'the themes were read');
  for (const theme of THEMES) {
    const read = (job) => theme.tokens[job] ?? '';
    const palette = graph.graphPalette(read);
    assert.ok(palette.length >= 3, `${theme.id}: at least three colours show (got ${palette.length})`);
    const base = graph.parseColour(read(graph.LED_BASE));
    const inks = graph.LED_INKS.map((job) => graph.parseColour(read(job)));
    for (const colour of palette) {
      assert.ok(colour.alpha >= graph.MIN_ALPHA && colour.alpha <= graph.MAX_ALPHA, `${theme.id}: ${colour.css} within its limits`);
      const worst = graph.worstContrast(colour.rgb, base, inks, colour.alpha);
      assert.ok(worst >= 4.5, `${theme.id}: ${colour.css} at ${colour.alpha} keeps every word 4.5:1 (measured ${worst.toFixed(2)})`);
      // Each colour is the theme's own value for one of the graph's jobs.
      assert.ok(graph.GRAPH_ROLES.some((job) => read(job).trim() === colour.css), `${theme.id}: ${colour.css} is a theme colour`);
      // And as bright as it may be: a little more would break the rule, unless it is already at the cap.
      if (colour.alpha < graph.MAX_ALPHA) assert.ok(graph.worstContrast(colour.rgb, base, inks, colour.alpha + 0.05) < 4.65, `${theme.id}: ${colour.css} is not needlessly faint`);
    }
  }
  // A display whose own words already fail draws nothing at all.
  const white = { r: 255, g: 255, b: 255 };
  assert.equal(graph.safeAlpha({ r: 255, g: 0, b: 0 }, { r: 250, g: 250, b: 250 }, [white]), 0, 'no colour over an unreadable display');
  // Contrast arithmetic: black on white is 21:1, white on Emerald under 4.5.
  assert.equal(graph.contrast({ r: 0, g: 0, b: 0 }, white).toFixed(1), '21.0');
  assert.ok(graph.contrast(white, graph.parseColour('#28c745')) < 4.5);
  assert.deepEqual(graph.parseColour('rgb(40, 199, 69)'), { r: 40, g: 199, b: 69 });
  assert.equal(graph.parseColour('var(--x)'), null);
  console.log(`  ok    every word stays 4.5:1 over the graph, in all ${THEMES.length} themes`);

  /* 2. The bars spread by pitch, each reading at least one bin -------------------------------------------------- */
  for (const [bars, bins] of [[1, 128], [40, 128], [96, 128], [130, 128]]) {
    const edges = graph.bandEdges(bars, bins);
    assert.equal(edges.length, bars);
    for (const [from, to] of edges) assert.ok(to > from && from >= 0 && to <= bins, `${bars} bars: [${from}, ${to}) is a real range`);
    for (let i = 1; i < edges.length; i += 1) assert.ok(edges[i][0] >= edges[i - 1][0], 'ranges move upward');
  }
  const forty = graph.bandEdges(40, 128);
  assert.ok(forty[0][1] - forty[0][0] < forty[39][1] - forty[39][0], 'the lows get narrow bands, the highs wide ones');
  assert.equal(graph.barCount(400), Math.floor((400 + graph.GAP) / (graph.BAR + graph.GAP)));
  assert.equal(graph.barCount(2000), 96, 'at most 96 bars, however wide');
  assert.equal(graph.bandLevel([0, 255, 10], 0, 3), 1);
  assert.equal(graph.settle(0.2, 0.9), 0.9, 'a bar jumps up at once');
  assert.ok(Math.abs(graph.settle(0.9, 0.2) - 0.84) < 1e-9, 'and settles slowly');
  assert.equal(graph.litSegments(1, 40), 10);
  assert.equal(graph.litSegments(0, 40), 0);
  console.log('  ok    the bars spread by pitch, a meter that jumps and settles');

  /* 3. The gentle motion is low, even and the same whatever plays ---------------------------------------------- */
  for (let i = 0; i < 60; i += 1) {
    const level = graph.gentleLevel(i, i * 0.37);
    assert.ok(level >= 0.08 && level <= 0.2, 'gentle stays low');
  }
  assert.equal(graph.gentleLevel.length, 2, 'it is given only a bar and the time, never the sound');
  console.log('  ok    the gentle motion is low and never pretends to be the sound');

  /* 4. Which sound it listens to --------------------------------------------------------------------------- */
  const base0 = { tab: false, barPlaying: false, barHeard: false, videoPlaying: false, relayable: false, relayFailed: false };
  assert.equal(graph.pickSource(base0), 'off', 'nothing plays: nothing drawn');
  assert.equal(graph.pickSource({ ...base0, tab: true }), 'off', 'the tab allowed but silent: nothing drawn');
  assert.equal(graph.pickSource({ ...base0, tab: true, videoPlaying: true, relayable: true }), 'tab', 'the tab first');
  assert.equal(graph.pickSource({ ...base0, barPlaying: true, barHeard: true }), 'bar');
  assert.equal(graph.pickSource({ ...base0, barPlaying: true }), 'gentle', 'a song it cannot copy (a podcast host): gentle');
  assert.equal(graph.pickSource({ ...base0, videoPlaying: true, relayable: true }), 'relay', 'YouTube without the tab: the relay');
  assert.equal(graph.pickSource({ ...base0, videoPlaying: true, relayable: true, relayFailed: true }), 'gentle', 'the relay refused: gentle');
  assert.equal(graph.pickSource({ ...base0, videoPlaying: true }), 'gentle', 'Vimeo or Twitch without the tab: gentle');
  // List 4 (Luke: "look into the colourful audio monitor not always appearing"): a video playing in your room's own
  // player counts as playing, and a file whose sound may be copied (an Internet Archive video) is heard itself.
  assert.equal(graph.pickSource({ ...base0, videoPlaying: true, videoHeard: true, relayable: false }), 'video', "the room's own file: heard");
  assert.equal(graph.pickSource({ ...base0, barPlaying: true, barHeard: true, videoPlaying: true, videoHeard: true }), 'bar', 'the bar still first');
  assert.equal(graph.pickSource({ ...base0, tab: true, videoPlaying: true, videoHeard: true }), 'tab', 'the tab still first');

  /* 4b. Your room's screen tells the graph what it plays (it plays MEDIA's videos since list 3) -------------------- */
  const screen = require('./sound-graph-out/lib/audio/room-screen-sound.js');
  class FakePlayer extends EventTarget {
    constructor() {
      super();
      this.paused = true;
      this.ended = false;
      this.currentTime = 0;
    }
    play() {
      this.paused = false;
      this.dispatchEvent(new Event('play'));
    }
    pause() {
      this.paused = true;
      this.dispatchEvent(new Event('pause'));
    }
  }
  const told = [];
  const off = screen.subscribeToRoomScreenSound(() => told.push(screen.roomScreenSound()));
  assert.equal(screen.roomScreenSound(), null, 'no room open: nothing');
  const stage = new FakePlayer();
  const unshare = screen.shareRoomScreen(stage, { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', kind: 'youtube', title: 'x' });
  assert.deepEqual({ ...screen.roomScreenSound(), element: undefined }, { element: undefined, playing: false, youtubeId: 'dQw4w9WgXcQ' }, 'shared, paused, with its YouTube id');
  stage.play();
  assert.equal(screen.roomScreenSound().playing, true, 'it plays: the graph is told');
  stage.pause();
  assert.equal(screen.roomScreenSound().playing, false, 'paused: told');
  assert.equal(screen.shareRoomScreen(new FakePlayer(), { url: 'https://archive.org/download/x/x.mp4', kind: 'file', title: 'x' })(), undefined);
  assert.equal(screen.roomScreenSound(), null, 'another player taken back leaves nothing behind');
  const again = screen.shareRoomScreen(stage, { url: 'https://vimeo.com/1', kind: 'vimeo', title: 'x' });
  assert.equal(screen.roomScreenSound().youtubeId, null, 'not YouTube: no relay');
  again();
  unshare();
  assert.equal(screen.roomScreenSound(), null, 'the room closed: nothing');
  assert.ok(told.length >= 4, 'every change reached the graph');
  off();
  const room = fs.readFileSync(path.join(__dirname, '..', 'app', 'components', 'WatchRoom.tsx'), 'utf8');
  assert.match(room, /shareRoomScreen\(videoElement, link\)/, "the room's stage shares its player");
  // While your room is open the bottom bar is the room's strip, whose black display had no graph at all.
  const strip = room.slice(room.indexOf('data-stream-bar-screen'), room.indexOf('data-watch-bar="music"'));
  assert.match(strip, /<SoundGraph \/>/, "the room strip's black display carries the graph too");
  assert.match(room, /dynamic\(\(\) => import\('\.\/SoundGraph'\), \{ ssr: false \}\)/, "loaded on its own, so the room's code keeps clear of the floating player's");
  const graphComponent = fs.readFileSync(path.join(__dirname, '..', 'app', 'components', 'SoundGraph.tsx'), 'utf8');
  assert.match(graphComponent, /useSyncExternalStore\(subscribeToRoomScreenSound, roomScreenSound/, 'and the graph listens to it');
  console.log("  ok    a video in your room's own player moves the graph");
  assert.equal(graph.youtubeIdFromPlayer('https://www.youtube-nocookie.com/embed/jNQXAC9IVRw?autoplay=1&enablejsapi=1'), 'jNQXAC9IVRw');
  assert.equal(graph.youtubeIdFromPlayer('https://player.vimeo.com/video/76979871'), null);
  assert.equal(graph.youtubeIdFromPlayer('https://evil.example/embed/jNQXAC9IVRw'), null);
  assert.equal(graph.relayPath('jNQXAC9IVRw'), '/api/audio/relay/jNQXAC9IVRw');
  console.log('  ok    it listens to the tab, then the bar, then the relay, then moves gently');

  /* 5. The tab: sound only, the picture stopped at once, a share without sound let go --------------------------- */
  function fakeTrack(kind) {
    const listeners = {};
    return { kind, id: `${kind}-1`, stopped: false, stop() { this.stopped = true; }, addEventListener(name, fn) { listeners[name] = fn; }, fire(name) { listeners[name]?.(); } };
  }
  global.MediaStream = class { constructor(tracks) { this.tracks = tracks; } getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio'); } getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video'); } };
  const asked = [];
  let answer = null;
  Object.defineProperty(global, 'navigator', { configurable: true, value: { userAgentData: {}, mediaDevices: { getDisplayMedia: async (options) => { asked.push(options); if (answer instanceof Error) throw answer; return answer; } } } });
  const tabPath = require.resolve('./sound-graph-out/lib/audio/tab-listen.js');
  delete require.cache[tabPath];
  const tab = require(tabPath);
  assert.equal(tab.tabListenState(), 'unasked', 'Chrome or Edge: the key is offered');
  const video = fakeTrack('video');
  const audio = fakeTrack('audio');
  answer = new MediaStream([video, audio]);
  await tab.askToHearTab();
  assert.equal(asked.length, 1);
  assert.equal(asked[0].preferCurrentTab, true, 'this tab is offered first');
  assert.ok(asked[0].audio, 'its sound is asked for');
  assert.equal(video.stopped, true, 'the picture is stopped at once');
  assert.equal(tab.tabListenState(), 'allowed');
  assert.deepEqual(tab.tabSound().getAudioTracks(), [audio], 'only the sound is kept');
  assert.equal(tab.tabSound().getVideoTracks().length, 0);
  audio.fire('ended');
  assert.equal(tab.tabListenState(), 'unasked', "the browser's STOP: the key comes back");
  const video2 = fakeTrack('video');
  answer = new MediaStream([video2]);
  await tab.askToHearTab();
  assert.equal(video2.stopped, true);
  assert.equal(tab.tabListenState(), 'refused', 'shared without sound: let go, the key stays');
  answer = new Error('NotAllowedError');
  await tab.askToHearTab();
  assert.equal(tab.tabListenState(), 'refused', 'the reader said no');
  // Firefox and Safari share no tab sound: no key.
  Object.defineProperty(global, 'navigator', { configurable: true, value: { mediaDevices: { getDisplayMedia: async () => answer } } });
  delete require.cache[tabPath];
  assert.equal(require(tabPath).tabListenState(), 'unsupported');
  console.log('  ok    the tab: asked on a press, sound only, the picture stopped at once');

  /* 6. The relay: YouTube's own file servers only, a slice at a time, this site's pages only --------------------- */
  const FILE = 'https://rr1---sn-8pgbpohxqp5-aigk.googlevideo.com/videoplayback?expire=1&itag=139';
  const answerWith = (formats) => ({ streamingData: { adaptiveFormats: formats } });
  const picked = relay.pickAudioFile(
    answerWith([
      { itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 10000, contentLength: '500', url: FILE.replace('139', '251') },
      { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130000, contentLength: '3000', url: FILE.replace('139', '140') },
      { itag: 139, mimeType: 'audio/mp4; codecs="mp4a.40.5"', bitrate: 49000, contentLength: '1170', url: FILE },
      { itag: 18, mimeType: 'video/mp4', bitrate: 1, contentLength: '9', url: FILE.replace('139', '18') },
      { itag: 139, mimeType: 'audio/mp4', bitrate: 1, contentLength: '9', url: 'https://evil.example/videoplayback' },
      { itag: 139, mimeType: 'audio/mp4', bitrate: 1, contentLength: '9', signatureCipher: 's=x&url=y' },
    ]),
    'UA',
  );
  assert.equal(picked.url, FILE, 'the smallest MP4 sound on a YouTube file server');
  assert.equal(picked.length, 1170);
  assert.equal(picked.type, 'audio/mp4');
  assert.equal(relay.pickAudioFile(answerWith([{ mimeType: 'audio/mp4', bitrate: 1, contentLength: '9', url: 'https://googlevideo.com.evil.example/x' }]), 'UA'), null, 'no look-alike hosts');
  assert.equal(relay.pickAudioFile({ playabilityStatus: { status: 'LOGIN_REQUIRED' } }, 'UA'), null, '"sign in to confirm": nothing');
  assert.deepEqual(relay.sliceFor('bytes=0-', 5_000_000), { start: 0, end: relay.SLICE_BYTES - 1 }, 'an open-ended ask gets one slice');
  assert.deepEqual(relay.sliceFor('bytes=100-199', 5_000_000), { start: 100, end: 199 });
  assert.deepEqual(relay.sliceFor(null, 1000), { start: 0, end: 999 });
  assert.equal(relay.sliceFor('bytes=1000-', 1000), null, 'past the end');

  const calls = [];
  const fakeFetch = (mode) => async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/youtubei/v1/player')) {
      if (mode === 'refused') return new Response(JSON.stringify({ playabilityStatus: { status: 'LOGIN_REQUIRED' } }), { status: 200 });
      return new Response(JSON.stringify(answerWith([{ mimeType: 'audio/mp4', bitrate: 49000, contentLength: '3000000', url: FILE }])), { status: 200 });
    }
    assert.ok(new URL(url).hostname.endsWith('.googlevideo.com'), 'the slice is read from YouTube');
    const range = init.headers.Range;
    const [, a, b] = range.match(/bytes=(\d+)-(\d+)/);
    return new Response(new Uint8Array(Number(b) - Number(a) + 1), { status: 206, headers: { 'content-length': String(Number(b) - Number(a) + 1) } });
  };
  const sliced = await relay.relaySlice('jNQXAC9IVRw', 'bytes=0-', fakeFetch('ok'));
  assert.equal(sliced.status, 206);
  assert.equal(sliced.headers.get('content-range'), `bytes 0-${relay.SLICE_BYTES - 1}/3000000`);
  assert.equal(sliced.headers.get('content-type'), 'audio/mp4');
  assert.match(sliced.headers.get('cache-control'), /no-store/);
  assert.equal((await sliced.arrayBuffer()).byteLength, relay.SLICE_BYTES, 'one slice, no more');
  const asks = calls.filter((c) => c.url.includes('/youtubei/v1/player'));
  assert.equal(asks.length, 1);
  assert.equal(JSON.parse(asks[0].init.body).videoId, 'jNQXAC9IVRw', 'only the video id is sent');
  const refusedNew = await relay.relaySlice('aaaaaaaaaaa', 'bytes=0-', fakeFetch('refused'));
  assert.equal(refusedNew.status, 502, 'YouTube refused: 502, and the graph moves gently');
  assert.equal((await relay.relaySlice('../../etc/p', null, fakeFetch('ok'))).status, 404, 'a malformed id is never asked about');
  // A file server handing the slice on: to another YouTube file server, followed; anywhere else, refused.
  const hop = (to) => async (url, init) => {
    if (url.includes('/youtubei/v1/player')) return new Response(JSON.stringify(answerWith([{ mimeType: 'audio/mp4', bitrate: 1, contentLength: '3000000', url: FILE }])), { status: 200 });
    if (url === FILE) return new Response(null, { status: 302, headers: { location: to } });
    assert.ok(new URL(url).hostname.endsWith('.googlevideo.com'), `never fetched: ${url}`);
    return new Response(new Uint8Array(10), { status: 206, headers: { 'content-length': '10' } });
  };
  assert.equal((await relay.relaySlice('bbbbbbbbbbb', 'bytes=0-9', hop('https://rr7---sn-abcd1234.googlevideo.com/videoplayback?x=1'))).status, 206, 'handed to another YouTube file server: followed');
  assert.equal((await relay.relaySlice('ccccccccccc', 'bytes=0-9', hop('https://evil.example/videoplayback'))).status, 502, 'handed anywhere else: refused');
  // The route: another site's page asking through a visitor's browser is refused before anything is fetched.
  const crossSite = await route.GET(new Request('http://localhost/api/audio/relay/jNQXAC9IVRw', { headers: { 'sec-fetch-site': 'cross-site' } }), { params: Promise.resolve({ id: 'jNQXAC9IVRw' }) });
  assert.equal(crossSite.status, 403, 'another site cannot use the relay');
  const badId = await route.GET(new Request('http://localhost/api/audio/relay/x', { headers: { 'sec-fetch-site': 'same-origin' } }), { params: Promise.resolve({ id: 'not an id' }) });
  assert.equal(badId.status, 404);
  console.log('  ok    the relay: YouTube file servers only, a slice at a time, this site only');

  /* 7. The drawing never sends sound to the speakers ---------------------------------------------------------- */
  const component = fs.readFileSync(path.join(__dirname, '..', 'app', 'components', 'SoundGraph.tsx'), 'utf8');
  assert.ok(!/\.destination\b/.test(component), 'nothing in the graph is connected to the speakers');
  assert.match(component, /node\?\.connect\(kept\.analyser\)/, 'what it hears goes to the analyser');
  assert.match(component, /if \(!active\)/, 'it stops when nothing plays, the tab is hidden or motion is reduced');
  assert.match(component, /prefers-reduced-motion: reduce/);
  assert.match(component, /document\.hidden/);
  const unmount = component.slice(component.indexOf('// The bar folded away'), component.indexOf('// Keeping the relay in step'));
  assert.match(unmount, /relay\.removeAttribute\('src'\)/, 'folding the bar stops the relay fetching');
  assert.match(unmount, /context\.close\(\)/, 'and closes the audio context');
  console.log('  ok    the graph only measures: nothing reaches the speakers');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
