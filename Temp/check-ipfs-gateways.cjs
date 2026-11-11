/*
 * Books on IPFS, step 1 (Luke, 2026-11-11): the book ref, the gateways and the browser's gateway fetcher, offline.
 *   npx tsc app/lib/books/ipfs.ts --outDir Temp/out-ipfs --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *   node Temp/check-ipfs-gateways.cjs
 *
 * - only a real CID is a book address (`ipfs:Qm...` or `ipfs:b...`): nothing that could carry a path, query or address
 * - each gateway is asked as `https://<host>/ipfs/<cid>`, in order, one at a time, with no cookies and no referrer
 * - a gateway that doesn't start answering is cancelled (its connection aborted) and the next is asked
 * - a book that stops arriving part way is cancelled the same way
 * - an answer that ended up off the gateway (a redirect elsewhere) is refused
 * - a file past the cap stops at once, announced or not, and no other gateway is asked for it
 * - leaving the page cancels the gateway being read and asks no other
 * - the line shown when all fail: NO COPY FOUND, BLOCKED BY THE SOURCE or SOURCE NOT ANSWERING
 * - the file is browser-safe: it imports nothing and reads no settings
 * The gateways' own answers were tested live on 2026-11-11 (see IPFS_GATEWAYS); this check uses a fake fetch.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ipfs = require(path.join(__dirname, 'out-ipfs', 'lib', 'books', 'ipfs.js'));
const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'app', 'lib', 'books', 'ipfs.ts'), 'utf8');

const V0 = 'QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o';
const V1 = 'bafybeicg2rebjoofv4kbyovkw7af3rpiitvnl6i7ckcywaq6xjcxnc2mby';
const GATEWAYS = [
  { name: 'ONE', host: 'one.example' },
  { name: 'TWO', host: 'two.example' },
  { name: 'THREE', host: 'three.example' },
];
const FAST = { gateways: GATEWAYS, startMs: 60, stallMs: 60 };
let passed = 0;
const ok = (condition, message) => {
  assert.ok(condition, message);
  passed += 1;
};

/* ---------------------------------------------------------------- fakes */
const aborted = () => {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
};
/** A gateway that never answers until its request is cancelled. */
const hang = (init) =>
  new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(aborted()), { once: true });
  });
/** An answer with this body (chunks), from this final address, optionally stalling after the chunks are sent. */
function answer(init, { chunks = [new Uint8Array([1, 2, 3])], status = 200, url, length, stall = false, type = 'application/epub+zip' } = {}) {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (stall) init.signal.addEventListener('abort', () => controller.error(aborted()), { once: true });
      else controller.close();
    },
  });
  const headers = { 'content-type': type };
  if (length !== undefined) headers['content-length'] = String(length);
  const response = new Response(status === 204 ? null : body, { status, headers });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}
/** A fake fetch: `plan[host]` decides each gateway's answer; every request is recorded with its signal. */
function fakeFetch(plan) {
  const calls = [];
  const fetchImpl = async (address, init) => {
    const host = new URL(address).hostname;
    calls.push({ address, host, init });
    return plan[host](init, address);
  };
  return { fetchImpl, calls };
}
/** Fails instead of hanging when a cancel never comes. */
function within(ms, promise, message) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`hung: ${message}`)), ms))]);
}
async function problemOf(promise) {
  try {
    await promise;
  } catch (error) {
    return error instanceof ipfs.IpfsFetchError ? error.problem : error.name;
  }
  return 'no error';
}

