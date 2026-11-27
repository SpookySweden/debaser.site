/*
 * The account's own line, on the live project (Luke, 2026-11-27, the database rule: "Yes, add it (Recommended)"; the coordinator's
 * proof: "A's two tabs hear each other; B can't hear or send on A's channel"). Kept test accounts only, no browser, nothing stored:
 *
 *   1. Two connections signed in as TEST ACCOUNT A both join `account:<A's id>`, and a word from one reaches the other.
 *   2. TEST ACCOUNT B cannot join A's line (the rule refuses it), and a word B sends to A's line never reaches A.
 *   3. B can join its own line (the rule is per account, not shut to everyone).
 *
 *   node Temp/check-own-device-line.cjs
 */
const assert = require('node:assert/strict');
const { testAccountClient } = require('../scripts/browser.cjs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Joins a private broadcast channel and says how the join went: SUBSCRIBED, CHANNEL_ERROR, TIMED_OUT or CLOSED. */
function join(client, topic, heard) {
  const channel = client.channel(topic, { config: { broadcast: { self: false }, private: true } });
  channel.on('broadcast', { event: 'own' }, ({ payload }) => heard.push(payload));
  return new Promise((resolve) => {
    let done = false;
    channel.subscribe((status) => {
      if (done || status === 'JOINING') return;
      done = true;
      resolve({ channel, status });
    });
    setTimeout(() => {
      if (!done) {
        done = true;
        resolve({ channel, status: 'NO ANSWER' });
      }
    }, 10000);
  });
}

(async () => {
  const a1 = await testAccountClient('A');
  const a2 = await testAccountClient('A');
  const b = await testAccountClient('B');
  const clients = [a1, a2, b];
  try {
    for (const held of clients) await held.client.realtime.setAuth();
    const topic = `account:${a1.id}`;
    const heardA1 = [];
    const heardA2 = [];
    const heardB = [];

    const [joinA1, joinA2] = [await join(a1.client, topic, heardA1), await join(a2.client, topic, heardA2)];
    assert.equal(joinA1.status, 'SUBSCRIBED', `A's first connection joins its own line (${joinA1.status})`);
    assert.equal(joinA2.status, 'SUBSCRIBED', `A's second connection joins its own line (${joinA2.status})`);
    await joinA1.channel.send({ type: 'broadcast', event: 'own', payload: { kind: 'ask-room', roomId: 'own-line-check', since: 1 } });
    for (let tick = 0; tick < 20 && heardA2.length === 0; tick += 1) await sleep(250);
    assert.equal(heardA2.length, 1, 'A\'s second connection heard the first');
    console.log('  ok    two connections of TEST ACCOUNT A joined account:<A> and heard each other');

    // [ DEVICES ] (SPEC-room-devices.md): its three words cross the same line whole.
    const way = { mode: 'follows-me', keeper: null, at: 1 };
    const devicesWords = [
      { kind: 'hello', roomId: 'own-line-check', from: 'check-device-1', key: 'check-key', name: 'CHECK ONE', modes: { 'check-device-2': way }, held: false, answer: false },
      { kind: 'pair', roomId: 'own-line-check', from: 'check-device-1', to: 'check-device-2', ...way },
      { kind: 'mute-device', roomId: 'own-line-check', from: 'check-device-1', to: 'check-device-2', on: true },
    ];
    for (const word of devicesWords) await joinA1.channel.send({ type: 'broadcast', event: 'own', payload: word });
    for (let tick = 0; tick < 20 && heardA2.length < 1 + devicesWords.length; tick += 1) await sleep(250);
    for (const word of devicesWords) assert.deepEqual(heardA2.find((payload) => payload.kind === word.kind), word, `A's second connection heard ${word.kind} whole`);
    console.log('  ok    DEVICES\' hello, pair and mute-device crossed A\'s line whole');

    const intruder = await join(b.client, topic, heardB);
    assert.notEqual(intruder.status, 'SUBSCRIBED', 'B may not join A\'s line');
    console.log(`  ok    TEST ACCOUNT B could not join A's line (${intruder.status})`);
    // A word B sends to A's line anyway (a refused join sends it the other way, over the server's broadcast address).
    const sent = await intruder.channel.send({ type: 'broadcast', event: 'own', payload: { kind: 'volume', roomId: 'own-line-check', volume: 0.1, muted: true } });
    await sleep(3000);
    assert.ok(![...heardA1, ...heardA2].some((payload) => payload.kind === 'volume'), 'nothing B sent reached A');
    assert.equal(heardB.length, 0, 'B heard nothing on A\'s line');
    console.log(`  ok    a word B sent to A's line never reached A (B's send: ${sent})`);

    const own = await join(b.client, `account:${b.id}`, []);
    assert.equal(own.status, 'SUBSCRIBED', `B joins its own line (${own.status})`);
    console.log('  ok    TEST ACCOUNT B joined its own line');
    console.log('\nown device line: all passed');
  } catch (error) {
    console.error(`FAILED: ${error.message}`);
    process.exitCode = 1;
  } finally {
    for (const held of clients) {
      await held.client.removeAllChannels().catch(() => undefined);
      await held.client.auth.signOut({ scope: 'local' }).catch(() => undefined);
    }
    process.exit();
  }
})();
