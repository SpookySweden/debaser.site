/*
 * IPFS books, step 3 (Luke, 2026-11-11): the server's pass-through for a book every gateway refused the browser, offline.
 *   npx tsc app/lib/web/ipfs-pass.ts app/api/web/book/epub/route.ts --outDir Temp/out-ipfs-pass --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *   node Temp/check-ipfs-pass.cjs
 *
 * - only an EPUB (a zip) or a PDF is passed on, told by its first bytes; anything else is refused and its stream cancelled
 * - what is passed on is every byte, in order, the first ones included
 * - the gateways are asked one at a time; one that doesn't start answering is cancelled and the next asked
 * - a redirect may go only to the gateway's own `<cid>.ipfs.<host>`; anywhere else is refused and the next gateway asked
 * - a file past the cap stops at once (TOO BIG, 413) and no other gateway is asked; not a CID: nothing is asked
 * - the start time covers the first bytes, not just the headers, and every gateway shares one deadline
 * - the route: `?ref=ipfs:<CID>` answers the book with its own type, `private, no-store`, `nosniff`; a page that isn't a book
 *   is 415, a file no gateway has is 404; a seventh request a minute from one address is 429
 * Nothing real is fetched: the gateways are a fake fetch, and the bytes are made up.
 */
const assert = require('node:assert/strict');
const path = require('node:path');

const OUT = path.join(__dirname, 'out-ipfs-pass');
const pass = require(path.join(OUT, 'lib', 'web', 'ipfs-pass.js'));

const V0 = 'QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o';
const V1 = 'bafybeicg2rebjoofv4kbyovkw7af3rpiitvnl6i7ckcywaq6xjcxnc2mby';
const GATEWAYS = [
  { name: 'ONE', host: 'one.example' },
  { name: 'TWO', host: 'two.example' },
];
const FAST = { gateways: GATEWAYS, startMs: 60, wholeMs: 2000 };
const EPUB = Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.from('mimetypeapplication/epub+zip and the rest of a made-up book')]);
const PDF = Buffer.from('%PDF-1.4 a made-up document', 'latin1');
const HTML = Buffer.from('<!doctype html><title>not a book</title>');
let passed = 0;
const ok = (condition, message) => {
  assert.ok(condition, message);
  passed += 1;
};

const aborted = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
const hang = (init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(aborted()), { once: true }));
/** A body sent in small pieces (the first piece shorter than the magic, to prove the gate gathers it), and whether it was cancelled. */
function body(bytes, record = {}) {
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) return controller.close();
      const size = at === 0 ? 2 : 7;
      controller.enqueue(new Uint8Array(bytes.subarray(at, at + size)));
      at += size;
    },
    cancel() {
      record.cancelled = true;
    },
  });
}
function fakeFetch(plan) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (address, init) => {
      calls.push({ address, init });
      return plan(new URL(address), init);
    },
  };
}
const file = (bytes, record, headers = {}) => new Response(body(bytes, record), { status: 200, headers: { 'content-length': String(bytes.length), ...headers } });
async function bytesOf(stream) {
  return Buffer.from(await new Response(stream).arrayBuffer());
}
const within = (ms, promise, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`hung: ${label}`)), ms))]);

