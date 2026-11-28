/*
 * SCREENS in the site (SPEC-screens.md, phase 3, first slice): the owner's PC screen in his own room. Offline: the
 * only server it talks to is a pretend engine it starts itself on 127.0.0.1.
 *   npx tsc app/api/screens/host/route.ts app/api/screens/offer/route.ts app/api/screens/settings/route.ts app/api/screens/devices/route.ts app/api/screens/mail/route.ts app/api/screens/rdp/route.ts app/lib/screens/rdp-server.ts app/api/screens/site-way/route.ts app/lib/screens/site-way-server.ts app/lib/screens/keysyms.ts app/lib/screens/net-route.ts app/lib/screens/frame-times.ts app/lib/screens/relay-server.ts app/api/screens/ice/route.ts app/api/screens/relay/route.ts app/lib/screens/device-mail.ts app/components/RoomDeviceScreen.tsx app/components/DeviceShareGate.tsx app/lib/screens/wishes.ts app/lib/screens/wire.ts app/lib/screens/key-gate.ts app/components/ScreenKeyGate.tsx app/lib/watch/canvas.ts node_modules/next/types/global.d.ts --outDir Temp/out-screens --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node --jsx react-jsx
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
    // (Two engines since 2026-11-22: the mark counts only when the site said `drive` for one of them.)
    ok(/if \(!hosts\.pc\.drive && !hosts\.server\.drive\) return false;/.test(clientText), "and the browser honours the drive's mark only when the server said so");
  }

  /* ---------------------------------------------------------------- the room's screen choice */
  same(canvas.screenShown(null, false), 'picture', 'no choice, a video: the picture');
  same(canvas.screenShown(null, true), 'canvas', 'no choice, a song: the canvas');
  same(canvas.screenShown({ view: 'canvas', audio: false }, true), 'canvas', 'a canvas choice made for a video does not carry to a song (the default there is the canvas anyway)');
  same(canvas.screenShown({ view: 'picture', audio: true }, false), 'picture', 'as before');
  same(canvas.screenShown({ view: 'screen', audio: false }, false), 'screen', "the PC's screen, chosen");
  same(canvas.screenShown({ view: 'screen', audio: false }, true), 'screen', 'stays chosen when the room goes on to a song');
  same(canvas.screenShown({ view: 'screen', audio: true }, false), 'screen', 'and on to a video');

  /* ---------------------------------------------------------------- the engine on another machine (the site moved to SERVER, 2026-11-22) */
  {
    const KEY = 'k'.repeat(24);
    same(server.engineOrigin({ SCREENS_ENGINE_URL: 'http://192.168.0.30:8478' }), null, 'a home-network engine without the key: refused, as before');
    same(server.engineOrigin({ SCREENS_ENGINE_URL: 'http://192.168.0.30:8478', SCREENS_ENGINE_TOKEN: KEY }), 'http://192.168.0.30:8478', 'with the key: the gaming PC on the home network is reached');
    same(server.engineOrigin({ SCREENS_ENGINE_URL: 'http://10.0.0.5:8478', SCREENS_ENGINE_TOKEN: KEY }), 'http://10.0.0.5:8478', '10.x is a home network too');
    for (const address of ['http://gaming-pc:8478', 'http://8.8.8.8:8478', 'http://172.32.0.1:8478', 'https://192.168.0.30:8478', 'http://192.168.0.30:8478/x', 'http://u:p@192.168.0.30:8478']) {
      same(server.engineOrigin({ SCREENS_ENGINE_URL: address, SCREENS_ENGINE_TOKEN: KEY }), null, `even with the key, not: ${address}`);
    }
    same(server.engineOrigin({ SCREENS_ENGINE_URL: 'http://192.168.0.30:8478', SCREENS_ENGINE_TOKEN: 'short' }), null, 'a key too short to trust is no key');
    const far = world({ ...live, SCREENS_ENGINE_URL: 'http://192.168.0.30:8478', SCREENS_ENGINE_TOKEN: KEY }, { accounts, engine: engineUp });
    const there = JSON.parse((await read(await server.hostAnswer(ask('/api/screens/host', { token: liveOwner }), far.deps))).text);
    same(there.available, true, 'the owner reaches the engine on the gaming PC through the site on SERVER');
    ok(far.seen.engine.every((call) => call.url.startsWith('http://192.168.0.30:8478/') && call.url.includes(`token=${KEY}`)), `the key goes with every request: ${far.seen.engine.map((c) => c.url.replace(KEY, '<key>')).join(' ')}`);
    const stranger = world({ ...live, SCREENS_ENGINE_URL: 'http://192.168.0.30:8478', SCREENS_ENGINE_TOKEN: KEY }, { accounts, engine: engineUp });
    await server.hostAnswer(ask('/api/screens/host', { token: liveOther }), stranger.deps);
    same(stranger.seen.engine.length, 0, 'and nobody else makes the site ask it');

    // Both ways (2026-11-22): THE SERVER's own engine beside THE PC's, named by ?engine=server.
    same(server.engineOrigin({}, 'server'), null, "THE SERVER's engine is off until its address is set (no default)");
    same(server.engineOrigin({ SCREENS_SERVER_ENGINE_URL: 'http://127.0.0.1:8478' }, 'server'), 'http://127.0.0.1:8478', 'set: the engine on the same machine');
    same(server.engineOrigin({ SCREENS_SERVER_ENGINE_URL: 'http://192.168.0.154:8478' }, 'server'), null, 'on another machine only with its own key');
    same(server.engineOrigin({ SCREENS_SERVER_ENGINE_URL: 'http://192.168.0.154:8478', SCREENS_ENGINE_TOKEN: KEY }, 'server'), null, "and THE PC's key is not its key");
    const both = world({ ...live, SCREENS_ENGINE_URL: 'http://192.168.0.30:8478', SCREENS_ENGINE_TOKEN: KEY, SCREENS_SERVER_ENGINE_URL: 'http://127.0.0.1:8478' }, { accounts, engine: engineUp });
    await server.hostAnswer(ask('/api/screens/host?engine=server', { token: liveOwner }), both.deps);
    await server.hostAnswer(ask('/api/screens/host', { token: liveOwner }), both.deps);
    same(both.seen.engine.map((c) => c.url.replace(KEY, '<key>')), ['http://127.0.0.1:8478/settings', 'http://192.168.0.30:8478/settings?token=<key>'], "?engine=server asks THE SERVER's engine (no key on its own machine); nothing added asks THE PC's, with its key");
    same(server.engineOf(new Request('https://debaser.site/api/screens/offer?engine=elsewhere')), 'pc', 'any other name is THE PC');
  }

  /* ---------------------------------------------------------------- the relay for anywhere (Cloudflare TURN), owner only, the key kept on the PC */
  {
    const relay = require(path.join(OUT, 'lib/screens/relay-server.js'));
    const os = require('node:os');
    const keyFile = path.join(os.tmpdir(), `check-screens-relay-${process.pid}.env`);
    fs.rmSync(keyFile, { force: true });
    const KEY_ID = 'ab'.repeat(16);
    const TOKEN = 'secret-token-' + 'x'.repeat(20);
    const asked = [];
    const cloudflare = async (input, init = {}) => {
      asked.push({ url: input, auth: init.headers && init.headers.Authorization, body: init.body });
      return new Response(JSON.stringify({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }, { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u1', credential: 'c1' }] }), { status: 201 });
    };
    const envWith = { ...live, SCREENS_RELAY_FILE: keyFile };
    for (const [who, how] of strangers) {
      const w = world(envWith, { accounts, engine: cloudflare });
      same(JSON.parse((await read(await relay.iceAnswer(ask('/api/screens/ice', how), w.deps))).text), { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], relay: false }, `${who}: STUN only, never the relay`);
      same((await read(await relay.relayAnswer(ask('/api/screens/relay', { ...how, method: 'POST', type: 'application/json', body: JSON.stringify({ keyId: KEY_ID, token: TOKEN }) }), w.deps))).status, 403, `${who} cannot set the relay key`);
    }
    same(asked.length, 0, 'and Cloudflare was never asked for any of them');
    same(JSON.parse((await read(await relay.relayAnswer(ask('/api/screens/relay', { token: liveOwner }), world(live, { accounts }).deps))).text), { set: false, ready: false }, 'no place set on the PC: not ready');
    const w = world(envWith, { accounts, engine: cloudflare });
    same((await read(await relay.relayAnswer(ask('/api/screens/relay', { token: liveOwner, method: 'POST', type: 'application/json', body: JSON.stringify({ keyId: 'nothex', token: TOKEN }) }), w.deps))).status, 400, 'a key id that is not one is refused');
    same(asked.length, 0, 'without asking Cloudflare');
    const saved = await read(await relay.relayAnswer(ask('/api/screens/relay', { token: liveOwner, method: 'POST', type: 'application/json', body: JSON.stringify({ keyId: KEY_ID, token: TOKEN }) }), w.deps));
    same(JSON.parse(saved.text), { set: true }, 'the owner sets the relay key');
    ok(!saved.text.includes(TOKEN), 'and the answer never carries the token');
    same([asked[0].url, asked[0].auth, JSON.parse(asked[0].body).ttl], [`https://rtc.live.cloudflare.com/v1/turn/keys/${KEY_ID}/credentials/generate-ice-servers`, `Bearer ${TOKEN}`, 60], 'it was tried with Cloudflare first (a 60-second pass)');
    ok(fs.readFileSync(keyFile, 'utf8').includes(`RELAY_KEY_ID=${KEY_ID}`), 'and kept in the file on the PC');
    relay.forgetPasses();
    const ice1 = JSON.parse((await read(await relay.iceAnswer(ask('/api/screens/ice', { token: liveOwner }), w.deps))).text);
    const ice2 = JSON.parse((await read(await relay.iceAnswer(ask('/api/screens/ice', { token: liveOwner }), w.deps))).text);
    same(ice1.relay, true, 'the owner gets relay passes');
    same(ice1.iceServers[1].urls, ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], 'port 53 (blocked by browsers) is left out');
    same([asked.length, JSON.parse(asked[1].body).ttl, ice2.iceServers[1].credential], [2, 86400, 'c1'], 'one 24-hour pass from Cloudflare, kept and handed out again');
    same(relay.iceServersFrom({ iceServers: [{ urls: ['turn:x:3478'] }] }), null, 'relay addresses without a username and credential are no passes');
    fs.rmSync(keyFile, { force: true });
    relay.forgetPasses();
  }

  /* ---------------------------------------------------------------- the server by Remote Desktop: owner only, a pass the gateway takes */
  {
    const rdp = require(path.join(OUT, 'lib/screens/rdp-server.js'));
    const keys = require(path.join(OUT, 'lib/screens/keysyms.js'));
    const gateway = require(path.join(ROOT, 'scripts/host/rdp-gateway.cjs'));
    const SECRET = 'a'.repeat(24) + 'b'.repeat(24);
    const switches = [];
    let gatewayOn = true;
    const healthy = async (input, init = {}) => {
      if (input.endsWith('/switch')) {
        switches.push({ headers: init.headers, body: init.body });
        return new Response(JSON.stringify({ on: JSON.parse(init.body).on }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, serverSet: true, passesSet: true, on: gatewayOn, locked: true }), { status: 200 });
    };
    const env = { ...live, SCREENS_RDP_SECRET: SECRET };
    for (const [who, how] of strangers) {
      const w = world(env, { accounts, engine: healthy });
      same(JSON.parse((await read(await rdp.rdpAnswer(ask('/api/screens/rdp', how), w.deps))).text), { available: false }, `Remote Desktop, ${who}: not available`);
      same((await read(await rdp.rdpAnswer(ask('/api/screens/rdp', { ...how, method: 'POST', type: 'application/json', body: '{}' }), w.deps))).status, 403, `Remote Desktop, ${who}: no pass`);
      same(w.seen.engine.length, 0, `and the gateway is never asked for ${who}`);
    }
    const w = world(env, { accounts, engine: healthy });
    const said = await read(await rdp.rdpAnswer(ask('/api/screens/rdp', { token: liveOwner }), w.deps));
    same(JSON.parse(said.text), { available: true, serverSet: true, on: true, locked: true, route: 'tunnel', socket: '/api/screens/rdp-socket', door: '/api/screens/rdp-door' }, 'the owner: there, switched on, locked, through the tunnel route on the site itself');
    same(said.kept, 'private, no-store', 'never kept');
    same(w.seen.engine[0].url, 'http://127.0.0.1:8479/health', 'the gateway asked on this PC');
    const passed1 = JSON.parse((await read(await rdp.rdpAnswer(ask('/api/screens/rdp', { token: liveOwner, method: 'POST', type: 'application/json', body: '{"width":3440,"height":1440,"dpi":120}' }), w.deps))).text);
    same(gateway.passIsGood(passed1.pass, SECRET, world.now), { width: 3440, height: 1440, dpi: 120 }, "the gateway takes the owner's pass, with the view's size");
    same(gateway.passIsGood(passed1.pass, SECRET, world.now), null, 'once');
    const passed2 = JSON.parse((await read(await rdp.rdpAnswer(ask('/api/screens/rdp', { token: liveOwner, method: 'POST', type: 'application/json', body: '{}' }), w.deps))).text);
    same(gateway.passIsGood(passed2.pass, SECRET, world.now + 61_000), null, 'and not after a minute');
    same(gateway.passIsGood(passed2.pass, 'c'.repeat(48), world.now), null, 'nor with another secret');
    same(gateway.passIsGood(passed2.pass.replace(/^./, (c) => (c === 'e' ? 'f' : 'e')), SECRET, world.now), null, 'nor changed');
    same(JSON.parse((await read(await rdp.rdpAnswer(ask('/api/screens/rdp', { token: liveOwner }), world({ ...live, SCREENS_RDP_SECRET: 'short' }, { accounts, engine: healthy }).deps))).text), { available: false }, 'a secret too short to trust: off');
    same(JSON.parse((await read(await rdp.rdpAnswer(ask('/api/screens/rdp', { token: liveOwner }), world(env, { accounts }).deps))).text), { available: false }, 'no gateway answering: not there');
    // The server remote's own switch, through the site, signed with the shared secret.
    const switchedOff = JSON.parse((await read(await rdp.rdpAnswer(ask('/api/screens/rdp', { token: liveOwner, method: 'POST', type: 'application/json', body: '{"switch":false}' }), w.deps))).text);
    same(switchedOff.on, false, 'the owner switches the server remote off');
    const sent = switches[switches.length - 1];
    ok(gateway.switchIsSigned({ headers: { 'x-debaser-at': sent.headers['X-Debaser-At'], 'x-debaser-sign': sent.headers['X-Debaser-Sign'] } }, false, SECRET, world.now), 'and the gateway takes the signed switch');
    same(gateway.switchIsSigned({ headers: { 'x-debaser-at': sent.headers['X-Debaser-At'], 'x-debaser-sign': sent.headers['X-Debaser-Sign'] } }, true, SECRET, world.now), false, 'but not the same signature for the other way');
    same(gateway.switchIsSigned({ headers: { 'x-debaser-at': sent.headers['X-Debaser-At'], 'x-debaser-sign': sent.headers['X-Debaser-Sign'] } }, false, SECRET, world.now + 61_000), false, 'nor a minute later');
    for (const [who, how] of strangers) {
      const before = switches.length;
      same((await read(await rdp.rdpAnswer(ask('/api/screens/rdp', { ...how, method: 'POST', type: 'application/json', body: '{"switch":true}' }), world(env, { accounts, engine: healthy }).deps))).status, 403, `${who} cannot switch it`);
      same(switches.length, before, `and nothing reached the gateway for ${who}`);
    }
    // The SERVER SIGN-IN form: owner only, passed on signed over its exact body, nothing kept by the site.
    const setups = [];
    const savingGateway = async (input, init = {}) => {
      if (input.endsWith('/setup')) {
        setups.push({ headers: init.headers, body: init.body });
        return new Response(JSON.stringify({ serverSet: true }), { status: 200 });
      }
      return healthy(input, init);
    };
    const formBody = '{"setup":{"host":"192.168.0.129","user":"someone","password":"not-a-real-one"}}';
    const savedAnswer = await read(await rdp.rdpAnswer(ask('/api/screens/rdp', { token: liveOwner, method: 'POST', type: 'application/json', body: formBody }), world(env, { accounts, engine: savingGateway }).deps));
    same(savedAnswer.status, 200, 'the owner saves the server sign-in');
    ok(!savedAnswer.text.includes('not-a-real-one'), 'the answer never carries the password back');
    const passedOn = setups[setups.length - 1];
    ok(gateway.setupIsSigned({ headers: { 'x-debaser-at': passedOn.headers['X-Debaser-At'], 'x-debaser-sign': passedOn.headers['X-Debaser-Sign'] } }, passedOn.body, SECRET, world.now), 'the gateway takes the signed sign-in');
    same(gateway.setupIsSigned({ headers: { 'x-debaser-at': passedOn.headers['X-Debaser-At'], 'x-debaser-sign': passedOn.headers['X-Debaser-Sign'] } }, passedOn.body.replace('someone', 'someone-else'), SECRET, world.now), false, 'but not a changed body under the same signature');
    for (const [who, how] of strangers) {
      const before = setups.length;
      same((await read(await rdp.rdpAnswer(ask('/api/screens/rdp', { ...how, method: 'POST', type: 'application/json', body: formBody }), world(env, { accounts, engine: savingGateway }).deps))).status, 403, `${who} cannot set the server sign-in`);
      same(setups.length, before, `and nothing reached the gateway for ${who}`);
    }
    same(gateway.setupLines('{"password":"x\\nRDP_HOST=evil"}'), null, 'a password with a line break is refused (it could not slip in another setting)');
    same(gateway.setupLines('{"host":"a b"}'), null, 'an address is a name or a number');
    same(gateway.setupLines('{"user":"u","password":""}'), { RDP_USER: 'u' }, 'an empty field leaves that line as it was');
    same(gateway.withSetting('A=1\nRDP_USER=old\nB=2\n', 'RDP_USER', 'new'), 'A=1\nRDP_USER=new\nB=2\n', 'a line is changed where it stands, the others kept');

    gatewayOn = false;
    same((await read(await rdp.rdpAnswer(ask('/api/screens/rdp', { token: liveOwner, method: 'POST', type: 'application/json', body: '{}' }), w.deps))).status, 409, 'switched off: no pass, even for the owner');
    gatewayOn = true;

    // The extra lock: Cloudflare Access's token, checked by the gateway with the team's key (a made-up key here).
    const crypto = require('node:crypto');
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1' };
    const lock = { team: 'debaser', aud: 'a'.repeat(64) };
    const token = (claims, key = privateKey, kid = 'k1') => {
      const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid })).toString('base64url');
      const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
      return `${head}.${body}.${crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url')}`;
    };
    const accessKeys = async () => [jwk];
    const good = { aud: [lock.aud], iss: 'https://debaser.cloudflareaccess.com', exp: world.now / 1000 + 600 };
    same(await gateway.accessIsGood(token(good), lock, world.now, accessKeys), true, "Access's own token lets the request through");
    same(await gateway.accessIsGood(token({ ...good, aud: ['another-app'] }), lock, world.now, accessKeys), false, "not another application's");
    same(await gateway.accessIsGood(token({ ...good, iss: 'https://elsewhere.cloudflareaccess.com' }), lock, world.now, accessKeys), false, "not another team's");
    same(await gateway.accessIsGood(token({ ...good, exp: world.now / 1000 - 1 }), lock, world.now, accessKeys), false, 'not an expired one');
    same(await gateway.accessIsGood(token(good, crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey), lock, world.now, accessKeys), false, 'not one signed by any other key');
    same(await gateway.accessIsGood('', lock, world.now, accessKeys), false, 'not none');
    same(gateway.viaCloudflare({ headers: { 'cf-connecting-ip': '203.0.113.9' } }), true, 'a request through the tunnel is known by the header Cloudflare adds');
    same(gateway.viaCloudflare({ headers: {} }), false, 'and one without it came from this PC itself');

    // The readout's per-frame times (frame-times.ts): over the last few seconds, not since the start, and the
    // browser's "wait in buffer" split into the frame's packets arriving and the browser holding it.
    const times = require(path.join(OUT, 'lib/screens/frame-times.js'));
    const reading = (at, frames, buffer, assembly) => ({ at, decoded: frames, emitted: frames, buffer, assembly, processing: frames * 0.002, decode: frames * 0.001 });
    let kept = [];
    let t = times.frameTimes(kept, reading(1000, 60, 1.2, 0.6)); // a slow start: 20 ms a frame, 10 of it arriving
    kept = t.recent;
    same([Math.round(t.bufferMs), Math.round(t.arrivingMs), Math.round(t.heldMs)], [20, 10, 10], 'the first reading is the average since the start');
    for (let s = 2; s <= 6; s++) {
      // From then on 2 ms a frame in the buffer, 1.5 of it the packets arriving.
      t = times.frameTimes(kept, reading(s * 1000, 60 * s, 1.2 + 0.12 * (s - 1), 0.6 + 0.09 * (s - 1)));
      kept = t.recent;
    }
    same([t.bufferMs.toFixed(1), t.arrivingMs.toFixed(1), t.heldMs.toFixed(1), t.decodeMs.toFixed(1)], ['2.0', '1.5', '0.5', '1.0'], 'a few seconds on, the slow start no longer counts: the numbers are what is happening now');
    ok(kept.length <= 5 && kept[kept.length - 1].at - kept[0].at <= times.RECENT_MS + 1000, 'and only a few seconds of readings are kept');
    t = times.frameTimes(kept, reading(7000, 30, 0.03, 0.015));
    same([t.recent.length, t.bufferMs.toFixed(1)], [1, '1.0'], 'a new connection (totals smaller than before) starts the sums again');
    t = times.frameTimes([], { ...reading(1000, 60, 0.6, null), assembly: null });
    same([t.bufferMs.toFixed(1), t.arrivingMs, t.heldMs], ['10.0', null, null], 'a browser that does not say when the packets arrived shows only the total');

    // Which way each connection goes, said plainly.
    const route = require(path.join(OUT, 'lib/screens/net-route.js'));
    same(['192.168.1.20', '10.0.0.4', '172.20.1.1', '127.0.0.1', '203.0.113.9', 'fd12:3456::1'].map((a) => route.routeOfCandidate(a, 'host')), ['lan', 'lan', 'lan', 'this-pc', 'internet', 'lan'], 'home addresses read as the home network, the PC itself as this PC, others as the internet');
    same(route.routeOfCandidate('203.0.113.9', 'relay'), 'relay', 'a relayed path says so');
    ok(/HOME NETWORK/.test(route.ROUTE_WORDS.lan.label) && /CLOUDFLARE TUNNEL/.test(route.ROUTE_WORDS.tunnel.label) && /no port/.test(route.ROUTE_WORDS.tunnel.tip), 'the words name the home network and the tunnel, and say no port is opened');

    // The router port the engine opens by itself (Luke, 2026-11-28: "Yes, automatically"): said where it is used, and only there.
    const withPort = (routerPort) => wishes.hostSettingsFrom({ ...ENGINE_SAYS, routerPort });
    const opened = withPort({ state: 'open', outsidePort: 57295, why: null });
    const refused = withPort({ state: 'not given', outsidePort: null, why: 'the router refused (HTTP 500, error 606: Action not authorized)' });
    same([wishes.openRouterPort(opened), wishes.openRouterPort(refused), wishes.openRouterPort(wishes.hostSettingsFrom(ENGINE_SAYS)), wishes.openRouterPort(null)], [57295, null, null, null], 'the open port is read from the PC\'s answer, and is nothing when it was refused, never asked for, or unknown');
    same([withPort({ state: 'open', outsidePort: null, why: null }).routerPort, withPort({ state: 'open', outsidePort: 70000, why: null }).routerPort, withPort({ state: 'wide open' }).routerPort, withPort('open').routerPort], [null, null, null, null], 'an answer that says open without a real port, or says something else, counts as no answer');
    same(
      [route.routeThroughRouterPort('internet', 57295, 57295), route.routeThroughRouterPort('internet', 40112, 57295), route.routeThroughRouterPort('internet', 57295, null), route.routeThroughRouterPort('lan', 57295, 57295), route.routeThroughRouterPort('relay', 57295, 57295), route.routeThroughRouterPort(null, null, 57295)],
      ['internet-port', 'internet', 'internet', 'lan', 'relay', null],
      'only a direct path over the internet that ends at the opened port is said to go through it',
    );
    ok(/ROUTER PORT OPENED BY THE ENGINE/.test(route.ROUTE_WORDS['internet-port'].label) && /gives it back/.test(route.ROUTE_WORDS['internet-port'].tip), 'that route says the engine opened the port and gives it back');
    ok(!/no port (is )?opened on the router/i.test(route.DIRECT_WORDS.tip + route.ROUTE_WORDS.lan.tip), 'and nothing still says no port is ever opened on the router');
    same(wishes.routerPortSays(wishes.hostSettingsFrom(ENGINE_SAYS)), null, 'an engine never told to ask the router says nothing about a port');
    ok(/^ROUTER PORT: OPEN \(57295\)\n/.test(wishes.routerPortSays(opened)) && /gives it back when it stops/.test(wishes.routerPortSays(opened)), 'an open port is named, with how long it is held');
    ok(/^ROUTER PORT: NOT GIVEN\n/.test(wishes.routerPortSays(refused)) && wishes.routerPortSays(refused).includes('error 606: Action not authorized') && /Nothing is open on the router/.test(wishes.routerPortSays(refused)), 'a refusal is said with the router\'s own answer, and that nothing is open');
    ok(/^ROUTER PORT: NOT ASKED YET\n/.test(wishes.routerPortSays(withPort({ state: 'not asked', outsidePort: null, why: null }))), 'and before the engine has asked, that is said');

    same(rdp.gatewayOrigin({ SCREENS_RDP_GATEWAY_URL: 'http://192.168.1.20:8479' }), null, 'a gateway on another machine is refused');
    same(rdp.socketAddress({ SCREENS_RDP_SOCKET_URL: 'javascript:alert(1)' }), '/api/screens/rdp-socket', 'a socket address that is not one is ignored');
    same(rdp.sizeFrom('{"width":99999,"height":-4}'), { width: 7680, height: 240, dpi: 96 }, 'the size asked for is kept to what a screen can be');
    same([keys.keysymOf({ key: 'a', code: 'KeyA' }), keys.keysymOf({ key: 'A', code: 'KeyA' }), keys.keysymOf({ key: 'Escape', code: 'Escape' }), keys.keysymOf({ key: 'Shift', code: 'ShiftRight' }), keys.keysymOf({ key: 'F12', code: 'F12' }), keys.keysymOf({ key: '€', code: 'KeyE' }), keys.keysymOf({ key: '7', code: 'Numpad7' }), keys.keysymOf({ key: 'Unidentified', code: '' })], [0x61, 0x41, 0xff1b, 0xffe2, 0xffc9, 0x010020ac, 0xffb7, null], 'keys as the numbers Guacamole sends');
  }

  /* ---------------------------------------------------------------- the wall between the server's file and the browser's */
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : /\.(ts|tsx)$/.test(entry.name) ? [path.join(dir, entry.name)] : []));
  const files = walk(path.join(ROOT, 'app')).map((file) => ({ file: path.relative(ROOT, file).replace(/\\/g, '/'), text: fs.readFileSync(file, 'utf8') }));
  const importers = files.filter(({ text }) => /from\s+['"][^'"]*screens\/host-server['"]/.test(text) || /from\s+['"]\.\/host-server['"]/.test(text)).map(({ file }) => file);
  // (2026-11-23) BROWSER's gate and its routes too (SPEC-seeing-machine.md): the owner's account is the same one setting, and its session is
  // checked the same way. They sit on the server's side of the same wall (check-web-types.cjs), and take nothing of the engine's.
  same(importers.sort(), ['app/api/screens/host/route.ts', 'app/api/screens/offer/route.ts', 'app/api/screens/settings/route.ts', 'app/lib/screens/device-mail.ts', 'app/lib/screens/rdp-server.ts', 'app/lib/screens/relay-server.ts', 'app/lib/screens/site-way-server.ts', 'app/lib/seeing/server/gate.ts', 'app/lib/seeing/server/open.ts'], 'only the three routes, the devices\' mailbox, the Remote Desktop rules and the way through the site (each only for its own routes) import the server file');
  const naming = files.filter(({ text }) => /SCREENS_(OWNER_ID|ENGINE_URL|DEV_OPEN)/.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''))).map(({ file }) => file);
  same(naming, ['app/lib/screens/host-server.ts'], 'and the settings are read in that file alone');
  ok(!files.some(({ text }) => /NEXT_PUBLIC_SCREENS/.test(text)), 'none of it is a NEXT_PUBLIC value');
  const serverText = files.find(({ file }) => file === 'app/lib/screens/host-server.ts').text;
  ok(!/['"]use client['"]/.test(serverText), 'the server file is not a browser file');
  for (const client of ['app/lib/screens/host-client.ts', 'app/lib/screens/session.ts', 'app/lib/screens/connection.ts', 'app/components/RoomScreen.tsx', 'app/components/ScreenToggle.tsx', 'app/components/RoomRdpScreen.tsx', 'app/lib/screens/rdp-client.ts']) {
    const text = files.find(({ file }) => file === client).text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    ok(!/8478|127\.0\.0\.1|localhost/.test(text), `${client} never names the engine's own address: the browser only ever asks the site`);
  }

  /* ---------------------------------------------------------------- the way THROUGH THE SITE: its gate, and HIDDEN */
  {
    const siteWay = require(path.join(ROOT, 'scripts/host/screens-site-gateway.cjs'));
    same([siteWay.originIsOurs('https://debaser.site'), siteWay.originIsOurs('http://127.0.0.1:3391'), siteWay.originIsOurs('http://localhost:3000')], [true, true, true], 'the site-way gateway takes a browser on the site\'s own page, or on this PC');
    same([siteWay.originIsOurs('https://debaser.site.example.com'), siteWay.originIsOurs('https://example.com'), siteWay.originIsOurs('http://debaser.site'), siteWay.originIsOurs('null'), siteWay.originIsOurs('http://127.0.0.1.example.com')], [false, false, false, false, false], 'and no other page, however like the site\'s its name is');
    const words = 'a'.repeat(32);
    same([siteWay.wordsMatch(words, words), siteWay.wordsMatch(`${words}b`, words), siteWay.wordsMatch(undefined, words), siteWay.wordsMatch('', ''), siteWay.wordsMatch('short', 'short'), siteWay.wordsMatch(words, undefined)], [true, false, false, false, false, false], 'the one-time words must be said whole, and words too short to be a secret open nothing');
    const frame = siteWay.madeUpFrame(siteWay.KIND.frame, 77, 1234.5);
    const full = siteWay.madeUpFrame(siteWay.KIND.fullPicture, 78, 1250.25);
    same([frame.length, frame[0], frame.readUInt32BE(1), frame.readDoubleBE(5), full.length, full[0], full.readUInt32BE(1), full.readDoubleBE(5)], [siteWay.FRAME_BYTES, 1, 77, 1234.5, siteWay.FULL_PICTURE_BYTES, 2, 78, 1250.25], 'a made-up frame carries its number and the moment it left, at the size of a real one');
    same(siteWay.FRAME_BYTES * 60 * 8, 3_500_160, 'sixty of them a second are the cap: 3.5 Mbit/s');
    const wordless = require('node:child_process').spawnSync(process.execPath, [path.join(ROOT, 'scripts/host/screens-site-gateway.cjs'), '--gate'], { encoding: 'utf8', timeout: 20000, env: { ...process.env, SITE_WAY_GATE_PASS: 'too-short' } });
    same(wordless.status, 2, 'and the gate does not start without that run\'s own words');
    const config = fs.readFileSync(path.join(ROOT, 'next.config.ts'), 'utf8');
    ok(config.includes(`{ source: '${siteWay.PATH}', destination: 'http://127.0.0.1:${siteWay.PORT}${siteWay.PATH}' }`), 'the site passes the socket\'s one address to the gateway\'s own port on this PC, and nothing else');
    same((config.match(/destination: 'http:\/\/127\.0\.0\.1/g) || []).length, 1, 'that is the only address the site passes along to this PC');
    // Luke, 2026-11-28: "Wait until sound works too". Until picture, control and sound all work, no page may ask for it:
    // the socket's address is named by the server's own file alone, that file is used by its one route alone, and no
    // file anywhere in the site names the route.
    same(files.filter(({ text }) => /site-socket/.test(text)).map(({ file }) => file), ['app/lib/screens/site-way-server.ts'], 'HIDDEN: only the server\'s own file names the socket of the way through the site');
    same(files.filter(({ text }) => /site-way-server/.test(text)).map(({ file }) => file), ['app/api/screens/site-way/route.ts'], 'HIDDEN: only its one route uses that file');
    same(files.filter(({ file, text }) => /screens\/site-way(?!-server)/.test(text) && !['app/api/screens/site-way/route.ts', 'app/lib/screens/site-way-server.ts'].includes(file)).map(({ file }) => file), [], 'HIDDEN: no page, component or browser file asks that route');
    ok(!/['"]use client['"]/.test(files.find(({ file }) => file === 'app/lib/screens/site-way-server.ts').text), 'and the file is not a browser file');
  }

  /* ---------------------------------------------------------------- the way THROUGH THE SITE: the pass, the allowance, the rules of the line */
  {
    const net = require('node:net');
    const os = require('node:os');
    const { spawn, spawnSync } = require('node:child_process');
    const siteWay = require(path.join(ROOT, 'scripts/host/screens-site-gateway.cjs'));
    const siteServer = require(path.join(OUT, 'lib/screens/site-way-server.js'));
    const rdp = require(path.join(OUT, 'lib/screens/rdp-server.js'));
    const rdpGateway = require(path.join(ROOT, 'scripts/host/rdp-gateway.cjs'));
    const GATEWAY_FILE = path.join(ROOT, 'scripts/host/screens-site-gateway.cjs');
    const SECRET = 'c'.repeat(24) + 'd'.repeat(24);
    const KEY = 'pretend-engine-key-0123456789';
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'debaser-site-way-'));
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const until = async (what, ms = 6000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (what()) return true;
        await sleep(20);
      }
      return false;
    };

    // The pass: the site's own, taken once, for a minute, by this gateway alone.
    const now = 1_800_000_000_000;
    const pass = siteServer.makeSitePass(SECRET, now);
    same(siteWay.passIsGood(pass, SECRET, new Map(), now), true, "the gateway takes the site's pass");
    {
      const used = new Map();
      same([siteWay.passIsGood(pass, SECRET, used, now), siteWay.passIsGood(pass, SECRET, used, now + 1000)], [true, false], 'once');
    }
    same(siteWay.passIsGood(pass, SECRET, new Map(), now + 61_000), false, 'and not after a minute');
    same(siteWay.passIsGood(pass, 'e'.repeat(48), new Map(), now), false, 'nor with another secret');
    same(siteWay.passIsGood(pass.replace(/^./, (c) => (c === 'e' ? 'f' : 'e')), SECRET, new Map(), now), false, 'nor changed');
    same([siteWay.passIsGood(undefined, SECRET, new Map(), now), siteWay.passIsGood('', SECRET, new Map(), now), siteWay.passIsGood(`${pass}.x`, SECRET, new Map(), now), siteWay.passIsGood(pass, null, new Map(), now)], [false, false, false, false], 'nor nothing, nor with a part added, nor when no secret is set');
    same(siteWay.passIsGood(siteWay.makePass(SECRET, now), SECRET, new Map(), now), true, "(the gateway's own copy of the recipe makes the same kind of pass)");
    const rdpPass = rdp.makePass(SECRET, { width: 1920, height: 1080, dpi: 96 }, now);
    same(siteWay.passIsGood(rdpPass, SECRET, new Map(), now), false, 'a Remote Desktop pass, signed with the very same secret, opens nothing here');
    same(rdpGateway.passIsGood(pass, SECRET, now), null, 'and a pass for this way opens nothing at the Remote Desktop gateway');
    // A pass that says the right things but was signed the Remote Desktop way (no words of this way's own mixed in).
    {
      const body = Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + 60, nonce: 'abcdefghijkl', way: 'site' })).toString('base64url');
      const plain = `${body}.${require('node:crypto').createHmac('sha256', SECRET).update(body).digest('base64url')}`;
      same(siteWay.passIsGood(plain, SECRET, new Map(), now), false, 'the signature is over this way\'s own words, so the claim alone is not enough');
    }

    // Where the engine is: this PC, or a home-network number WITH the key; nothing else.
    same(siteWay.engineAddress({ SCREENS_ENGINE_URL: 'http://192.168.0.30:8478', SCREENS_ENGINE_TOKEN: KEY }), { host: '192.168.0.30', port: 8478, key: KEY }, 'the engine on the home network, with its key');
    same(siteWay.engineAddress({ SCREENS_ENGINE_URL: 'http://192.168.0.30:8478' }), null, 'the same address without a key: refused');
    same(siteWay.engineAddress({}), { host: '127.0.0.1', port: 8478, key: null }, 'nothing set: this PC itself');
    for (const address of ['http://8.8.8.8:8478', 'https://192.168.0.30:8478', 'http://debaser.site:8478', 'http://192.168.0.30:8478/site', 'http://user:pass@192.168.0.30:8478', 'http://192.168.0.30.example.com:8478', 'not an address']) {
      same(siteWay.engineAddress({ SCREENS_ENGINE_URL: address, SCREENS_ENGINE_TOKEN: KEY }), null, `not an engine's address: ${address}`);
    }

    // The month's allowance: one small file, 20 GB and never more.
    same([siteWay.MONTH_LIMIT_BYTES, siteWay.limitFrom(undefined), siteWay.limitFrom('99000000000'), siteWay.limitFrom('-5'), siteWay.limitFrom('5000')], [20_000_000_000, 20_000_000_000, 20_000_000_000, 20_000_000_000, 5000], 'the limit is 20 GB; a check may ask for less, nothing can ask for more');
    same([siteWay.monthOf(new Date(2026, 10, 28)), siteWay.monthOf(new Date(2027, 0, 1))], ['2026-11', '2027-01'], "the month is the server's own calendar's");
    {
      const file = path.join(folder, 'count.json');
      let today = new Date(2026, 10, 28);
      const first = siteWay.usageIn(file, 1000, () => today);
      same(first.says(), { name: '2026-11', usedBytes: 0, limitBytes: 1000 }, 'no file yet: nothing used');
      first.add(400);
      same([first.left(), first.save(), JSON.parse(fs.readFileSync(file, 'utf8')).bytes, JSON.parse(fs.readFileSync(file, 'utf8')).month], [600, true, 400, '2026-11'], 'what is used is written to the file');
      const second = siteWay.usageIn(file, 1000, () => today);
      second.add(700);
      same([second.says().usedBytes, second.left()], [1100, 0], 'a gateway started again carries on from the file, and past the limit nothing is left');
      second.save();
      today = new Date(2026, 11, 1);
      same([second.says(), second.left()], [{ name: '2026-12', usedBytes: 0, limitBytes: 1000 }, 1000], 'a new month starts from nothing, with no restart');
      same(siteWay.usageIn(file, 1000, () => today).says().usedBytes, 0, "and last month's file is not this month's count");
      fs.writeFileSync(file, 'not a count');
      same(siteWay.usageIn(file, 1000, () => today).says().usedBytes, 0, 'a file that cannot be read counts as nothing used (said in the SPEC: a lost file restarts the month)');
      same(siteWay.usageIn(path.join(folder, 'no-such-folder', 'count.json'), 1000, () => today).save(), false, 'a count that cannot be written says so');
    }

    // The engine's line: messages whole, however the bytes arrive.
    {
      const a = siteWay.lineMessage(siteWay.KIND.fullPicture, Buffer.from('picture'));
      const b = siteWay.lineMessage(siteWay.KIND.stillWatching);
      same([a.readUInt32BE(0), a[4], a.subarray(5).toString(), b.length, b.readUInt32BE(0), b[4]], [8, 2, 'picture', 5, 1, 19], 'a message: how long the rest is, what it is, its contents');
      const read = siteWay.lineReader();
      const all = Buffer.concat([a, b, a]);
      const got = [];
      for (let at = 0; at < all.length; at += 3) for (const message of read(all.subarray(at, at + 3))) got.push([message.kind, message.contents.toString()]);
      same(got, [[2, 'picture'], [19, ''], [2, 'picture']], 'read back whole, three bytes at a time');
      const tooLong = Buffer.alloc(4);
      tooLong.writeUInt32BE(5 * 1024 * 1024, 0);
      assert.throws(() => siteWay.lineReader()(tooLong), /not the engine/);
      passed += 1;
      const header = siteWay.browserHeader(siteWay.KIND.sound, 41, 1234.5);
      same([header.length, header[0], header.readUInt32BE(1), header.readDoubleBE(5)], [13, 3, 41, 1234.5], "what the browser gets in front: what it is, its number, when it left the gateway");
    }

    // Never queueing: what happens to a frame, from how the viewer stands.
    {
      const viewer = () => ({ needFull: true, catchingUp: false, catchingUpSince: 0, lastSent: 0, got: 0, heardOf: false });
      const v = viewer();
      same(siteWay.frameRule(v, siteWay.KIND.frame, 0), { what: 'skip', ask: true }, 'a viewer starts from a full picture: an ordinary frame first is skipped, and a full picture asked for');
      same([siteWay.frameRule(v, siteWay.KIND.fullPicture, 0), v.needFull], [{ what: 'send', ask: false }, false], 'the full picture is sent');
      same(siteWay.frameRule(v, siteWay.KIND.frame, 1000), { what: 'send', ask: false }, 'and the frames after it');
      same([siteWay.frameRule(v, siteWay.KIND.frame, siteWay.BACKED_UP_BYTES + 1), v.needFull], [{ what: 'skip', ask: false }, true], 'a backed-up line: the frame is skipped, not kept');
      same(siteWay.frameRule(v, siteWay.KIND.fullPicture, siteWay.BACKED_UP_BYTES + 1), { what: 'skip', ask: false }, 'even a full picture is not put on a backed-up line');
      same(siteWay.frameRule(v, siteWay.KIND.frame, 0), { what: 'skip', ask: true }, 'cleared: still nothing until a full picture, which is asked for');
      same(siteWay.frameRule(v, siteWay.KIND.fullPicture, 0), { what: 'send', ask: false }, 'and from that it carries on');
      const behind = { ...viewer(), needFull: false, heardOf: true, lastSent: 100, got: 100 - siteWay.TOO_FAR_BEHIND - 1 };
      same([siteWay.frameRule(behind, siteWay.KIND.frame, 0), behind.catchingUp], [{ what: 'skip', ask: false }, true], 'a browser too far behind is sent nothing');
      same(siteWay.frameRule(behind, siteWay.KIND.fullPicture, 0), { what: 'skip', ask: false }, 'not even a full picture, until it has caught up');
      behind.got = 99;
      same([siteWay.frameRule(behind, siteWay.KIND.frame, 0), behind.catchingUp, behind.needFull], [{ what: 'skip', ask: true }, false, true], 'caught up: a full picture is asked for');
      same(siteWay.frameRule(behind, siteWay.KIND.fullPicture, 0), { what: 'send', ask: false }, 'and it starts again from that');
      const silent = { ...viewer(), needFull: false, heardOf: false, lastSent: 500, got: 0 };
      same(siteWay.frameRule(silent, siteWay.KIND.frame, 0), { what: 'send', ask: false }, 'a browser that has not said where it is yet is not called behind (the backed-up rule still holds it)');
    }

    // The site's route: the owner alone, and what the gateway itself says.
    {
      const month = { name: '2026-11', usedBytes: 1_500_000_000, limitBytes: 20_000_000_000 };
      const health = (more = {}) => async () => new Response(JSON.stringify({ ok: true, gate: false, engineSet: true, passesSet: true, viewers: 0, month, ...more }), { status: 200 });
      const env = { ...live, SCREENS_RDP_SECRET: SECRET };
      for (const [who, how] of strangers) {
        const w = world(env, { accounts, engine: health() });
        same(JSON.parse((await read(await siteServer.siteWayAnswer(ask('/api/screens/site-way', how), w.deps))).text), { available: false }, `through the site, ${who}: not available`);
        same((await read(await siteServer.siteWayAnswer(ask('/api/screens/site-way', { ...how, method: 'POST' }), w.deps))).status, 403, `through the site, ${who}: no pass`);
        same(w.seen.engine.length, 0, `and the gateway is never asked for ${who}`);
      }
      const w = world(env, { accounts, engine: health() });
      const said = await read(await siteServer.siteWayAnswer(ask('/api/screens/site-way', { token: liveOwner }), w.deps));
      same(JSON.parse(said.text), { available: true, usedUp: false, month, socket: '/api/screens/site-socket' }, "the owner: there, with the month as the gateway counts it");
      same([said.kept, w.seen.engine[0].url], ['private, no-store', 'http://127.0.0.1:8481/health'], 'never kept; the gateway asked on this PC');
      const handed = await read(await siteServer.siteWayAnswer(ask('/api/screens/site-way', { token: liveOwner, method: 'POST' }), w.deps));
      same([handed.status, JSON.parse(handed.text).socket, siteWay.passIsGood(JSON.parse(handed.text).pass, SECRET, new Map(), world.now)], [200, '/api/screens/site-socket', true], 'the owner is handed a pass the gateway takes');
      ok(!handed.text.includes(SECRET) && !said.text.includes(SECRET), 'the secret itself is never in an answer');
      const full = world(env, { accounts, engine: health({ month: { ...month, usedBytes: month.limitBytes } }) });
      same(JSON.parse((await read(await siteServer.siteWayAnswer(ask('/api/screens/site-way', { token: liveOwner }), full.deps))).text).usedUp, true, 'the month used up: said');
      const refused = await read(await siteServer.siteWayAnswer(ask('/api/screens/site-way', { token: liveOwner, method: 'POST' }), full.deps));
      same([refused.status, 'pass' in JSON.parse(refused.text)], [409, false], 'and no pass is handed out, even to the owner');
      const answers = async (deps, method) => read(await siteServer.siteWayAnswer(ask('/api/screens/site-way', { token: liveOwner, method }), deps));
      same(JSON.parse((await answers(world(env, { accounts, engine: health({ gate: true }) }).deps, 'GET')).text), { available: false }, 'the measuring gateway (made-up frames) is not this way');
      same((await answers(world(env, { accounts, engine: health({ gate: true }) }).deps, 'POST')).status, 502, 'and gets no pass');
      same(JSON.parse((await answers(world(env, { accounts }).deps, 'GET')).text), { available: false }, 'no gateway answering: not there');
      same(JSON.parse((await answers(world({ ...live, SCREENS_RDP_SECRET: 'short' }, { accounts, engine: health() }).deps, 'GET')).text), { available: false }, 'a secret too short to trust: off');
      same(JSON.parse((await answers(world(env, { accounts, engine: health({ month: 'plenty' }) }).deps, 'GET')).text), { available: false }, 'a gateway that does not say its count: off (no pass without the count)');
      same([JSON.parse((await answers(world(env, { accounts, engine: health({ engineSet: false }) }).deps, 'GET')).text).available, (await answers(world(env, { accounts, engine: health({ engineSet: false }) }).deps, 'POST')).status], [false, 502], "a gateway that does not know the PC's engine: not available, no pass");
      const elsewhere = world({ ...env, SCREENS_SITE_WAY_GATEWAY_URL: 'http://192.168.1.20:8481' }, { accounts, engine: health() });
      same([JSON.parse((await answers(elsewhere.deps, 'GET')).text), elsewhere.seen.engine.length], [{ available: false }, 0], 'a gateway on another machine is refused, and never asked');
      same(siteServer.siteSocketAddress({ SCREENS_SITE_WAY_SOCKET_URL: 'javascript:alert(1)' }), '/api/screens/site-socket', 'a socket address that is not one is ignored');
    }

    // THE DOOR AND THE LINE, with the real gateway program, a pretend engine and a pretend browser, all on this PC.
    const stamp = (n) => {
      const bytes = Buffer.alloc(8);
      bytes.writeBigUInt64BE(BigInt(n));
      return bytes;
    };
    const engine = { mode: 'ok', requests: [], messages: [], lines: [] };
    const pretendEngine = net.createServer((line) => {
      let head = Buffer.alloc(0);
      let readLine = null;
      line.on('error', () => {});
      line.on('data', (chunk) => {
        let rest = chunk;
        if (readLine === null) {
          head = Buffer.concat([head, chunk]);
          const end = head.indexOf('\r\n\r\n');
          if (end < 0) return;
          const text = head.subarray(0, end).toString('latin1');
          engine.requests.push(text);
          if (!text.startsWith(`GET /site?token=${KEY} HTTP/1.1\r\n`) || !/\r\nUpgrade: debaser-site(\r\n|$)/.test(text)) return void line.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 2\r\nConnection: close\r\n\r\nno');
          if (engine.mode === 'old') return void line.end('HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\nConnection: close\r\n\r\nnot found');
          if (engine.mode === 'busy') return void line.end('HTTP/1.1 503 Service Unavailable\r\nContent-Length: 48\r\nConnection: close\r\n\r\n2 viewers are already watching through the site.');
          line.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: debaser-site\r\nConnection: Upgrade\r\nDebaser-Viewer: 7\r\n\r\n');
          readLine = siteWay.lineReader(64 * 1024);
          engine.lines.push(line);
          if (engine.mode === 'flood') {
            for (let i = 0; i < 40; i += 1) line.write(siteWay.lineMessage(siteWay.KIND.fullPicture, Buffer.concat([stamp(i * 1500), Buffer.alloc(1000, 7)])));
          } else {
            line.write(siteWay.lineMessage(siteWay.KIND.says, Buffer.from([0x80, 0x00])));
            line.write(siteWay.lineMessage(siteWay.KIND.frame, Buffer.concat([stamp(1500), Buffer.from('a frame before any full picture')])));
            line.write(siteWay.lineMessage(siteWay.KIND.fullPicture, Buffer.concat([stamp(3000), Buffer.from('FULL PICTURE')])));
            line.write(siteWay.lineMessage(siteWay.KIND.frame, Buffer.concat([stamp(4500), Buffer.from('frame')])));
            line.write(siteWay.lineMessage(siteWay.KIND.sound, Buffer.concat([stamp(480), Buffer.from('opus')])));
            line.write(siteWay.lineMessage(99, Buffer.from('a kind nobody knows')));
          }
          rest = head.subarray(end + 4);
          if (rest.length === 0) return;
        }
        for (const message of readLine(rest)) engine.messages.push({ kind: message.kind, contents: Buffer.from(message.contents) });
      });
    });
    await new Promise((resolve) => pretendEngine.listen(0, '127.0.0.1', resolve));
    const freePort = async () => {
      const probe = net.createServer();
      await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
      const { port } = probe.address();
      await new Promise((resolve) => probe.close(resolve));
      return port;
    };
    const settingsFile = path.join(folder, 'site.env');
    const usageFile = path.join(folder, 'usage.json');
    fs.writeFileSync(settingsFile, `# a pretend site.env\nSCREENS_ENGINE_URL=http://127.0.0.1:${pretendEngine.address().port}\nSCREENS_ENGINE_TOKEN=${KEY}\nSCREENS_RDP_SECRET="${SECRET}"\n`);
    same(siteWay.settingsFrom(settingsFile).SCREENS_RDP_SECRET, SECRET, 'the settings file is read as name=value lines');
    const gatewayEnv = (more) => ({ ...process.env, DEBASER_SITE_WAY_SETTINGS: settingsFile, DEBASER_SITE_WAY_USAGE: usageFile, DEBASER_HOST_FOLDER: folder, ...more });
    const startGateway = async (more = {}) => {
      const port = await freePort();
      const child = spawn(process.execPath, [GATEWAY_FILE], { env: gatewayEnv({ DEBASER_SITE_WAY_PORT: String(port), ...more }), stdio: ['ignore', 'pipe', 'pipe'] });
      let said = '';
      child.stdout.on('data', (chunk) => (said += chunk));
      ok(await until(() => /listens on 127\.0\.0\.1/.test(said), 15000), 'the gateway starts when the settings hold a pass secret and the count can be written');
      return { port, child, said: () => said, stop: () => new Promise((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve() : (child.once('exit', resolve), child.kill()))) };
    };
    const browser = (port, first) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}${siteWay.PATH}`);
      socket.binaryType = 'arraybuffer';
      const seen = { socket, texts: [], bytes: [], closed: false };
      socket.onopen = () => first !== undefined && socket.send(first);
      socket.onmessage = (event) => (typeof event.data === 'string' ? seen.texts.push(JSON.parse(event.data)) : seen.bytes.push(Buffer.from(event.data)));
      socket.onclose = () => (seen.closed = true);
      socket.onerror = () => {};
      return seen;
    };
    const goodPass = () => JSON.stringify({ pass: siteServer.makeSitePass(SECRET, Date.now()) });

    // Without a pass secret in the settings it does not start at all; neither when the count has nowhere to be kept.
    {
      const secretless = spawnSync(process.execPath, [GATEWAY_FILE], { encoding: 'utf8', timeout: 20000, env: gatewayEnv({ DEBASER_SITE_WAY_SETTINGS: path.join(folder, 'no-such.env'), DEBASER_SITE_WAY_PORT: String(await freePort()) }) });
      same([secretless.status, /NOT STARTED/.test(secretless.stdout)], [2, true], 'no pass secret in the settings: the gateway does not start, so nobody could be let in by mistake');
      const countless = spawnSync(process.execPath, [GATEWAY_FILE], { encoding: 'utf8', timeout: 20000, env: gatewayEnv({ DEBASER_SITE_WAY_USAGE: path.join(folder, 'no-such-folder', 'usage.json'), DEBASER_SITE_WAY_PORT: String(await freePort()) }) });
      same([countless.status, /NOT STARTED/.test(countless.stdout)], [2, true], 'nowhere to keep the count: it does not start, so the limit cannot be lost');
    }

    let gateway = await startGateway();
    try {
      const healthNow = async () => (await fetch(`http://127.0.0.1:${gateway.port}/health`)).json();
      same(await healthNow(), { ok: true, gate: false, engineSet: true, passesSet: true, viewers: 0, month: { name: siteWay.monthOf(), usedBytes: 0, limitBytes: 20_000_000_000 } }, 'its health: the real way, the engine and the secret set, nothing used, 20 GB');
      ok(!gateway.said().includes(KEY) && !gateway.said().includes(SECRET), 'neither the key nor the secret is in what it prints');

      // Strangers: a closed line, not one byte of picture, and the engine never hears of them.
      for (const [who, first] of [
        ['words that are not a pass', JSON.stringify({ pass: 'open sesame' })],
        ['a Remote Desktop pass signed with the same secret', JSON.stringify({ pass: rdp.makePass(SECRET, { width: 1920, height: 1080, dpi: 96 }, Date.now()) })],
        ['a pass that ran out', JSON.stringify({ pass: siteServer.makeSitePass(SECRET, Date.now() - 120_000) })],
        ['a pass signed with another secret', JSON.stringify({ pass: siteServer.makeSitePass('e'.repeat(48), Date.now()) })],
        ['something that is not a message', 'hello'],
      ]) {
        const stranger = browser(gateway.port, first);
        ok(await until(() => stranger.closed), `${who}: the line is closed`);
        same([stranger.bytes.length, stranger.texts.length, engine.requests.length], [0, 0, 0], `${who}: nothing sent, and the engine never asked`);
      }
      {
        const silent = browser(gateway.port);
        ok(await until(() => silent.closed, 5000), 'saying nothing for three seconds: the line is closed');
        same([silent.bytes.length, engine.requests.length], [0, 0], 'with nothing sent and the engine never asked');
      }

      // The owner's browser, with a pass from the site.
      const first = goodPass();
      const owner = browser(gateway.port, first);
      ok(await until(() => owner.bytes.length >= 4), "a good pass: the engine's line is opened and its messages come through");
      await sleep(150);
      same(engine.requests.length, 1, 'the engine was asked once, with its key, on its own line');
      same(owner.texts[0], { ok: true, viewer: 7, month: owner.texts[0].month }, "the browser is told it is in, with the engine's own viewer number");
      same(owner.bytes.map((message) => [message[0], message.readUInt32BE(1), message.subarray(13).toString('latin1')]), [
        [4, 0, '\x80\x00'],
        [2, 2, `${stamp(3000).toString('latin1')}FULL PICTURE`],
        [1, 3, `${stamp(4500).toString('latin1')}frame`],
        [3, 1, `${stamp(480).toString('latin1')}opus`],
      ], "the PC's words, the full picture, the frame after it and the sound arrive untouched, each with its number; the frame from BEFORE the full picture is skipped (number 1 never comes), and a kind nobody knows is dropped");
      ok(owner.bytes.every((message) => Math.abs(message.readDoubleBE(5) - Date.now()) < 60_000), 'each carries the moment it left the gateway');
      ok(await until(() => engine.messages.some((message) => message.kind === siteWay.KIND.fullPicturePlease)), 'the skipped frame made the gateway ask the engine for a full picture');
      const again = browser(gateway.port, first);
      ok(await until(() => again.closed), 'the same pass a second time: closed');
      same([again.bytes.length, engine.requests.length], [0, 1], 'nothing sent, the engine not asked again');

      // Control goes to the PC on the right lane, byte for byte; the engine hears that the viewer is still watching.
      await sleep(300);
      engine.messages.length = 0;
      owner.socket.send(Buffer.from([siteWay.KIND.keys, 0x01, 0x02, 0x03]));
      owner.socket.send(Buffer.from([siteWay.KIND.pointer, 0x09, 0x08]));
      owner.socket.send(Buffer.from([siteWay.KIND.fullPicturePlease]));
      owner.socket.send(Buffer.from([0x63, 0x01]));
      owner.socket.send(JSON.stringify({ got: 3, sent: owner.bytes[2].readDoubleBE(5), at: 10, now: 12 }));
      ok(await until(() => engine.messages.some((message) => message.kind === siteWay.KIND.stillWatching) && engine.messages.filter((message) => message.kind !== siteWay.KIND.stillWatching).length >= 3), 'the browser\'s bytes reach the engine');
      same(engine.messages.filter((message) => message.kind !== siteWay.KIND.stillWatching).map((message) => [message.kind, [...message.contents]]), [[16, [1, 2, 3]], [17, [9, 8]], [18, []]], 'keys on the keys lane, the pointer on the pointer lane, "a full picture, please"; a lane nobody knows is dropped');
      // A browser gone silent: the engine is no longer told it is watching (it stops sending to one it hears nothing of).
      await sleep(3700);
      engine.messages.length = 0;
      await sleep(1300);
      same(engine.messages.filter((message) => message.kind === siteWay.KIND.stillWatching).length, 0, 'three seconds of silence from the browser: the engine is no longer told it is watching');

      // The engine closes its end: the browser is told why, in words, and its line closes.
      engine.lines[0].destroy();
      ok(await until(() => owner.closed), "the engine's line closing closes the browser's");
      same(owner.texts.at(-1).ended, "THE PC'S ENGINE CLOSED THE LINE", 'after saying why');

      // An engine that says no, and one too old to know this way.
      engine.mode = 'busy';
      const third = browser(gateway.port, goodPass());
      ok(await until(() => third.closed), 'the engine refusing: closed');
      same([third.bytes.length, third.texts.at(-1).ended], [0, 'THE PC SAID NO: 2 viewers are already watching through the site.'], "with the PC's own words");
      engine.mode = 'old';
      const old = browser(gateway.port, goodPass());
      ok(await until(() => old.closed), 'an engine from before this way: closed');
      same(old.texts.at(-1).ended, "THE PC'S ENGINE IS TOO OLD FOR THE WAY THROUGH THE SITE", 'and said');
      engine.mode = 'ok';

      // The count: every byte to and from a browser, kept in the file.
      const counted = (await healthNow()).month.usedBytes;
      const received = owner.bytes.reduce((sum, message) => sum + message.length, 0);
      ok(counted > received && counted < received + 4000, `what was sent is counted (${counted} bytes for ${received} of picture and sound, plus the words and the browser's own)`);
      ok(await until(() => { try { return JSON.parse(fs.readFileSync(usageFile, 'utf8')).bytes === counted; } catch { return false; } }), 'and the file holds the same figure');
      same(JSON.parse(fs.readFileSync(usageFile, 'utf8')).month, siteWay.monthOf(), 'under this month');
      await gateway.stop();

      // Started again with the file: it carries on. With a limit a little above that: it stops in the middle and says so.
      gateway = await startGateway({ DEBASER_SITE_WAY_LIMIT_BYTES: String(counted + 5000) });
      same((await healthNow()).month, { name: siteWay.monthOf(), usedBytes: counted, limitBytes: counted + 5000 }, 'a gateway started again reads the count back');
      engine.mode = 'flood';
      engine.requests.length = 0;
      const flooded = browser(gateway.port, goodPass());
      ok(await until(() => flooded.closed), 'forty thousand bytes of picture against five thousand left: the line is closed');
      const through = flooded.bytes.reduce((sum, message) => sum + message.length, 0);
      ok(through >= 3000 && through <= 6100, `the gateway itself stopped at the limit (${through} bytes of picture got through, of 40,520 sent by the engine)`);
      same(flooded.texts.at(-1).ended, siteWay.USED_UP, 'and said why');
      ok((await healthNow()).month.usedBytes >= counted + 5000, 'the month is used up');
      const late = browser(gateway.port, goodPass());
      ok(await until(() => late.closed), 'after that, even a good pass: closed');
      same([late.bytes.length, late.texts.at(-1).ended, engine.requests.length], [0, siteWay.USED_UP, 1], 'no picture, the same words, and the engine not asked again');
      await gateway.stop();
      // Nothing can raise the limit.
      gateway = await startGateway({ DEBASER_SITE_WAY_LIMIT_BYTES: '99000000000' });
      same((await healthNow()).month.limitBytes, 20_000_000_000, 'asked for more than 20 GB, the gateway keeps 20 GB');
    } finally {
      await gateway.stop();
      for (const line of engine.lines) line.destroy();
      await new Promise((resolve) => pretendEngine.close(resolve));
      fs.rmSync(folder, { recursive: true, force: true });
    }
  }

  console.log(`ok: ${passed} assertions (SCREENS: owner only, this PC only, the dev switch dead in production, the settings sums, CONTROL's bytes, sound, the controller, the PC's pointer, the first key listener)`);
  process.exitCode = 0;
}

main().catch((error) => {
  console.log(`FAIL ${error && error.message ? error.message : error}`);
  process.exit(1);
});
