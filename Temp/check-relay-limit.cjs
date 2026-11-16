/*
 * The YouTube sound relay's per-address limit (list 3, 2026-11-16: "fix all of those remainders"; the relay had none):
 * one address gets 30 slices a minute and 300 an hour, then a 429 with Retry-After; other addresses are untouched; an
 * IPv6 household counts as one (its /64); a request refused for coming from another site costs nothing; and a refusal
 * is what the graph's hidden player already treats as a failed relay (the graph moves gently, YouTube plays on).
 * Run from the root:
 *   npx tsc app/lib/audio/youtube-relay.ts app/lib/audio/sound-graph.ts app/api/audio/relay/[id]/route.ts --rootDir app --outDir Temp/relay-limit-out --module commonjs --target es2020 --lib es2021,dom --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
 *   node Temp/check-relay-limit.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const relay = require('./relay-limit-out/lib/audio/youtube-relay.js');
const graph = require('./relay-limit-out/lib/audio/sound-graph.js');
const route = require('./relay-limit-out/api/audio/relay/[id]/route.js');

/** One ask of the route from `address`, with a malformed id so nothing is ever fetched from YouTube. */
const ask = (address, site = 'same-origin') =>
  route.GET(new Request('http://localhost/api/audio/relay/x', { headers: { 'sec-fetch-site': site, 'x-real-ip': address } }), { params: Promise.resolve({ id: 'not an id' }) });

(async () => {
  const { perMinute, perHour } = relay.RELAY_LIMIT;
  assert.ok(perMinute >= 20 && perMinute <= 120, `a minute's slices are generous but bounded (${perMinute})`);
  assert.ok(perHour >= 10 * 24 && perHour <= 1000, `an hour's slices are ten listeners' worth or more, bounded (${perHour})`);

  /* 1. The route: one address is refused past the minute's limit; another is not ------------------------------- */
  for (let i = 0; i < perMinute; i += 1) assert.equal((await ask('198.51.100.7')).status, 404, `ask ${i + 1} gets through to the relay`);
  const refused = await ask('198.51.100.7');
  assert.equal(refused.status, 429, 'the next ask that minute is refused');
  assert.equal(refused.headers.get('retry-after'), '60', 'it says when to ask again');
  assert.equal(refused.headers.get('cache-control'), 'no-store', 'the refusal is never cached');
  assert.equal((await ask('198.51.100.8')).status, 404, 'another address is untouched');
  console.log(`  ok    the route: ${perMinute} slices a minute for one address, then 429; others untouched`);

  /* 2. An IPv6 household (its /64) counts as one address --------------------------------------------------------- */
  for (let i = 0; i < perMinute; i += 1) await ask(`2001:db8:1:2::${(i + 1).toString(16)}`);
  assert.equal((await ask('2001:db8:1:2::ffff')).status, 429, 'rotating through one /64 buys no fresh slices');
  assert.equal((await ask('2001:db8:1:3::1')).status, 404, 'the next /64 is someone else');
  console.log('  ok    an IPv6 /64 is one address');

  /* 3. Another site's request is refused before it is counted ----------------------------------------------------- */
  for (let i = 0; i < perMinute * 2; i += 1) assert.equal((await ask('198.51.100.9', 'cross-site')).status, 403);
  assert.equal((await ask('198.51.100.9')).status, 404, 'refused cross-site asks cost the address nothing');
  console.log('  ok    cross-site refusals are not counted');

  /* 4. The windows: a minute's limit clears after a minute; the hour's holds a steady hammer ---------------------- */
  const t = 1_000_000_000;
  for (let i = 0; i < perMinute; i += 1) assert.ok(relay.relayAllowed('minute-test', t + i));
  assert.equal(relay.relayAllowed('minute-test', t + perMinute), false, 'over the minute: refused');
  assert.equal(relay.relayAllowed('minute-test', t + 60_001), true, 'a minute later: allowed again');
  // A steady ask every two seconds and a bit stays under the minute's limit; the hour's stops it once it reaches 300.
  const step = Math.ceil(60_000 / perMinute) + 1;
  let allowed = 0;
  let at = t;
  while (allowed < perHour && at < t + 3_600_000) {
    assert.ok(relay.relayAllowed('hour-test', at), `ask ${allowed + 1} within the hour's limit`);
    allowed += 1;
    at += step;
  }
  assert.equal(allowed, perHour, 'the hour fits the whole allowance at that pace');
  assert.equal(relay.relayAllowed('hour-test', at), false, 'the next one inside the hour is refused');
  assert.equal(relay.relayAllowed('hour-test', t + 3_600_001), true, 'once the first ask is an hour old, one more is allowed');
  console.log(`  ok    the windows: a minute clears after a minute; ${perHour} an hour holds a steady hammer`);

  /* 5. A refusal is a failed relay to the graph: it moves gently, YouTube's own player is untouched --------------- */
  assert.equal(graph.pickSource({ tab: false, barPlaying: false, barHeard: false, videoPlaying: true, relayable: true, relayFailed: true }), 'gentle');
  const component = fs.readFileSync(path.join(__dirname, '..', 'app', 'components', 'SoundGraph.tsx'), 'utf8');
  assert.match(component, /relay\.addEventListener\('error', \(\) => \{\s*if \(kept\.relayId !== null\) kept\.relayFailed = kept\.relayId;/, 'the hidden player marks the relay failed on any refused answer');
  console.log('  ok    a 429 is a failed relay: the graph moves gently');

  console.log('CHECK PASSED: check-relay-limit');
})().catch((error) => {
  console.error('CHECK FAILED: check-relay-limit:', error.message);
  process.exit(1);
});