(async () => {
  /* 1. what a file is, by its first bytes ------------------------------------------------------ */
  ok(pass.bookType(new Uint8Array(EPUB.subarray(0, 8))) === 'application/epub+zip', 'a zip is an EPUB');
  ok(pass.bookType(new Uint8Array(PDF.subarray(0, 8))) === 'application/pdf', '%PDF- is a PDF');
  ok(pass.bookType(new Uint8Array(HTML.subarray(0, 8))) === null, 'a web page is neither');
  ok(pass.bookType(new Uint8Array([0x50, 0x4b])) === null && pass.bookType(new Uint8Array([])) === null, 'too short to tell is neither');

  /* 2. the gate passes every byte, and stops a non-book ------------------------------------------- */
  {
    const gated = await pass.gateBook(body(EPUB));
    ok(gated && gated.type === 'application/epub+zip', 'an EPUB passes the gate');
    ok((await bytesOf(gated.body)).equals(EPUB), 'every byte comes out, in order, the first ones included');
    const record = {};
    ok((await pass.gateBook(body(HTML, record))) === null && record.cancelled, 'a web page is stopped and its stream cancelled');
  }

  /* 3. a stalled gateway is cancelled, and the next gives the book ------------------------------- */
  {
    const { fetchImpl, calls } = fakeFetch((url, init) => (url.hostname === 'one.example' ? hang(init) : file(PDF)));
    const got = await within(3000, pass.openIpfsBook(V0, fetchImpl, FAST), 'a stalled gateway');
    ok(got && got.type === 'application/pdf' && got.length === PDF.length, 'the second gateway gave the PDF');
    ok((await bytesOf(got.body)).equals(PDF), 'all of it');
    ok(calls[0].init.signal.aborted, "the stalled gateway's request was cancelled");
    ok(calls.map((c) => c.address).join(' ') === `https://one.example/ipfs/${V0} https://two.example/ipfs/${V0}`, 'one at a time, in order, at https://<host>/ipfs/<cid>');
    ok(calls.every((c) => c.init.credentials === 'omit' && c.init.redirect === 'manual'), 'no cookies, and every redirect checked by hand');
  }

  /* 4. redirects: to its own CID subdomain, yes; anywhere else, no --------------------------------- */
  {
    const { fetchImpl, calls } = fakeFetch((url) => {
      if (url.hostname === 'one.example') return new Response(null, { status: 301, headers: { location: `https://${V1}.ipfs.one.example/` } });
      return file(EPUB);
    });
    const got = await pass.openIpfsBook(V0, fetchImpl, FAST);
    ok(got && got.type === 'application/epub+zip' && calls[1].address === `https://${V1}.ipfs.one.example/`, "a redirect to the gateway's own CID subdomain is followed");
  }
  {
    const { fetchImpl, calls } = fakeFetch((url) => {
      if (url.hostname === 'one.example') return new Response(null, { status: 302, headers: { location: 'https://evil.example/book.epub' } });
      if (url.hostname === 'evil.example') throw new Error('the evil host was asked');
      return file(EPUB);
    });
    const got = await pass.openIpfsBook(V0, fetchImpl, FAST);
    ok(got && calls.every((c) => !c.address.includes('evil')) && calls.at(-1).address.startsWith('https://two.example/'), 'a redirect elsewhere is refused, unasked, and the next gateway gives the book');
    for (const location of [`https://${V1}.ipfs.one.example.evil.example/`, `https://a.b.ipfs.one.example/`, `http://${V1}.ipfs.one.example/`]) {
      const sneaky = fakeFetch((url) => (url.hostname === 'one.example' ? new Response(null, { status: 302, headers: { location } }) : url.hostname === 'two.example' ? file(EPUB) : Promise.reject(new Error(`asked ${url}`))));
      const result = await pass.openIpfsBook(V0, sneaky.fetchImpl, FAST);
      ok(result && sneaky.calls.length === 2 && sneaky.calls[1].address.startsWith('https://two.example/'), `refused: ${location}`);
    }
  }

  /* 5. not a book; missing everywhere; too big; not a CID ----------------------------------------- */
  {
    const record = {};
    const { fetchImpl, calls } = fakeFetch(() => file(HTML, record));
    ok((await pass.openIpfsBook(V0, fetchImpl, FAST)) === 'not-a-book' && calls.length === 1 && record.cancelled, 'a web page: not a book, its stream cancelled, no other gateway asked');
  }
  {
    const { fetchImpl, calls } = fakeFetch(() => new Response('gone', { status: 404 }));
    ok((await pass.openIpfsBook(V0, fetchImpl, FAST)) === 'missing' && calls.length === 2, 'every gateway lacks it: missing, after asking each');
  }
  {
    const { fetchImpl, calls } = fakeFetch(() => file(EPUB, {}, { 'content-length': String(pass.IPFS_PASS_MAX_BYTES + 1) }));
    ok((await pass.openIpfsBook(V0, fetchImpl, FAST)) === 'too-big' && calls.length === 1, 'past the cap: too big at once, no other gateway asked');
  }
  {
    // Headers, then nothing: the start time covers the book's first bytes, not just the headers (the code review, 2026-11-11).
    const quiet = (init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init.signal.addEventListener('abort', () => controller.error(aborted()), { once: true });
          },
        }),
        { status: 200, headers: { 'content-length': '5000' } },
      );
    const { fetchImpl, calls } = fakeFetch((url, init) => (url.hostname === 'one.example' ? quiet(init) : file(EPUB)));
    const started = Date.now();
    const got = await within(3000, pass.openIpfsBook(V0, fetchImpl, FAST), 'headers then silence');
    ok(got && got.type === 'application/epub+zip' && calls[0].init.signal.aborted, 'a gateway that sends headers and then nothing is cancelled at the start time, and the next gives the book');
    ok(Date.now() - started < 1500, 'well before the whole-book limit');
  }
  {
    // One deadline for every gateway: three that stall at the start use it up, and the fourth is never asked.
    const four = [...GATEWAYS, { name: 'THREE', host: 'three.example' }, { name: 'FOUR', host: 'four.example' }];
    const { fetchImpl, calls } = fakeFetch((url, init) => hang(init));
    const started = Date.now();
    const got = await within(3000, pass.openIpfsBook(V0, fetchImpl, { gateways: four, startMs: 200, wholeMs: 450 }), 'the shared deadline');
    ok(got === null && calls.length === 3 && Date.now() - started < 700, `the whole answer has one deadline (${calls.length} asked in ${Date.now() - started}ms)`);
  }
  {
    const { fetchImpl, calls } = fakeFetch(() => file(EPUB));
    ok((await pass.openIpfsBook('https://evil.example/x', fetchImpl, FAST)) === null && calls.length === 0, 'not a CID: nothing is asked');
  }

  /* 6. the route, with the gateways faked behind the global fetch ---------------------------------- */
  {
    const realFetch = globalThis.fetch;
    let serve = () => file(EPUB);
    globalThis.fetch = async (address, init) => serve(new URL(address), init);
    try {
      const route = require(path.join(OUT, 'api', 'web', 'book', 'epub', 'route.js'));
      const ask = (ref, ip) => route.GET(new Request(`https://debaser.site/api/web/book/epub?ref=${encodeURIComponent(ref)}`, { headers: { 'x-forwarded-for': ip } }));
      const good = await ask(`ipfs:${V0}`, '10.0.0.1');
      ok(good.status === 200 && good.headers.get('content-type') === 'application/epub+zip', 'the route answers the book with its own type');
      ok(good.headers.get('cache-control') === 'private, no-store' && good.headers.get('vercel-cdn-cache-control') === 'no-store' && good.headers.get('x-content-type-options') === 'nosniff', 'never kept, and never sniffed into a page');
      ok((await bytesOf(good.body)).equals(EPUB), 'every byte of it');
      ok(good.headers.get('content-length') === null, "no size announced (a gateway's own is wrong when it compressed the book)");
      serve = () => file(EPUB, {}, { 'content-length': String(pass.IPFS_PASS_MAX_BYTES + 1) });
      const big = await ask(`ipfs:${V0}`, '10.0.0.5');
      ok(big.status === 413 && /^TOO BIG TO READ HERE\. THE LIMIT IS 50 MB\.$/.test((await big.json()).error), 'too big: 413, and the reader says so');
      serve = () => file(HTML);
      ok((await ask(`ipfs:${V0}`, '10.0.0.2')).status === 415, 'a web page on IPFS: 415, nothing passed on');
      serve = () => new Response('gone', { status: 404 });
      const gone = await ask(`ipfs:${V1}`, '10.0.0.3');
      ok(gone.status === 404 && (await gone.json()).error === 'NO COPY FOUND ON IPFS.', 'no gateway has it: 404, NO COPY FOUND ON IPFS.');
      ok((await ask(`ipfs:${V0}/x`, '10.0.0.4')).status === 400, 'not a CID: refused as no book');
      serve = () => file(EPUB);
      const statuses = [];
      for (let n = 0; n < 7; n += 1) statuses.push((await ask(`ipfs:${V0}`, '10.0.0.9')).status);
      ok(statuses.slice(0, 6).every((s) => s === 200) && statuses[6] === 429, `six a minute from one address, the seventh refused (${statuses.join(',')})`);
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  console.log(`ok: ${passed} assertions (IPFS pass-through: the gate, the gateways, redirects, the cap, the route)`);
})().catch((error) => {
  console.log(`FAIL ${error.message}`);
  process.exit(1);
});
