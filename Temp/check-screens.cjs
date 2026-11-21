/*
 * SCREENS in the site (SPEC-screens.md, phase 3, first slice): the owner's PC screen in his own room. Offline: the
 * only server it talks to is a pretend engine it starts itself on 127.0.0.1.
 *   npx tsc app/api/screens/host/route.ts app/api/screens/offer/route.ts app/api/screens/settings/route.ts app/api/screens/devices/route.ts app/api/screens/mail/route.ts app/lib/screens/device-mail.ts app/components/RoomDeviceScreen.tsx app/components/DeviceShareGate.tsx app/lib/screens/wishes.ts app/lib/screens/wire.ts app/lib/screens/key-gate.ts app/components/ScreenKeyGate.tsx app/lib/watch/canvas.ts node_modules/next/types/global.d.ts --outDir Temp/out-screens --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node --jsx react-jsx
 *   node Temp/check-screens.cjs
 *
 * - WHERE THE ENGINE IS: `SCREENS_ENGINE_URL` is taken only when it is a plain http address on this PC itself; anything
 *   else is refused outright, and the owner then gets "not available" without anything being asked anywhere.
 * - WHO IS ASKING: only the account in `SCREENS_OWNER_ID`, known from a session token the auth server vouches for.
 *   Signed out, another account, a guest, a forged token, another site's page, no owner set: all get exactly the same
 *   "not available" from /host and the same refusal from /offer and /settings, byte for byte, engine or no engine,
 *   and the engine is never asked on their behalf (so nobody else can tell that one exists).
 * - THE LOCAL-PROOF EXCEPTION (`SCREENS_DEV_OPEN=1` with the mock accounts) is impossible when NODE_ENV is production,
 *   asked of the rule and of the real routes, with a pretend engine counting what reaches it.
 * - THE OWNER'S WAY THROUGH: the hello is passed on as it came and its answer and viewer number come back; the
 *   settings are read and changed with the viewer's number; too large, the wrong kind, and too many at once are refused.
 * - THE SETTINGS MODEL'S SUMS, ported from the engine's own page: what is remembered is made safe, MATCH goes with this
 *   screen's size and AUTO with its measured rate, the rate is found from the gaps between refreshes, the words say
 *   what the PC is really sending.
 * - CONTROL'S MESSAGES byte for byte as engine/src/control.rs writes them down, and where a pointer on the page is on
 *   the picture.
 * - SOUND, THE CONTROLLER AND THE PC'S POINTER (added with the engine's): the two new messages to the PC, the
 *   controller's whole state packed with the right button bits and stick signs, a pointer shape read in each of its
 *   three ways and scaled to the picture, sound offered only away from the PC itself, and the words for each.
 * - THE KEYBOARD'S FIRST LISTENER: one listener, there from the start, that does nothing until CONTROL takes it.
 * - THE DRIVE'S MARK (`drive: true`) is only ever said by a server opened for the local drive, never a production one.
 * - THE ROOM: the screen is a choice that stays whatever the room goes on to play.
 * - THE WALL: no browser file imports the server's file, and the two settings are named nowhere else.
 * The picture, the panel and CONTROL in a real room: scripts/drive-screens.cjs.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

// Failing until the last line says otherwise: an early exit is a failure, never a silent pass.
process.exitCode = 1;
let passed = 0;
const ok = (condition, message) => {
  assert.ok(condition, message);
  passed += 1;
};
const same = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  passed += 1;
};

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out-screens');
const server = require(path.join(OUT, 'lib/screens/host-server.js'));
const wishes = require(path.join(OUT, 'lib/screens/wishes.js'));
const wire = require(path.join(OUT, 'lib/screens/wire.js'));
const gate = require(path.join(OUT, 'lib/screens/key-gate.js'));
const canvas = require(path.join(OUT, 'lib/watch/canvas.js'));
const hostRoute = require(path.join(OUT, 'api/screens/host/route.js'));
const offerRoute = require(path.join(OUT, 'api/screens/offer/route.js'));
const settingsRoute = require(path.join(OUT, 'api/screens/settings/route.js'));

const OWNER = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-2222-4333-8444-555555555555';
/** A session token as Supabase shapes one: three parts, the account in the middle one. Signed by nobody. */
const tokenFor = (subject) => `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: subject })).toString('base64url')}.unsigned`;
const SUPABASE = { NODE_ENV: 'production', NEXT_PUBLIC_AUTH_BACKEND: 'supabase', NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-test-key' };
const ENGINE_SAYS = { asked: { shape: '16:9', viewWidth: null, viewHeight: null, lines: 1080, fps: 60, viewHz: null, bitrateKbps: 20000 }, sending: null, measured: null, screen: { width: 3440, height: 1440, hz: 180 }, limits: { maxLines: 1440, maxFps: 180, maxBitrateKbps: 50000 }, hostLimits: { maxLines: 1440, maxFps: 180, maxBitrateKbps: 50000 }, cap: null, capWhy: null, applied: true, refused: null, viewers: 0, control: 'free', controlWhy: null, controlDryRun: true };

/** What a route is handed: the settings, an auth server that vouches only for what `accounts` lists, and a pretend engine. */
function world(env, { accounts = {}, engine = null } = {}) {
  const seen = { tokens: [], engine: [] };
  return {
    seen,
    deps: {
      env,
      accountOf: async (token) => {
        seen.tokens.push(token);
        return accounts[token] ?? null;
      },
      fetch: async (input, init = {}) => {
        seen.engine.push({ url: input, method: init.method ?? 'GET', body: init.body ?? null, type: init.headers ? init.headers['Content-Type'] : null, redirect: init.redirect });
        if (engine === null) throw new Error('nothing answers');
        return engine(input, init);
      },
      now: () => world.now,
    },
  };
}
world.now = 1_000_000;

const ask = (pathAndQuery, { token, method = 'GET', type, body, site } = {}) =>
  new Request(`https://debaser.site${pathAndQuery}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(type ? { 'Content-Type': type } : {}), ...(site ? { 'Sec-Fetch-Site': site } : {}) },
    ...(body === undefined ? {} : { body }),
  });
const read = async (response) => ({ status: response.status, type: response.headers.get('content-type'), kept: response.headers.get('cache-control'), viewer: response.headers.get('debaser-viewer'), text: await response.text() });

async function main() {
  /* ---------------------------------------------------------------- where the engine is */
  for (const [address, origin] of [
    [undefined, 'http://127.0.0.1:8478'],
    ['', 'http://127.0.0.1:8478'],
    ['http://127.0.0.1:8478', 'http://127.0.0.1:8478'],
    ['http://127.0.0.1:9001/', 'http://127.0.0.1:9001'],
    ['http://127.8.9.10:8478', 'http://127.8.9.10:8478'],
    ['http://localhost:8478', 'http://localhost:8478'],
    ['http://[::1]:8478', 'http://[::1]:8478'],
  ]) {
    same(server.engineOrigin({ SCREENS_ENGINE_URL: address }), origin, `an address on this PC is taken: ${address}`);
  }
  for (const address of [
    'http://192.168.1.20:8478',
    'http://10.0.0.5:8478',
    'http://debaser.site:8478',
    'http://127.0.0.1.evil.example:8478',
    'http://localhost.evil.example:8478',
    'http://evil.example/127.0.0.1',
    'http://127.0.0.1@evil.example:8478',
    'http://evil.example#127.0.0.1',
    'http://0.0.0.0:8478',
    'http://127.0.0.1:8478/offer',
    'http://127.0.0.1:8478/?to=elsewhere',
    'http://user:pass@127.0.0.1:8478',
    'https://127.0.0.1:8478',
    'ftp://127.0.0.1:8478',
    'file:///C:/Windows',
    '127.0.0.1:8478',
    'not an address',
    'http://[::2]:8478',
    'http://[fe80::1]:8478',
  ]) {
    same(server.engineOrigin({ SCREENS_ENGINE_URL: address }), null, `anything that is not a plain http address on this PC is refused: ${address}`);
  }
  // A number that IS this PC, written another way, is this PC; one that is not, is not.
  same(server.engineOrigin({ SCREENS_ENGINE_URL: 'http://2130706433:8478' }), 'http://127.0.0.1:8478', '2130706433 is 127.0.0.1 written as one number');
  same(server.engineOrigin({ SCREENS_ENGINE_URL: 'http://3232235777:8478' }), null, '3232235777 is 192.168.1.1 written as one number: refused');

  /* ---------------------------------------------------------------- the local-proof exception */
  const MOCK_OPEN = { NODE_ENV: 'development', NEXT_PUBLIC_AUTH_BACKEND: 'mock', SCREENS_DEV_OPEN: '1' };
  process.env.NODE_ENV = 'development';
  same(server.devOpen(MOCK_OPEN), true, 'a dev server on the mock accounts, started with SCREENS_DEV_OPEN=1: open');
  same(server.devOpen({ ...MOCK_OPEN, SCREENS_DEV_OPEN: undefined }), false, 'without the switch: closed');
  same(server.devOpen({ ...MOCK_OPEN, SCREENS_DEV_OPEN: 'true' }), false, 'the switch is the figure 1 and nothing else');
  same(server.devOpen({ ...MOCK_OPEN, NODE_ENV: 'production' }), false, 'a server that says it is production: closed, switch or no switch');
  same(server.devOpen({ ...SUPABASE, NODE_ENV: 'development', SCREENS_DEV_OPEN: '1' }), false, 'with real accounts behind the site the switch does nothing');
  process.env.NODE_ENV = 'production';
  same(server.devOpen(MOCK_OPEN), false, 'in a production program (NODE_ENV production where the code runs): closed, whatever the settings say');
  same(server.devOpen({ ...MOCK_OPEN, NODE_ENV: undefined }), false, 'and with the setting missing: still closed');
  process.env.NODE_ENV = 'development';

  /* ---------------------------------------------------------------- who is asking */
  const liveOwner = tokenFor(OWNER);
  const liveOther = tokenFor(OTHER);
  const forged = `${tokenFor(OWNER)}x`;
  const opaqueOwner = 'an-opaque-token-of-the-owner';
  const guest = tokenFor('guest-account');
  const accounts = { [liveOwner]: OWNER, [liveOther]: OTHER, [opaqueOwner]: OWNER };
  const live = { ...SUPABASE, SCREENS_OWNER_ID: OWNER };
  {
    const w = world(live, { accounts });
    same(await server.ownerIsAsking(ask('/api/screens/host', { token: liveOwner }), w.deps), true, 'the owner, with a session the auth server vouches for');
    same(await server.ownerIsAsking(ask('/api/screens/host', { token: opaqueOwner }), w.deps), true, 'a token that cannot be read here is still asked of the auth server');
    same(w.seen.tokens, [liveOwner, opaqueOwner], 'both were asked of the auth server');
  }
  {
    const w = world(live, { accounts });
    same(await server.ownerIsAsking(ask('/api/screens/host'), w.deps), false, 'signed out');
    same(await server.ownerIsAsking(ask('/api/screens/host', { token: ' ' }), w.deps), false, 'a blank token');
    same(await server.ownerIsAsking(ask('/api/screens/host', { token: liveOther }), w.deps), false, 'another account');
    same(await server.ownerIsAsking(ask('/api/screens/host', { token: guest }), w.deps), false, 'a stream-room guest');
    same(await server.ownerIsAsking(ask('/api/screens/host', { token: 'x'.repeat(5000) }), w.deps), false, 'an absurdly long token');
    same(w.seen.tokens, [], 'none of those cost the auth server a question: a token that says it is somebody else is refused at once');
    same(await server.ownerIsAsking(ask('/api/screens/host', { token: forged }), w.deps), false, 'a token that SAYS it is the owner but that the auth server does not vouch for');
    same(w.seen.tokens, [forged], 'a yes always waits for the auth server');
    same(await server.ownerIsAsking(ask(`/api/screens/host?user=${OWNER}&userId=${OWNER}`, { token: liveOther }), w.deps), false, 'an id in the request counts for nothing');
    same(await server.ownerIsAsking(ask('/api/screens/host', { token: liveOwner, site: 'cross-site' }), w.deps), false, "another site's page asking through the owner's browser");
    same(await server.ownerIsAsking(ask('/api/screens/host', { token: liveOwner, site: 'same-origin' }), w.deps), true, "the site's own page");
  }
  for (const unset of [undefined, '', '   ', 'short']) {
    const w = world({ ...SUPABASE, SCREENS_OWNER_ID: unset }, { accounts: { ...accounts, [tokenFor('short')]: 'short', [tokenFor('')]: '' } });
    same(await server.ownerIsAsking(ask('/api/screens/host', { token: liveOwner }), w.deps), false, `no owner set (${JSON.stringify(unset)}): off for everyone`);
    same(await server.ownerIsAsking(ask('/api/screens/host', { token: tokenFor(String(unset ?? '').trim()) }), w.deps), false, 'and nobody can be the owner of nothing');
  }
  {
    // The mock accounts: no session exists to check, so the feature is off whatever is sent...
    const w = world({ NODE_ENV: 'development', NEXT_PUBLIC_AUTH_BACKEND: 'mock', SCREENS_OWNER_ID: OWNER }, { accounts });
    same(await server.ownerIsAsking(ask('/api/screens/host', { token: liveOwner }), w.deps), false, 'mock accounts: off, even with the owner id set and a token sent');
    // ...except on a dev server opened for the local drive.
    same(await server.ownerIsAsking(ask('/api/screens/host'), world(MOCK_OPEN).deps), true, 'mock accounts on a dev server with SCREENS_DEV_OPEN=1: whoever asks is the owner');
    same(await server.ownerIsAsking(ask('/api/screens/host', { site: 'cross-site' }), world(MOCK_OPEN).deps), false, "but never another site's page");
  }

  /* ---------------------------------------------------------------- everybody else: one answer, and the engine never asked */
  const engineUp = async (input, init) => {
    if (input.includes('/offer')) return new Response('v=0\r\nthe engine\'s answer\r\n', { status: 201, headers: { 'Content-Type': 'application/sdp', 'Debaser-Viewer': '7' } });
    return new Response(JSON.stringify({ ...ENGINE_SAYS, saw: init.method ?? 'GET' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const OFFER = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n';
  const strangers = [
    ['signed out', {}],
    ['another account', { token: liveOther }],
    ['a forged owner token', { token: forged }],
    ['a guest', { token: guest }],
    ["another site's page with the owner's session", { token: liveOwner, site: 'cross-site' }],
  ];
  const answers = { host: new Set(), offer: new Set(), settings: new Set() };
  for (const engine of [engineUp, null]) {
    for (const [who, how] of strangers) {
      const w = world(live, { accounts, engine });
      const host = await read(await server.hostAnswer(ask('/api/screens/host', how), w.deps));
      const offer = await read(await server.offerAnswer(ask('/api/screens/offer', { ...how, method: 'POST', type: 'application/sdp', body: OFFER }), w.deps));
      const settings = await read(await server.settingsAnswer(ask('/api/screens/settings?viewer=7', how), w.deps));
      const change = await read(await server.settingsAnswer(ask('/api/screens/settings?viewer=7', { ...how, method: 'POST', type: 'application/json', body: '{"lines":720}' }), w.deps));
      same([host.status, host.text], [200, '{"available":false}'], `${who}, engine ${engine ? 'running' : 'off'}: /host says exactly "not available"`);
      same([offer.status, settings.status, change.status], [403, 403, 403], `${who}: /offer and /settings refuse`);
      same(w.seen.engine, [], `${who}: the engine was never asked`);
      answers.host.add(JSON.stringify(host));
      answers.offer.add(JSON.stringify(offer));
      answers.settings.add(JSON.stringify(settings));
      answers.settings.add(JSON.stringify(change));
    }
    // No owner set at all, and the owner with the engine's address pointed at another machine: the same again.
    for (const env of [{ ...SUPABASE }, { ...live, SCREENS_ENGINE_URL: 'http://192.168.1.20:8478' }]) {
      const w = world(env, { accounts, engine });
      const host = await read(await server.hostAnswer(ask('/api/screens/host', { token: liveOwner }), w.deps));
      same([host.status, host.text], [200, '{"available":false}'], 'the owner, with the feature off or the engine pointed elsewhere: "not available"');
      same(w.seen.engine, [], 'and nothing was asked of any machine');
      answers.host.add(JSON.stringify(host));
    }
  }
  {
    // The owner while the engine is off gets the very same answer as a stranger.
    const w = world(live, { accounts });
    answers.host.add(JSON.stringify(await read(await server.hostAnswer(ask('/api/screens/host', { token: liveOwner }), w.deps))));
    same(w.seen.engine.length, 1, 'for the owner the engine WAS asked (and did not answer)');
  }
  same(answers.host.size, 1, 'every "not available" is the same answer, byte for byte, status and headers included');
  same(answers.offer.size, 1, 'every refusal of a hello is the same answer');
  same(answers.settings.size, 1, 'every refusal of the settings is the same answer');
  ok(/no-store/.test(JSON.parse([...answers.host][0]).kept), 'and it is never kept by a cache');

  /* ---------------------------------------------------------------- the owner's way through */
  {
    const w = world(live, { accounts, engine: engineUp });
    const host = await read(await server.hostAnswer(ask('/api/screens/host', { token: liveOwner }), w.deps));
    same(host.status, 200, 'the owner, engine running');
    same(JSON.parse(host.text), { available: true, settings: { ...ENGINE_SAYS, saw: 'GET' } }, "available, with the engine's own settings answer");
    ok(/no-store/.test(host.kept), 'never kept');
    same(w.seen.engine, [{ url: 'http://127.0.0.1:8478/settings', method: 'GET', body: null, type: null, redirect: 'error' }], 'asked of the engine on this PC, following no redirect');

    server.forgetOffers();
    const offer = await read(await server.offerAnswer(ask('/api/screens/offer', { token: liveOwner, method: 'POST', type: 'application/sdp', body: OFFER }), w.deps));
    same([offer.status, offer.type, offer.viewer, offer.text], [201, 'application/sdp', '7', "v=0\r\nthe engine's answer\r\n"], "the hello: the engine's answer and the viewer's number come back");
    same(w.seen.engine[1], { url: 'http://127.0.0.1:8478/offer', method: 'POST', body: OFFER, type: 'application/sdp', redirect: 'error' }, 'the offer was passed on as it came');

    const settings = await read(await server.settingsAnswer(ask('/api/screens/settings?viewer=7', { token: liveOwner }), w.deps));
    same([settings.status, JSON.parse(settings.text).saw], [200, 'GET'], 'the settings, read');
    same(w.seen.engine[2].url, 'http://127.0.0.1:8478/settings?viewer=7', "with the viewer's number");
    const change = await read(await server.settingsAnswer(ask('/api/screens/settings?viewer=7', { token: liveOwner, method: 'POST', type: 'application/json', body: '{"shape":"16:9","lines":720}' }), w.deps));
    same([change.status, JSON.parse(change.text).saw], [200, 'POST'], 'the settings, changed');
    same([w.seen.engine[3].url, w.seen.engine[3].body, w.seen.engine[3].type], ['http://127.0.0.1:8478/settings?viewer=7', '{"shape":"16:9","lines":720}', 'application/json'], 'the change was passed on as it came');
    await server.settingsAnswer(ask('/api/screens/settings?viewer=7%26token%3Dx&viewer=../offer', { token: liveOwner }), w.deps);
    same(w.seen.engine[4].url, 'http://127.0.0.1:8478/settings', "a viewer's number that is not a number is left out, never passed on");

    // What is refused before the engine hears of it.
    const before = w.seen.engine.length;
    same((await server.offerAnswer(ask('/api/screens/offer', { token: liveOwner, method: 'POST', type: 'text/plain', body: OFFER }), w.deps)).status, 415, 'an offer of the wrong kind');
    same((await server.offerAnswer(ask('/api/screens/offer', { token: liveOwner, method: 'POST', type: 'application/sdp', body: 'hello' }), w.deps)).status, 400, 'an offer that is not one');
    same((await server.offerAnswer(ask('/api/screens/offer', { token: liveOwner, method: 'POST', type: 'application/sdp', body: `v=0${'x'.repeat(server.MAX_OFFER_BYTES)}` }), w.deps)).status, 413, 'an offer past 64 KiB');
    same((await server.settingsAnswer(ask('/api/screens/settings', { token: liveOwner, method: 'POST', type: 'text/plain', body: '{}' }), w.deps)).status, 415, 'settings of the wrong kind');
    same((await server.settingsAnswer(ask('/api/screens/settings', { token: liveOwner, method: 'POST', type: 'application/json', body: '[1]' }), w.deps)).status, 400, 'settings that are not a JSON object');
    same((await server.settingsAnswer(ask('/api/screens/settings', { token: liveOwner, method: 'POST', type: 'application/json', body: `{"x":"${'y'.repeat(server.MAX_SETTINGS_BYTES)}"}` }), w.deps)).status, 413, 'settings past 4 KiB');
    same(w.seen.engine.length, before, 'none of those reached the engine');

    // A modest limit on hellos: so many a minute, then a plain refusal, then free again.
    server.forgetOffers();
    const hello = () => server.offerAnswer(ask('/api/screens/offer', { token: liveOwner, method: 'POST', type: 'application/sdp', body: OFFER }), w.deps);
    for (let n = 0; n < server.OFFERS_PER_MINUTE; n += 1) same((await hello()).status, 201, `hello ${n + 1} in the minute goes through`);
    const tooMany = await read(await hello());
    same(tooMany.status, 429, 'the next is refused');
    ok(/wait/i.test(JSON.parse(tooMany.text).error), 'in plain words');
    world.now += 61_000;
    same((await hello()).status, 201, 'a minute later hellos go through again');
    server.forgetOffers();
  }
  {
    // The engine's own plain reasons come back; its faults, and its silence, read as "did not answer", never as a trace.
    const refusing = async (input) => (input.includes('/offer') ? new Response('4 viewers are already watching', { status: 503 }) : new Response('"lines" is one of 720, 1080, 1440 or "native"', { status: 400 }));
    const w = world(live, { accounts, engine: refusing });
    const full = await read(await server.offerAnswer(ask('/api/screens/offer', { token: liveOwner, method: 'POST', type: 'application/sdp', body: OFFER }), w.deps));
    same([full.status, JSON.parse(full.text)], [503, { error: '4 viewers are already watching' }], "the engine's reason for refusing a hello");
    const bad = await read(await server.settingsAnswer(ask('/api/screens/settings', { token: liveOwner, method: 'POST', type: 'application/json', body: '{"lines":900}' }), w.deps));
    same([bad.status, JSON.parse(bad.text)], [400, { error: '"lines" is one of 720, 1080, 1440 or "native"' }], "the engine's reason for refusing a change");
    server.forgetOffers();
    const silent = world(live, { accounts });
    const gone = await read(await server.offerAnswer(ask('/api/screens/offer', { token: liveOwner, method: 'POST', type: 'application/sdp', body: OFFER }), silent.deps));
    same([gone.status, JSON.parse(gone.text)], [502, { error: "The PC's screen engine did not answer." }], 'an engine that is not there');
    ok(!/Error|at |stack/.test(gone.text), 'no trace of the failure is sent');
    server.forgetOffers();
  }

  /* ---------------------------------------------------------------- the real routes, with a pretend engine on this PC */
  let reached = 0;
  const pretend = http.createServer((request, response) => {
    reached += 1;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(ENGINE_SAYS));
  });
  await new Promise((resolve) => pretend.listen(0, '127.0.0.1', resolve));
  try {
    same([hostRoute.runtime, offerRoute.runtime, settingsRoute.runtime], ['nodejs', 'nodejs', 'nodejs'], 'the routes run on the server proper');
    same([hostRoute.dynamic, offerRoute.dynamic, settingsRoute.dynamic], ['force-dynamic', 'force-dynamic', 'force-dynamic'], 'and are never answered from a cache');
    const set = (env) => {
      for (const name of ['NODE_ENV', 'NEXT_PUBLIC_AUTH_BACKEND', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SCREENS_ENGINE_URL', 'SCREENS_OWNER_ID', 'SCREENS_DEV_OPEN']) delete process.env[name];
      Object.assign(process.env, env);
    };
    const engineHere = `http://127.0.0.1:${pretend.address().port}`;

    set({ NODE_ENV: 'development', NEXT_PUBLIC_AUTH_BACKEND: 'mock', SCREENS_DEV_OPEN: '1', SCREENS_ENGINE_URL: engineHere });
    const open = await read(await hostRoute.GET(ask('/api/screens/host')));
    same(JSON.parse(open.text), { available: true, settings: ENGINE_SAYS, drive: true }, 'a dev server opened for the drive: the real route reaches the pretend engine, and says it is the drive\'s (updated on purpose: SOUND needs the drive to stand in for a device that is not the PC)');
    same(reached, 1, 'once');

    set({ NODE_ENV: 'production', NEXT_PUBLIC_AUTH_BACKEND: 'mock', SCREENS_DEV_OPEN: '1', SCREENS_ENGINE_URL: engineHere });
    same((await read(await hostRoute.GET(ask('/api/screens/host')))).text, '{"available":false}', 'the same server as a production one: not available, switch or no switch');
    same((await offerRoute.POST(ask('/api/screens/offer', { method: 'POST', type: 'application/sdp', body: OFFER }))).status, 403, 'no hello');
    same((await settingsRoute.GET(ask('/api/screens/settings'))).status, 403, 'no settings');
    same((await settingsRoute.POST(ask('/api/screens/settings', { method: 'POST', type: 'application/json', body: '{}' }))).status, 403, 'no change of settings');
    same(reached, 1, 'and the engine heard nothing of it');

    set({ NODE_ENV: 'development', NEXT_PUBLIC_AUTH_BACKEND: 'mock', SCREENS_ENGINE_URL: engineHere });
    same((await read(await hostRoute.GET(ask('/api/screens/host')))).text, '{"available":false}', 'a dev server WITHOUT the switch: not available');

    // Real accounts behind the site, an owner set: a visitor with no session is told no without a word to any server.
    set({ ...SUPABASE, SCREENS_OWNER_ID: OWNER, SCREENS_DEV_OPEN: '1', SCREENS_ENGINE_URL: engineHere });
    same((await read(await hostRoute.GET(ask('/api/screens/host')))).text, '{"available":false}', 'the live shape of things, signed out: not available');
    same((await read(await hostRoute.GET(ask('/api/screens/host', { token: liveOther })))).text, '{"available":false}', 'and signed in as somebody else: not available');
    same((await offerRoute.POST(ask('/api/screens/offer', { token: liveOther, method: 'POST', type: 'application/sdp', body: OFFER }))).status, 403, 'nor a hello');
    same(reached, 1, 'the engine still heard nothing');
    set({ NODE_ENV: 'development' });
  } finally {
    await new Promise((resolve) => pretend.close(resolve));
  }

  /* ---------------------------------------------------------------- the settings model */
  same(wishes.wishesFrom(null), wishes.DEFAULT_WISHES, 'nothing remembered: the defaults');
  same(wishes.wishesFrom('x'), wishes.DEFAULT_WISHES, 'rubbish remembered: the defaults');
  same(wishes.DEFAULT_WISHES, { match: false, shape: 'native', lines: 1080, fps: 'auto', bitrateKbps: 20000, drawing: 'fast', upscaling: 'smooth', numbers: true, mouse: 'pointer', fit: false, sound: false, volume: 1 }, "the defaults are the engine page's");
  same(
    wishes.wishesFrom({ match: 'yes', shape: 'cut', lines: 900, fps: 75, bitrateKbps: 12, drawing: 'quick', upscaling: 'ai', numbers: 0, mouse: 'pen', sound: 'yes', volume: 7, extra: '<script>' }),
    wishes.DEFAULT_WISHES,
    'each wish is taken only when it is one of the choices',
  );
  same(
    wishes.wishesFrom({ match: false, shape: '21:9', lines: 'native', fps: 120, bitrateKbps: 30500.4, drawing: 'normal', upscaling: 'sharpened', numbers: false, mouse: 'game', sound: true, volume: 0.4, fit: true }),
    { match: false, shape: '21:9', lines: 'native', fps: 120, bitrateKbps: 30500, drawing: 'normal', upscaling: 'sharpened', numbers: false, mouse: 'game', fit: true, sound: true, volume: 0.4 },
    'and kept when it is',
  );
  const here = { viewWidth: 1920, viewHeight: 1200 };
  same(wishes.wishesForThePc(wishes.DEFAULT_WISHES), { shape: 'native', lines: 1080, fps: 'auto', bitrateKbps: 20000 }, 'what is asked of the PC from the defaults');
  same(wishes.wishesForThePc({ ...wishes.DEFAULT_WISHES, match: false, shape: '4:3' }).shape, '4:3', 'with MATCH off, the shape chosen by hand');
  same(wishes.requestFor({ shape: 'match', fps: 'auto' }, here, 144), { shape: 'match', fps: 'auto', viewWidth: 1920, viewHeight: 1200, viewHz: 144 }, "MATCH goes with this screen's size and AUTO with its measured rate");
  same(wishes.requestFor({ fps: 'auto' }, here, null), { fps: 'auto', viewHz: 60 }, 'AUTO before the rate is measured: 60');
  same(wishes.requestFor({ shape: '16:9', lines: 720 }, here, 144), { shape: '16:9', lines: 720 }, 'a plain change carries nothing extra');
  same(wishes.requestFor({ shape: 'match', viewWidth: 1280, viewHeight: 800 }, here, 60), { shape: 'match', viewWidth: 1280, viewHeight: 800 }, "a caller's own screen size is kept");
  const after = wishes.wishesAfter(wishes.DEFAULT_WISHES, { shape: '16:10', lines: 720, fps: 60, bitrateKbps: 8000 });
  same([after.match, after.shape, after.lines, after.fps, after.bitrateKbps], [false, '16:10', 720, 60, 8000], 'a change asked for is what this device then wishes for');
  // FIT (Luke, 2026-11-21): a separate switch, off at first; asking for it carries this screen's size.
  same(wishes.requestFor({ pcScreen: 'fit' }, here, 60), { pcScreen: 'fit', viewWidth: 1920, viewHeight: 1200 }, "FIT goes with this screen's size");
  same(wishes.requestFor({ pcScreen: 'own' }, here, 60), { pcScreen: 'own' }, 'giving the PC its screen back carries nothing extra');
  same([wishes.wishesAfter(wishes.DEFAULT_WISHES, { pcScreen: 'fit' }).fit, wishes.wishesAfter({ ...wishes.DEFAULT_WISHES, fit: true }, { pcScreen: 'own' }).fit], [true, false], 'asking for FIT, or giving it back, is what this device then wishes for');
  same(wishes.wishesFrom({ fit: 'yes' }).fit, false, 'a FIT wish is taken only when it is true or false');
  same(wishes.wishesAfter(after, { shape: 'match' }).shape, '16:10', 'MATCH on keeps the shape last chosen by hand, for when it goes off again');
  same(wishes.wishesAfter(after, { shape: 'match' }).match, true, 'and marks MATCH on');

  // This screen's own rate, from the gaps between its refreshes.
  const gapsAt = (hz, count = wishes.RATE_GAPS) => Array.from({ length: count }, (_, n) => 1000 / hz + (n % 2 === 0 ? 0.05 : -0.05));
  same(wishes.rateFromGaps(gapsAt(60)), 60, 'a 60 Hz screen');
  same(wishes.rateFromGaps(gapsAt(143.9)), 144, 'within 1% of a well-known rate is that rate');
  same(wishes.rateFromGaps(gapsAt(180)), 180, 'a 180 Hz screen');
  same(wishes.rateFromGaps([...gapsAt(60, 59), 400]), 60, 'one late call does not count');
  same(wishes.rateFromGaps(gapsAt(10)), 24, 'never less than 24');
  same(wishes.rateFromGaps(gapsAt(133)), 133, 'an unusual rate is taken as measured');
  same(wishes.rateFromGaps([]), null, 'no gaps: not known');
  same(wishes.rateFromGaps([0, 0, 0]), null, 'gaps of nothing: not known');

  same([wishes.megabits(20000), wishes.megabits(12500), wishes.megabits(2000)], ['20 Mbit/s', '12.5 Mbit/s', '2 Mbit/s'], 'megabits, in words');
  const host = wishes.hostSettingsFrom({ ...ENGINE_SAYS, hostLimits: { maxLines: 1080, maxFps: 60, maxBitrateKbps: 12999 }, sending: { x: 440, y: 0, regionWidth: 2560, regionHeight: 1440, width: 1280, height: 720, scaled: true, fps: 60, bitrateKbps: 20000, codec: 'H.264' }, measured: { framesPerSecond: 59.6, newFramesPerSecond: 12.2, kbitPerSecond: 1840, shownToEncodedMs: 3.21 } });
  ok(host !== null, "the engine's answer is read");
  same(wishes.hostSettingsFrom({ available: true }), null, 'something else is not');
  // FIT's part of the answer: read when it is whole, nothing when it is missing or broken (an older engine).
  const fitSaid = wishes.hostSettingsFrom({ ...ENGINE_SAYS, pcScreen: { allowed: true, own: { width: 3440, height: 1440, hz: 180 }, now: { width: 2560, height: 1440, hz: 144 }, fitted: true, wantedBy: 1, yours: true, why: null } });
  same(fitSaid.pcScreen, { allowed: true, own: { width: 3440, height: 1440, hz: 180 }, now: { width: 2560, height: 1440, hz: 144 }, fitted: true, wantedBy: 1, yours: true, why: null }, "the PC's FIT answer is read");
  same([wishes.hostSettingsFrom(ENGINE_SAYS).pcScreen, wishes.hostSettingsFrom({ ...ENGINE_SAYS, pcScreen: { allowed: true, own: 'big' } }).pcScreen], [null, null], 'and is nothing from an older engine, or when broken');
  same(wishes.hostSettingsFrom({ ...ENGINE_SAYS, screen: { width: '3440' } }), null, 'nor an answer with a part missing');
  same(wishes.LINES.filter((lines) => wishes.linesOffered(lines, host)), [720, 1080, 'native'], 'more lines than the PC has are not offered; NATIVE always is');
  same(wishes.RATES.filter((rate) => wishes.rateOffered(rate, host)), ['auto', 30, 60], 'more frames a second than the PC shows are not offered; AUTO always is');
  same(wishes.RATES.filter((rate) => wishes.rateOffered(rate, null)), ['auto', 30, 60, 120, 180], 'before the PC has said anything, everything is offered');
  same(wishes.bitrateMaxMbit(host), 12, "the slider ends at the PC's own limit");
  same(wishes.askedNow(host, wishes.DEFAULT_WISHES).shape, '16:9', 'the panel shows what the PC says is asked');
  same(wishes.askedNow(null, wishes.DEFAULT_WISHES).shape, 'native', 'and what this device remembers until it has said anything');
  same(
    wishes.reallySending(host),
    "REALLY SENDING: 1280x720, up to 60 frames a second, 20 Mbit/s, H.264\nThe middle 2560x1440 of the PC's 3440x1440 screen, made smaller on the PC.\nLast second: 60 frames (12 of them new), 1.8 Mbit/s.",
    'what the PC is really sending, in words',
  );
  same(wishes.reallySending(null), 'Waiting for the PC to say what it is sending.', 'and before it has said');
  same(wishes.capSays(host), null, 'no cap, no line about one');
  same(
    wishes.capSays({ ...host, cap: 'LEAGUE MATCH', capWhy: 'League of Legends.exe is running on the PC', limits: { maxLines: 1080, maxFps: 60, maxBitrateKbps: 12000 } }),
    'CAPPED BY THE PC: LEAGUE MATCH\nLeague of Legends.exe is running on the PC. While it is, the PC sends at most 1080 lines, 60 frames a second, 12 Mbit/s. What was asked for comes back when it ends.',
    'a cap is said plainly',
  );
  same(wishes.troubleLines({ ...host, applied: false, refused: 'too wide' }, 'The PC could not be reached for its settings.').length, 3, 'each trouble has its line');
  same(wishes.controlKeySays({ ...host, control: 'another device' }, false, ''), 'ANOTHER DEVICE HAS CONTROL', 'why control cannot be taken');
  same(wishes.controlKeySays({ ...host, control: 'off' }, false, 'x'), '', 'nothing to say where control is not allowed (the key is not there)');
  ok(wishes.controlStateSays({ ...host, control: 'yours' }, true, '').includes('DRY RUN'), 'a dry run is said');
  ok(wishes.controlStateSays({ ...host, control: 'off' }, false, '').startsWith('THIS PC IS NOT ALLOWING CONTROL'), 'a PC that does not allow control says so');

  /* ---------------------------------------------------------------- CONTROL's messages (engine/src/control.rs) */
  const bytes = (message) => [...message];
  same([bytes(wire.takeMessage()), bytes(wire.releaseMessage()), bytes(wire.stillHereMessage()), bytes(wire.allUpMessage())], [[0x01], [0x02], [0x03], [0x04]], 'TAKE, RELEASE, STILL HERE, ALL UP');
  same(bytes(wire.keyMessage(true, 'KeyA')), [0x10, 1, 0x4b, 0x65, 0x79, 0x41], 'KEY: down, then the key by its code');
  same(bytes(wire.keyMessage(false, 'ArrowLeft')).slice(0, 2), [0x10, 0], 'KEY: up');
  same(bytes(wire.buttonMessage(1, true, [0x1234, 0xfffe])), [0x11, 1, 1, 1, 0x34, 0x12, 0xfe, 0xff], 'BUTTON with its place, low byte first');
  same(bytes(wire.buttonMessage(0, false, null)), [0x11, 0, 0, 0, 0, 0, 0, 0], 'BUTTON with no place (GAME)');
  same(wire.BUTTONS, [0, 2, 1, 3, 4], "the browser's left, middle, right are the PC's left, right, middle");
  same(wire.wheelTurns(0, 100, 0), { dx: 0, dy: -120 }, 'one notch towards the hand is -120');
  same(wire.wheelTurns(0, -200, 0), { dx: 0, dy: 240 }, 'two notches away are 240');
  same(wire.wheelTurns(100, 0, 0), { dx: 120, dy: 0 }, 'one notch to the right is 120');
  same(wire.wheelTurns(0, 3, 1), { dx: 0, dy: -120 }, 'three lines are a notch');
  same(wire.wheelTurns(0, 1e9, 0).dy, -32768, 'a turn never overflows its two bytes');
  same(bytes(wire.wheelMessage(120, -120, [1, 2])), [0x12, 120, 0, 0x88, 0xff, 1, 1, 0, 2, 0], 'WHEEL: two signed turns, then the place');
  same(bytes(wire.pointerAtMessage([65535, 0])), [0x20, 0xff, 0xff, 0, 0], 'POINTER AT');
  same(bytes(wire.pointerByMessage(-2, 3)), [0x21, 0xfe, 0xff, 3, 0], 'POINTER BY, signed');
  same([wire.wholeMove(2.9), wire.wholeMove(-2.9), wire.wholeMove(1e6)], [2, -2, 32767], 'movement goes in whole pixels that fit');
  const box = { left: 100, top: 50, width: 800, height: 450 };
  same(wire.placeOnPicture(box, 100, 50), [0, 0], 'the top left of the picture');
  same(wire.placeOnPicture(box, 900, 500), [65535, 65535], 'the bottom right');
  same(wire.placeOnPicture(box, 300, 275), [16384, 32768], 'a quarter across and half way down');
  same(wire.placeOnPicture(box, 0, 9999), [0, 65535], 'off the picture is its edge');
  same(wire.placeOnPicture(null, 1, 1), null, 'no picture, no place');
  same(wire.fittedBox({ left: 0, top: 0, width: 1000, height: 1000 }, 1280, 720), { left: 0, top: 218.75, width: 1000, height: 562.5 }, 'a wide picture fitted in a square box sits in its middle');
  same(wire.pcSaid(new Uint8Array([0x80, 1])), { kind: 'yours' }, 'the PC: control is yours');
  same(wire.pcSaid(new Uint8Array([0x80, 10])), { kind: 'released' }, 'the PC: let go');
  same(wire.pcSaid(new Uint8Array([0x80, 13])), { kind: 'ended', why: 'CONTROL ENDED: A LEAGUE MATCH STARTED' }, 'the PC: ended, and why');
  same(wire.pcSaid(new Uint8Array([0x80, 4])), { kind: 'refused', why: 'NOT DURING A LEAGUE MATCH' }, 'the PC: refused, and why');
  same(wire.pcSaid(new Uint8Array([0x10, 1])), null, 'anything else is not about control');
  same(wire.isLetGoChord({ ctrlKey: true, altKey: true, shiftKey: true, code: 'KeyQ' }), true, 'Ctrl+Alt+Shift+Q lets go');
  same(wire.isLetGoChord({ ctrlKey: true, altKey: true, shiftKey: false, code: 'KeyQ' }), false, 'nothing less does');

  /* ---------------------------------------------------------------- SOUND, the controller, the PC's pointer */
  same([bytes(wire.soundMessage(true)), bytes(wire.soundMessage(false))], [[0x30, 1], [0x30, 0]], 'SOUND: wanted, not wanted');
  same([bytes(wire.padPresentMessage(true)), bytes(wire.padPresentMessage(false))], [[0x13, 1], [0x13, 0]], 'CONTROLLER: this device has one, it has gone');
  const button = (pressed, value = pressed ? 1 : 0) => ({ pressed, value });
  const controller = (down, more = {}) => ({ buttons: Array.from({ length: 17 }, (_, index) => (index === 6 ? button(false, more.lt ?? 0) : index === 7 ? button(false, more.rt ?? 0) : button(down.includes(index)))), axes: more.axes ?? [0, 0, 0, 0] });
  same(wire.padState(controller([])), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 'a controller with nothing pressed is twelve noughts');
  same(wire.padState(controller([])), [...wire.PAD_NEUTRAL], 'which is what "nothing pressed" is sent as');
  // The engine's own example (engine/src/control.rs): RB and A, the right trigger half way, the left stick hard left and up.
  same(wire.padState(controller([5, 0], { rt: 0.5, axes: [-1, -1, 0, 0] })), [0x00, 0x12, 0, 128, 0x01, 0x80, 0xff, 0x7f, 0, 0, 0, 0], 'RB and A are bits 0200 and 1000; a trigger is 0 to 255; left is negative and UP is positive (a browser says up is negative)');
  same(wire.padState(controller([], { axes: [1, 1, -0.5, 0.25] })), [0, 0, 0, 0, 0xff, 0x7f, 0x01, 0x80, 0x01, 0xc0, 0x00, 0xe0], 'right is positive, down is negative, and a half is half (-16383, as the engine page rounds it)');
  same(wire.padState(controller([], { lt: 1, rt: 7, axes: [9, -9, 0, 0] })).slice(2, 8), [255, 255, 0xff, 0x7f, 0xff, 0x7f], 'nothing goes past its ends');
  const bits = Object.fromEntries([[12, 0x0001], [13, 0x0002], [14, 0x0004], [15, 0x0008], [9, 0x0010], [8, 0x0020], [10, 0x0040], [11, 0x0080], [4, 0x0100], [5, 0x0200], [16, 0x0400], [0, 0x1000], [1, 0x2000], [2, 0x4000], [3, 0x8000]]);
  for (const [number, bit] of Object.entries(bits)) {
    const state = wire.padState(controller([Number(number)]));
    same(state[0] | (state[1] << 8), bit, `the browser's button ${number} is the PC's bit ${bit.toString(16).padStart(4, '0')}`);
  }
  same(wire.padState(controller([6, 7])).slice(0, 2), [0, 0], "the browser's buttons 6 and 7 are the triggers: amounts, never bits");
  same(wire.padState(controller(Object.keys(bits).map(Number))).slice(0, 2), [0xff, 0xf7], 'every button at once');
  same(wire.padState({ buttons: [], axes: [] }), [...wire.PAD_NEUTRAL], 'a controller that says nothing is nothing pressed');
  same(bytes(wire.padStateMessage(0x0102, wire.padState(controller([0])))), [0x22, 0x02, 0x01, 0x00, 0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 'CONTROLLER STATE: fifteen bytes, the counter first, low byte first');

  const shapeHead = (number, width, height, hotX, hotY, how) => [0x82, ...wire.two(number), ...wire.two(width), ...wire.two(height), ...wire.two(hotX), ...wire.two(hotY), how];
  const asItIs = wire.pointerShapeFrom(new Uint8Array([...shapeHead(7, 2, 1, 1, 0, 0), 255, 0, 0, 255, 0, 0, 255, 128]));
  same([asItIs.number, asItIs.width, asItIs.height, asItIs.hotX, asItIs.hotY, [...asItIs.pixels]], [7, 2, 1, 1, 0, [255, 0, 0, 255, 0, 0, 255, 128]], 'a shape sent as it is (how 0): its number, size, hot spot and pixels');
  const inRuns = wire.pointerShapeFrom(new Uint8Array([...shapeHead(300, 3, 2, 0, 1, 1), 4, 255, 255, 255, 255, 2, 0, 0, 0, 0]));
  same([inRuns.number, [...inRuns.pixels]], [300, [255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0]], 'a shape sent in runs (how 1): four white pixels, then two see-through ones');
  same(wire.pointerShapeFrom(new Uint8Array([...shapeHead(8, 3, 2, 0, 0, 1), 4, 255, 255, 255, 255])).pixels, null, 'runs that do not fill the shape are no picture');
  same(wire.pointerShapeFrom(new Uint8Array([...shapeHead(8, 2, 1, 0, 0, 0), 1, 2, 3, 4])).pixels, null, 'nor are too few pixels');
  const tooLarge = wire.pointerShapeFrom(new Uint8Array(shapeHead(9, 200, 200, 100, 100, 2)));
  same([tooLarge.number, tooLarge.width, tooLarge.height, tooLarge.pixels], [9, 200, 200, null], 'a shape too large to be sent (how 2): its size, and no pixels');
  same(wire.pointerShapeFrom(new Uint8Array([0x81, 1])), null, 'another message is not a shape');
  const block = { number: 1, width: 24, height: 32, hotX: 3, hotY: 5, pixels: new Uint8ClampedArray(24 * 32 * 4) };
  same(wire.pointerLook(block, 1), { use: 'shape', width: 24, height: 32, hotX: 3, hotY: 5 }, 'at the PC\'s own scale the pointer is its own size');
  same(wire.pointerLook(block, 0.5), { use: 'shape', width: 12, height: 16, hotX: 2, hotY: 3 }, 'at half scale it is half the size, its hot spot with it');
  same(wire.pointerLook(block, 500 / 2560), { use: 'shape', width: 5, height: 6, hotX: 1, hotY: 1 }, 'in a narrow room box it is small, and never smaller than one pixel');
  same(wire.pointerLook(block, 8).use, 'arrow', 'past 128 page pixels a browser shows no pointer picture: the plain arrow');
  ok(wire.pointerLook(block, 8).why.includes('192 by 256') && wire.pointerLook(block, 8).why.includes('128'), 'and the one line says why');
  ok(wire.pointerLook({ ...block, pixels: null }, 1).why.includes('too large to be sent'), 'a shape that came without pixels: the plain arrow, and why');
  ok(wire.pointerLook(null, 1).why.includes('has not sent'), 'no shape yet: the plain arrow, and why');
  same(wire.pcMessage(new Uint8Array([0x81, 0])), { kind: 'pointerShown', shown: false }, 'the PC: its pointer is hidden');
  same(wire.pcMessage(new Uint8Array([0x81, 1])), { kind: 'pointerShown', shown: true }, 'the PC: its pointer is showing');
  same(wire.pcMessage(new Uint8Array([0x83, 2])), { kind: 'pad', what: 2 }, 'the PC: it has no controller driver');
  same(wire.pcMessage(new Uint8Array([0x84, 2])), { kind: 'sound', what: 2 }, 'the PC: it is not sending sound');
  same(wire.pcMessage(new Uint8Array([0x80, 1])), { kind: 'control', said: { kind: 'yours' } }, 'the PC: control is yours, as before');
  same(wire.pcMessage(new Uint8Array(shapeHead(9, 200, 200, 100, 100, 2))).kind, 'pointerShape', 'the PC: a new pointer shape');
  same(wire.pcMessage(new Uint8Array([0x99, 1])), null, 'anything else is nothing');

  // Is this device the PC itself? The connection's far end says.
  for (const address of ['127.0.0.1', '127.8.9.10', '::1', '[::1]', '::ffff:127.0.0.1']) same(wire.isLoopbackAddress(address), true, `${address} is this very machine`);
  for (const address of ['192.168.1.20', '10.0.0.5', '1127.0.0.1', '127.0.0.1.example', 'fe80::1', '::2', '']) same(wire.isLoopbackAddress(address), false, `${address} is not`);

  const withSound = wishes.hostSettingsFrom({ ...ENGINE_SAYS, controller: 'none', controllerWhy: null, sound: { allowed: true, listeners: 1, capturing: true, source: 'a test tone', heard: 'sound', packetsSent: 400, problem: null }, pointer: { shown: true, shape: 3, width: 24, height: 32 } });
  same([withSound.controller, withSound.sound.allowed, withSound.sound.heard, withSound.pointer.width], ['none', true, 'sound', 24], "the engine's new answers are read");
  const older = wishes.hostSettingsFrom(ENGINE_SAYS);
  same([older.controller, older.sound, older.pointer], ['off', null, null], 'an older engine that says none of it is read too');
  same(wishes.soundOffered(withSound, false), true, 'sound is offered on a device that is not the PC, when the PC sends it');
  same(wishes.soundOffered(withSound, true), false, 'never on the PC itself (it would feed back into itself)');
  same(wishes.soundOffered(withSound, null), false, 'and not until the connection has said which this device is');
  same(wishes.soundOffered({ ...withSound, sound: { ...withSound.sound, allowed: false } }, false), false, 'not when the PC was started without sound');
  same(wishes.soundOffered(older, false), false, 'not from an older engine');
  same(wishes.soundOffered(null, false), false, 'not before the PC has said anything');
  same(wishes.SOUND_ON_THIS_PC, 'ON THIS PC THE SOUND WOULD FEED BACK INTO ITSELF', "the warning is the engine page's");
  same(wishes.soundStateSays(withSound, true, false, ''), 'Not offered here: this device is the PC itself.', 'the panel on the PC itself');
  same(wishes.soundStateSays(withSound, false, true, ''), 'ON. The PC is playing sound.', 'the panel with sound on');
  same(wishes.soundStateSays({ ...withSound, sound: { ...withSound.sound, heard: 'silence' } }, false, true, ''), 'ON. The PC is playing nothing at the moment.', 'and when the PC is silent');
  ok(wishes.soundStateSays(withSound, false, false, wishes.SOUND_WANTS_A_PRESS).endsWith('PRESS [ SOUND ]'), 'a browser that wants a press first is told so');
  ok(wishes.soundStateSays(older, false, false, '').startsWith('THIS PC IS NOT SENDING SOUND'), 'an older engine sends none, and the panel says so');
  const seen = { supported: true, name: 'Made-up controller (STANDARD GAMEPAD)', odd: false, pcSays: null };
  ok(wishes.padSays({ ...seen, name: '' }, false, withSound).startsWith('NO CONTROLLER ON THIS DEVICE'), 'no controller: said');
  ok(wishes.padSays({ ...seen, name: '', odd: true }, false, withSound).startsWith('A CONTROLLER IS CONNECTED, BUT THIS BROWSER DOES NOT KNOW ITS LAYOUT'), 'a controller in a layout the browser does not know: said, and not used');
  ok(wishes.padSays(seen, false, withSound).includes('while this device holds control'), 'a controller, not controlling: what it will do');
  ok(wishes.padSays({ ...seen, pcSays: 1 }, true, withSound).endsWith('IT IS DRIVING A PRETEND XBOX 360 CONTROLLER ON THE PC.'), 'a controller, controlling, plugged in on the PC');
  ok(wishes.padSays({ ...seen, pcSays: 2 }, true, withSound).endsWith('THE PC HAS NO CONTROLLER DRIVER'), 'the PC has no driver: said');
  same(wishes.padSays({ ...seen, supported: false }, false, withSound), 'THIS BROWSER GIVES NO CONTROLLERS TO THIS PAGE', 'a browser with no controllers at all');

  /* ---------------------------------------------------------------- REMOTE from another of the owner's devices */
  {
    const mail = require(path.join(OUT, 'lib/screens/device-mail.js'));
    const store = new mail.DeviceMail();
    const t = 5_000_000;
    same(store.hereIAm('aaaaaaaa1', 'WINDOWS · CHROME · 3440x1440', t).devices, [], 'the first device on: nobody else listed');
    same(store.hereIAm('bbbbbbbb2', 'WINDOWS · EDGE · 1920x1080', t + 100).devices, [{ id: 'aaaaaaaa1', name: 'WINDOWS · CHROME · 3440x1440' }], 'the second sees the first');
    same(store.hereIAm('aaaaaaaa1', 'WINDOWS · CHROME · 3440x1440', t + 200).devices.map((d) => d.id), ['bbbbbbbb2'], 'and the first the second, never itself');
    same(store.send('aaaaaaaa1', 'bbbbbbbb2', 'ask', '', t + 300), null, 'a message for a device on the site now is taken');
    same(store.hereIAm('bbbbbbbb2', 'x', t + 400).mail.map((m) => `${m.from} ${m.kind}`), ['aaaaaaaa1 ask'], 'and handed to it with its next "here I am"');
    same(store.hereIAm('bbbbbbbb2', 'x', t + 500).mail, [], 'once only');
    ok(/not on the site/.test(store.send('aaaaaaaa1', 'cccccccc3', 'ask', '', t + 600)), 'a device not seen lately is refused');
    ok(/itself/.test(store.send('aaaaaaaa1', 'aaaaaaaa1', 'ask', '', t + 600)), 'and a device sending to itself');
    for (let i = 0; i < mail.MAX_WAITING; i += 1) store.send('aaaaaaaa1', 'bbbbbbbb2', 'stop', '', t + 700);
    ok(/too many/.test(store.send('aaaaaaaa1', 'bbbbbbbb2', 'stop', '', t + 700)), 'a full mailbox refuses more');
    same(store.hereIAm('aaaaaaaa1', 'a', t + 200 + mail.DEVICE_FRESH_MS + 1000).devices, [], 'a device silent longer than it stays fresh is not listed');
    const old = new mail.DeviceMail();
    old.hereIAm('aaaaaaaa1', 'a', t);
    old.hereIAm('bbbbbbbb2', 'b', t);
    old.send('aaaaaaaa1', 'bbbbbbbb2', 'ask', '', t);
    same(old.hereIAm('bbbbbbbb2', 'b', t + mail.MAIL_KEPT_MS + 1).mail, [], 'a message not collected within a minute is dropped');
    same([mail.cleanName('A\u0000B\n  C'), mail.cleanName(''), mail.cleanName(7), mail.cleanName('x'.repeat(90)).length], ['A B C', 'A DEVICE', 'A DEVICE', 60], "a device's name is one plain line, at most 60 characters");
    same([mail.isDeviceId('abc12345'), mail.isDeviceId('ABC12345'), mail.isDeviceId('a b'), mail.isDeviceId('<script>')], [true, false, false, false], 'device names for the mailbox are short lower-case letters and digits only');

    // The routes: owner only, the same refusal for everybody else; the size and kind rules.
    const OPEN = { NODE_ENV: 'development', NEXT_PUBLIC_AUTH_BACKEND: 'mock', SCREENS_DEV_OPEN: '1' };
    const CLOSED = { ...SUPABASE, SCREENS_OWNER_ID: OWNER };
    const routes = new mail.DeviceMail();
    const post = (url, value, token) => ask(url, { method: 'POST', type: 'application/json', body: JSON.stringify(value), token });
    const stranger = await read(await mail.devicesAnswer(post('/api/screens/devices', { id: 'aaaaaaaa1', name: 'x' }, tokenFor(OTHER)), world(CLOSED, { accounts: { [tokenFor(OTHER)]: OTHER } }).deps, routes, t));
    const nobody = await read(await mail.devicesAnswer(post('/api/screens/devices', { id: 'aaaaaaaa1', name: 'x' }), world(CLOSED).deps, routes, t));
    same([stranger.status, stranger.text, nobody.status, nobody.text], [403, '{"error":"Not available."}', 403, '{"error":"Not available."}'], 'another account and nobody at all get the same refusal');
    same(routes.devices.size, 0, 'and nothing of theirs is noted');
    const mine = await read(await mail.devicesAnswer(post('/api/screens/devices', { id: 'aaaaaaaa1', name: 'MINE' }, tokenFor(OWNER)), world(CLOSED, { accounts: { [tokenFor(OWNER)]: OWNER } }).deps, routes, t));
    same([mine.status, JSON.parse(mine.text)], [200, { devices: [], mail: [] }], 'the owner is noted and answered');
    same(mine.kept, 'private, no-store', 'never kept in a cache');
    await mail.devicesAnswer(post('/api/screens/devices', { id: 'bbbbbbbb2', name: 'OTHER' }), world(OPEN).deps, routes, t);
    const badKind = await read(await mail.mailAnswer(post('/api/screens/mail', { from: 'aaaaaaaa1', to: 'bbbbbbbb2', kind: 'run', body: '' }), world(OPEN).deps, routes, t));
    const tooBig = await read(await mail.mailAnswer(post('/api/screens/mail', { from: 'aaaaaaaa1', to: 'bbbbbbbb2', kind: 'offer', body: 'x'.repeat(mail.MAX_MAIL_BYTES + 1) }), world(OPEN).deps, routes, t));
    const gone = await read(await mail.mailAnswer(post('/api/screens/mail', { from: 'aaaaaaaa1', to: 'zzzzzzzz9', kind: 'ask', body: '' }), world(OPEN).deps, routes, t));
    const fine = await read(await mail.mailAnswer(post('/api/screens/mail', { from: 'aaaaaaaa1', to: 'bbbbbbbb2', kind: 'ask', body: '' }), world(OPEN).deps, routes, t));
    same([badKind.status, tooBig.status, gone.status, fine.status], [400, 413, 409, 204], 'the mailbox refuses an unknown kind, a too-large message and a device not on the site, and takes a good one');
    const strangerMail = await read(await mail.mailAnswer(post('/api/screens/mail', { from: 'aaaaaaaa1', to: 'bbbbbbbb2', kind: 'ask', body: '' }), world(CLOSED).deps, routes, t));
    same(strangerMail.status, 403, 'and refuses everybody but the owner');

    // The picture for another device draws its first words before anything is asked (nothing runs on the server).
    const RoomDeviceScreen = require('./out-screens/components/RoomDeviceScreen.js').default;
    const drawn = require('react-dom/server').renderToStaticMarkup(require('react').createElement(RoomDeviceScreen, { source: { kind: 'device', id: 'bbbbbbbb2', name: 'WINDOWS · EDGE · 1920x1080' } }));
    const DeviceShareGate = require('./out-screens/components/DeviceShareGate.js').default;
    same(require('react-dom/server').renderToStaticMarkup(require('react').createElement(DeviceShareGate)), '', "the share gate every page carries draws nothing until one of the owner's devices asks");
    ok(drawn.includes('ASKING WINDOWS · EDGE · 1920x1080: SOMEBODY THERE PRESSES SHARE'), "the other device's picture says it is asking, and that somebody there must press SHARE");
  }

  /* ---------------------------------------------------------------- the keyboard's first listener */
  {
    const listeners = [];
    global.window = { addEventListener: (kind, listener, capture) => listeners.push({ kind, listener, capture }) };
    same(listeners.length, 0, 'nothing listens before the layout\'s gate component has loaded');
    // The component the layout draws first: its one job is to open the gate as its file loads, and to draw nothing.
    const ScreenKeyGate = require('./out-screens/components/ScreenKeyGate.js').default;
    same(listeners.length, 2, 'loading the gate component opens the gate at once, before any window of the site can listen');
    same(require('react-dom/server').renderToStaticMarkup(require('react').createElement(ScreenKeyGate)), '', 'and it draws nothing');
    gate.openKeyGate();
    gate.openKeyGate();
    same(listeners.map(({ kind, capture }) => `${kind} ${capture}`), ['keydown true', 'keyup true'], 'one listener for keys going down and one for keys coming up, before any other, added once');
    const heardKeys = [];
    const taker = (event, down) => heardKeys.push(`${event.code} ${down ? 'down' : 'up'}`);
    listeners[0].listener({ code: 'Escape' });
    same(heardKeys, [], 'until CONTROL takes it, it does nothing at all');
    gate.takeKeys(taker);
    listeners[0].listener({ code: 'Escape' });
    listeners[1].listener({ code: 'Escape' });
    same(heardKeys, ['Escape down', 'Escape up'], 'taken, every key goes to CONTROL first');
    gate.leaveKeys(() => undefined);
    listeners[0].listener({ code: 'KeyA' });
    same(heardKeys.length, 3, 'only the taker itself can give it back');
    gate.leaveKeys(taker);
    listeners[0].listener({ code: 'KeyB' });
    same(heardKeys.length, 3, 'given back, it does nothing again');
    same(listeners.length, 2, 'and no listener was ever added twice');
    delete global.window;
  }

  /* ---------------------------------------------------------------- the drive's mark */
  {
    const open = world(MOCK_OPEN, { engine: engineUp });
    same(JSON.parse((await read(await server.hostAnswer(ask('/api/screens/host'), open.deps))).text).drive, true, 'a server opened for the local drive says so');
    const real = world(live, { accounts, engine: engineUp });
    const answer = JSON.parse((await read(await server.hostAnswer(ask('/api/screens/host', { token: liveOwner }), real.deps))).text);
    same([answer.available, 'drive' in answer], [true, false], 'the real site, to its real owner, never does');
    const clientText = fs.readFileSync(path.join(ROOT, 'app/lib/screens/host-client.ts'), 'utf8');
    ok(/if \(!host\.drive\) return false;/.test(clientText), "and the browser honours the drive's mark only when the server said so");
  }

  /* ---------------------------------------------------------------- the room's screen choice */
  same(canvas.screenShown(null, false), 'picture', 'no choice, a video: the picture');
  same(canvas.screenShown(null, true), 'canvas', 'no choice, a song: the canvas');
  same(canvas.screenShown({ view: 'canvas', audio: false }, true), 'canvas', 'a canvas choice made for a video does not carry to a song (the default there is the canvas anyway)');
  same(canvas.screenShown({ view: 'picture', audio: true }, false), 'picture', 'as before');
  same(canvas.screenShown({ view: 'screen', audio: false }, false), 'screen', "the PC's screen, chosen");
  same(canvas.screenShown({ view: 'screen', audio: false }, true), 'screen', 'stays chosen when the room goes on to a song');
  same(canvas.screenShown({ view: 'screen', audio: true }, false), 'screen', 'and on to a video');

  /* ---------------------------------------------------------------- the wall between the server's file and the browser's */
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : /\.(ts|tsx)$/.test(entry.name) ? [path.join(dir, entry.name)] : []));
  const files = walk(path.join(ROOT, 'app')).map((file) => ({ file: path.relative(ROOT, file).replace(/\\/g, '/'), text: fs.readFileSync(file, 'utf8') }));
  const importers = files.filter(({ text }) => /from\s+['"][^'"]*screens\/host-server['"]/.test(text) || /from\s+['"]\.\/host-server['"]/.test(text)).map(({ file }) => file);
  same(importers.sort(), ['app/api/screens/host/route.ts', 'app/api/screens/offer/route.ts', 'app/api/screens/settings/route.ts', 'app/lib/screens/device-mail.ts'], 'only the three routes and the devices\' mailbox (itself only for its two routes) import the server file');
  const naming = files.filter(({ text }) => /SCREENS_(OWNER_ID|ENGINE_URL|DEV_OPEN)/.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''))).map(({ file }) => file);
  same(naming, ['app/lib/screens/host-server.ts'], 'and the settings are read in that file alone');
  ok(!files.some(({ text }) => /NEXT_PUBLIC_SCREENS/.test(text)), 'none of it is a NEXT_PUBLIC value');
  const serverText = files.find(({ file }) => file === 'app/lib/screens/host-server.ts').text;
  ok(!/['"]use client['"]/.test(serverText), 'the server file is not a browser file');
  for (const client of ['app/lib/screens/host-client.ts', 'app/lib/screens/session.ts', 'app/lib/screens/connection.ts', 'app/components/RoomScreen.tsx', 'app/components/ScreenToggle.tsx']) {
    const text = files.find(({ file }) => file === client).text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    ok(!/8478|127\.0\.0\.1|localhost/.test(text), `${client} never names the engine's own address: the browser only ever asks the site`);
  }

  console.log(`ok: ${passed} assertions (SCREENS: owner only, this PC only, the dev switch dead in production, the settings sums, CONTROL's bytes, sound, the controller, the PC's pointer, the first key listener)`);
  process.exitCode = 0;
}

main().catch((error) => {
  console.log(`FAIL ${error && error.message ? error.message : error}`);
  process.exit(1);
});