(async () => {
  /* 1. the book address -------------------------------------------------------------------------- */
  ok(ipfs.ipfsCid(`ipfs:${V0}`) === V0, 'a version 0 CID is a book address');
  ok(ipfs.ipfsCid(`ipfs:${V1}`) === V1, 'a version 1 CID is a book address');
  for (const bad of [
    `ipfs:${V0}/x`,
    `ipfs:${V0}?a=1`,
    `ipfs:${V1.toUpperCase()}`,
    'ipfs:https://evil.example/book.epub',
    'ipfs:../../etc',
    'ipfs:Qm123',
    'ipfs:',
    `books:${V0}`,
    V0,
    `ipfs:${V0}0`,
    `ipfs:b${'a'.repeat(200)}`,
    `ipfs: ${V0}`,
  ]) {
    ok(ipfs.ipfsCid(bad) === null, `not a book address: ${bad.slice(0, 50)}`);
  }

  /* 2. staying on the gateway --------------------------------------------------------------------- */
  ok(ipfs.onGateway(`https://4everland.io/ipfs/${V0}`, '4everland.io'), 'the gateway itself');
  ok(ipfs.onGateway(`https://${V1}.ipfs.4everland.io/`, '4everland.io'), "the gateway's own CID subdomain");
  for (const bad of [
    'https://evil.example/',
    'https://4everland.io.evil.example/',
    `https://${V1}.ipfs.4everland.io.evil.example/`,
    `https://a.b.ipfs.4everland.io/`,
    'http://4everland.io/',
    'https://4everland.io:8443/',
    'https://user:pw@4everland.io/',
    'not an address',
    `https://ipfs.4everland.io/`,
  ]) {
    ok(!ipfs.onGateway(bad, '4everland.io'), `off the gateway: ${bad}`);
  }

  /* 3. the gateways as built ---------------------------------------------------------------------- */
  ok(ipfs.IPFS_GATEWAYS.length >= 3, 'a primary and at least two fallbacks');
  ok(ipfs.IPFS_GATEWAYS.every((g) => /^[a-z0-9.-]+$/.test(g.host) && !g.host.includes('/')), 'each gateway is a bare host');
  ok(ipfs.IPFS_START_MS === 8000, 'a gateway has 8 seconds to start answering (the plan)');
  ok(ipfs.IPFS_STALL_MS >= ipfs.IPFS_START_MS, 'a book arriving gets at least as long between pieces');

  /* 4. the first gateway answers: asked exactly, no cookies, no referrer, progress reported ------- */
  {
    const progress = [];
    const { fetchImpl, calls } = fakeFetch({
      'one.example': (init) => answer(init, { chunks: [new Uint8Array(4), new Uint8Array(6)], length: 10, url: `https://one.example/ipfs/${V0}` }),
    });
    const book = await within(2000, ipfs.fetchFromGateways(V0, { ...FAST, fetchImpl, onProgress: (p) => progress.push(p) }), 'a plain answer');
    ok(calls.length === 1 && calls[0].address === `https://one.example/ipfs/${V0}`, 'one request, to https://<host>/ipfs/<cid>');
    ok(calls[0].init.credentials === 'omit' && calls[0].init.referrerPolicy === 'no-referrer', 'no cookies and no referrer go to the gateway');
    ok(calls[0].init.signal instanceof AbortSignal, 'each request carries its own cancel switch');
    ok(book.gateway === 'ONE' && book.blob.size === 10 && book.type === 'application/epub+zip', 'the whole book comes back as a Blob, with its type');
    ok(progress.length >= 3 && progress.at(-1).loaded === 10 && progress.at(-1).total === 10 && progress.every((p) => p.gateway === 'ONE'), 'progress climbs to the whole file');
  }

  /* 5. a stalled gateway is cancelled, and the next is asked -------------------------------------- */
  {
    const { fetchImpl, calls } = fakeFetch({
      'one.example': (init) => hang(init),
      'two.example': (init) => answer(init, { url: `https://two.example/ipfs/${V0}` }),
    });
    const started = Date.now();
    const book = await within(2000, ipfs.fetchFromGateways(V0, { ...FAST, fetchImpl }), 'a stalled first gateway');
    ok(book.gateway === 'TWO', 'the second gateway gave the book');
    ok(calls[0].init.signal.aborted, "the stalled gateway's request was cancelled, not left open");
    ok(Date.now() - started >= 55, 'it was given its start time first');
    ok(calls.map((c) => c.host).join() === 'one.example,two.example', 'one after another, in order, never the third');
  }

  /* 6. a book that stops arriving part way is cancelled ------------------------------------------- */
  {
    const { fetchImpl, calls } = fakeFetch({
      'one.example': (init) => answer(init, { chunks: [new Uint8Array(5)], length: 50, stall: true, url: `https://one.example/ipfs/${V0}` }),
      'two.example': (init) => answer(init, { url: `https://two.example/ipfs/${V0}` }),
    });
    const book = await within(2000, ipfs.fetchFromGateways(V0, { ...FAST, fetchImpl }), 'a trickle that stops');
    ok(book.gateway === 'TWO' && calls[0].init.signal.aborted, 'the stopped download was cancelled and the next gateway gave the book');
  }

  /* 7. an answer from somewhere else is refused ---------------------------------------------------- */
  {
    const { fetchImpl, calls } = fakeFetch({
      'one.example': (init) => answer(init, { url: 'https://evil.example/book.epub' }),
      'two.example': (init) => answer(init, { url: `https://${V1}.ipfs.two.example/` }),
    });
    const book = await within(2000, ipfs.fetchFromGateways(V0, { ...FAST, fetchImpl }), 'a redirect away');
    ok(book.gateway === 'TWO' && calls[0].init.signal.aborted, 'a redirect off the gateway is refused; its own CID subdomain is fine');
  }

  /* 8. too big: announced, or running past the cap; no other gateway asked ------------------------ */
  {
    const { fetchImpl, calls } = fakeFetch({
      'one.example': (init) => answer(init, { length: 101, url: `https://one.example/ipfs/${V0}` }),
      'two.example': (init) => answer(init, { url: `https://two.example/ipfs/${V0}` }),
    });
    ok((await problemOf(ipfs.fetchFromGateways(V0, { ...FAST, fetchImpl, maxBytes: 100 }))) === 'TOO BIG TO READ HERE', 'an announced size past the cap: TOO BIG');
    ok(calls.length === 1 && calls[0].init.signal.aborted, 'stopped before reading, and no other gateway asked');
  }
  {
    const { fetchImpl, calls } = fakeFetch({
      'one.example': (init) => answer(init, { chunks: [new Uint8Array(60), new Uint8Array(60)], url: `https://one.example/ipfs/${V0}` }),
      'two.example': (init) => answer(init, { url: `https://two.example/ipfs/${V0}` }),
    });
    ok((await problemOf(ipfs.fetchFromGateways(V0, { ...FAST, fetchImpl, maxBytes: 100 }))) === 'TOO BIG TO READ HERE', 'a body running past the cap: TOO BIG');
    ok(calls.length === 1, 'and no other gateway asked');
  }

  /* 9. leaving the page cancels everything --------------------------------------------------------- */
  {
    const leave = new AbortController();
    const { fetchImpl, calls } = fakeFetch({
      'one.example': (init) => answer(init, { chunks: [new Uint8Array(5)], length: 50, stall: true, url: `https://one.example/ipfs/${V0}` }),
      'two.example': (init) => answer(init, { url: `https://two.example/ipfs/${V0}` }),
    });
    const reading = ipfs.fetchFromGateways(V0, { gateways: GATEWAYS, startMs: 1000, stallMs: 1000, fetchImpl, signal: leave.signal });
    setTimeout(() => leave.abort(), 30);
    ok((await within(2000, problemOf(reading), 'leaving the page')) === 'AbortError', 'leaving the page stops the reading');
    ok(calls.length === 1 && calls[0].init.signal.aborted, "the gateway being read is cancelled and no other is asked");
  }

  /* 10. the line when all fail --------------------------------------------------------------------- */
  {
    const all = (make) => fakeFetch({ 'one.example': make, 'two.example': make, 'three.example': make });
    const missing = all((init, address) => answer(init, { status: 404, url: address }));
    ok((await problemOf(ipfs.fetchFromGateways(V0, { ...FAST, fetchImpl: missing.fetchImpl }))) === 'NO COPY FOUND', 'every gateway lacks it: NO COPY FOUND');
    ok(missing.calls.length === 3, 'every gateway was asked before saying so');
    const blocked = all(async () => {
      throw new TypeError('Failed to fetch');
    });
    ok((await problemOf(ipfs.fetchFromGateways(V0, { ...FAST, fetchImpl: blocked.fetchImpl }))) === 'BLOCKED BY THE SOURCE', 'every gateway refused the browser: BLOCKED BY THE SOURCE');
    const slow = all((init) => hang(init));
    ok((await within(2000, problemOf(ipfs.fetchFromGateways(V0, { ...FAST, fetchImpl: slow.fetchImpl })), 'all slow')) === 'SOURCE NOT ANSWERING', 'every gateway too slow: SOURCE NOT ANSWERING');
    ok(slow.calls.every((c) => c.init.signal.aborted), 'and each was cancelled');
    const mixed = fakeFetch({
      'one.example': (init, address) => answer(init, { status: 404, url: address }),
      'two.example': (init, address) => answer(init, { status: 503, url: address }),
      'three.example': (init) => hang(init),
    });
    ok((await within(2000, problemOf(ipfs.fetchFromGateways(V0, { ...FAST, fetchImpl: mixed.fetchImpl })), 'mixed')) === 'SOURCE NOT ANSWERING', 'a mix: SOURCE NOT ANSWERING');
  }

  /* 11. not a CID: nothing is asked ---------------------------------------------------------------- */
  {
    const { fetchImpl, calls } = fakeFetch({});
    ok((await problemOf(ipfs.fetchFromGateways('https://evil.example/x', { ...FAST, fetchImpl }))) === 'NOT A BOOK ADDRESS', 'a non-CID: NOT A BOOK ADDRESS');
    ok(calls.length === 0, 'and no gateway is asked');
  }

  /* 12. browser-safe -------------------------------------------------------------------------------- */
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok(!/^\s*import\b/m.test(code) && !/\brequire\(/.test(code), 'ipfs.ts imports nothing (no server code can come with it)');
  ok(!/process\.env/.test(code), 'and reads no settings');

  console.log(`ok: ${passed} assertions (IPFS book address, gateways, cancelling, the lines shown)`);
})().catch((error) => {
  console.log(`FAIL ${error.message}`);
  process.exit(1);
});
