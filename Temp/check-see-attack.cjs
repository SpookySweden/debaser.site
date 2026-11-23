/*
 * BROWSER's attack list (SPEC-seeing-machine.md, "How each phase is proved"; Luke 2026-11-23): everything the server's eye must refuse,
 * offline, with a made-up resolver and a made-up internet. (The same list is walked once for real on SERVER: scripts/see-attack-live.cjs.)
 *   npx tsc app/lib/web/safe-fetch.ts app/lib/web/public-address.ts app/lib/seeing/server/assets.ts app/lib/seeing/server/limits.ts app/lib/seeing/server/gate.ts app/lib/seeing/server/way-out.ts app/lib/seeing/server/keep.ts --rootDir app --outDir Temp/see-attack-out --module commonjs --target es2022 --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
 *   node Temp/check-see-attack.cjs
 *
 * Every case is also watched failing: the MUTANTS at the foot take one guard out of the compiled code, and the case named must then fail.
 * A guard whose removal nothing notices fails the check.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const zlib = require('node:zlib');

const OUT = path.join(__dirname, 'see-attack-out');

/** The compiled files, loaded fresh, with one of them changed when a mutant asks. */
function load(mutant) {
  const loaded = new Map();
  const take = (file) => {
    if (loaded.has(file)) return loaded.get(file).exports;
    let source = fs.readFileSync(file, 'utf8');
    if (mutant !== undefined && path.relative(OUT, file).replace(/\\/g, '/') === mutant.file) {
      assert.ok(source.includes(mutant.find), `the mutant "${mutant.name}" finds its guard`);
      source = source.split(mutant.find).join(mutant.put);
    }
    const module = { exports: {} };
    loaded.set(file, module);
    const require_ = (name) => {
      if (!name.startsWith('.')) return Module.createRequire(file)(name);
      const at = path.resolve(path.dirname(file), name);
      return take(fs.existsSync(`${at}.js`) ? `${at}.js` : path.join(at, 'index.js'));
    };
    new Function('module', 'exports', 'require', '__filename', '__dirname', source)(module, module.exports, require_, file, path.dirname(file));
    return module.exports;
  };
  const at = (name) => take(path.join(OUT, `${name}.js`));
  return { keep: at('lib/seeing/server/keep'), visits: at('lib/seeing/server/visits'), cache: at('lib/seeing/server/cache'), address: at('lib/web/public-address'), fetching: at('lib/web/safe-fetch'), assets: at('lib/seeing/server/assets'), limits: at('lib/seeing/server/limits'), gate: at('lib/seeing/server/gate'), way: at('lib/seeing/server/way-out') };
}

const HOME = '81.2.69.142';
const GOOD = '93.184.216.34';

/** A made-up internet: names to addresses (a list is answered in turn), addresses to what they answer. Everything asked is written down. */
function internet({ names = {}, answers = {}, home = HOME } = {}) {
  const asked = [];
  const turns = {};
  return {
    asked,
    way: {
      homeAddress: async () => home,
      resolve: async (name) => {
        const known = names[name];
        // Every name nobody thought of leads somewhere public: a name must be refused for what it is, not for leading nowhere.
        if (known === undefined) return [GOOD];
        if (!Array.isArray(known[0])) return known;
        turns[name] = (turns[name] ?? -1) + 1;
        return known[Math.min(turns[name], known.length - 1)];
      },
      connect: async (url, address, init) => {
        asked.push({ url: url.href, address, headers: init.headers });
        const answer = answers[url.href] ?? (() => new Response('<p>hello</p>', { headers: { 'content-type': 'text/html' } }));
        return answer(init.signal);
      },
    },
  };
}
const OPTIONS = { accept: 'text/html', maxBytes: 100_000, timeoutMs: 400, maxRedirects: 5, types: /^text\/html$/ };
const go = (to) => () => new Response(null, { status: 302, headers: { location: to } });

async function refused(M, address, net = internet(), what = address, why) {
  let answer;
  try {
    answer = await M.fetching.safeFetchAnySite(address, { ...OPTIONS, way: net.way });
  } catch (error) {
    assert.ok(error instanceof M.fetching.SafeFetchError, `${what}: refused in its own words, not by accident (${error.stack})`);
    if (why !== undefined) assert.match(error.message, why, what);
    return error.message;
  }
  assert.fail(`${what} was fetched (${answer.url})`);
}
async function neverAsked(M, address, what = address, names = {}) {
  const net = internet({ names });
  await refused(M, address, net, what);
  assert.equal(net.asked.length, 0, `${what}: nothing was connected to`);
}

const CASES = {
  async 'an ordinary page is fetched'(M) {
    const net = internet();
    const answer = await M.fetching.safeFetchAnySite('https://news.example.com.org/a?b', { ...OPTIONS, way: net.way });
    assert.equal(Buffer.from(answer.body).toString(), '<p>hello</p>');
    assert.equal(net.asked[0].address, GOOD, 'of the address that was judged');
  },
  async 'nothing of the reader or the site is sent'(M) {
    const net = internet();
    await M.fetching.safeFetchAnySite('https://example.org/', { ...OPTIONS, way: net.way });
    assert.deepEqual(Object.keys(net.asked[0].headers).sort(), ['Accept', 'Accept-Language', 'User-Agent']);
    assert.ok(!/debaser|luke/i.test(JSON.stringify(net.asked[0].headers)));
  },
  async 'this machine, in every spelling'(M) {
    for (const host of ['127.0.0.1', '127.1', '127.0.1', '2130706433', '0x7f000001', '0x7f.0.0.1', '0177.0.0.1', '017700000001', '0', '0.0.0.0', '0.1.2.3', '127.255.255.254', '[::1]', '[::]', '[0:0:0:0:0:0:0:1]', '[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '[64:ff9b::7f00:1]', 'localhost', 'LOCALHOST', 'localhost.', 'foo.localhost', '１２７.0.0.1', '127。0。0。1', '%31%32%37.0.0.1']) await neverAsked(M, `http://${host}/`);
  },
  async 'the house and its machines'(M) {
    for (const host of ['192.168.0.154', '192.168.0.1', '192.168.255.255', '10.0.0.1', '10.2.0.2', '172.16.0.1', '172.31.255.255', '172.17.0.1', '3232235674', '0xC0A8009A', '192.168.154', '[::ffff:192.168.0.154]', '[fe80::1]', '[fc00::1]', '[fd7a:115c:a1e0::1]']) await neverAsked(M, `http://${host}/`);
    for (const host of ['172.15.0.1', '172.32.0.1', '11.0.0.1', '192.167.0.1', '192.169.0.1']) await M.fetching.safeFetchAnySite(`http://${host}/`, { ...OPTIONS, way: internet().way });
  },
  async 'Tailscale'(M) {
    for (const host of ['100.64.0.1', '100.100.100.100', '100.127.255.255', 'debaser-server.tail1234.ts.net']) await neverAsked(M, `http://${host}/`);
    await M.fetching.safeFetchAnySite('http://100.63.0.1/', { ...OPTIONS, way: internet().way });
  },
  async 'link-local, multicast, reserved, documentation'(M) {
    for (const host of ['169.254.169.254', '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255', '198.18.0.1', '198.51.100.1', '203.0.113.1', '192.0.2.1', '192.88.99.1']) await neverAsked(M, `http://${host}/`);
  },
  async "the house's own public address"(M) {
    await neverAsked(M, `http://${HOME}/`);
    await neverAsked(M, 'http://home.somebody.org/', 'a name that leads to the house', { 'home.somebody.org': [HOME] });
  },
  async 'nothing is fetched when the house address is not known'(M) {
    const net = internet({ home: null });
    await refused(M, 'https://example.org/', net);
    assert.equal(net.asked.length, 0);
  },
  async 'any IPv6 address'(M) {
    for (const host of ['[2606:4700::1111]', '[2001:db8::1]', '[ff02::1]', '[2002:c0a8:9a::1]', '[64:ff9b::808:808]']) await neverAsked(M, `http://${host}/`);
    await neverAsked(M, 'https://six.org/', 'a name with an IPv6 address', { 'six.org': ['2606:4700::1111'] });
  },
  async 'the site itself'(M) {
    for (const host of ['debaser.site', 'www.debaser.site', 'api.debaser.site', 'see.debaser.site', 'DEBASER.SITE', 'debaser.site.', 'api.debaser.site.', 'debaser-site.vercel.app', 'abc.cfargotunnel.com', 'x.trycloudflare.com']) await neverAsked(M, `https://${host}/`);
    await M.fetching.safeFetchAnySite('https://notdebaser.site.org/', { ...OPTIONS, way: internet().way });
  },
  async 'names that only mean something here'(M) {
    for (const host of ['server', 'router', 'nas.local', 'printer.lan', 'x.internal', 'box.home.arpa', 'x.home', '1.168.192.in-addr.arpa', 'hidden.onion']) await neverAsked(M, `http://${host}/`);
  },
  async 'a name that resolves to the house'(M) {
    for (const address of ['127.0.0.1', '192.168.0.154', '10.0.0.5', '100.64.0.1', '169.254.169.254', '0.0.0.0', '::1', '::ffff:127.0.0.1', '012.34.56.78', '2130706433', 'localhost']) await neverAsked(M, 'https://evil.org/', `a name at ${address}`, { 'evil.org': [address] });
  },
  async 'a name with one public address and one private'(M) {
    await neverAsked(M, 'https://evil.org/', 'public then private', { 'evil.org': [GOOD, '192.168.0.154'] });
    await neverAsked(M, 'https://evil.org/', 'private then public', { 'evil.org': ['192.168.0.154', GOOD] });
  },
  async 'a name that changes its mind'(M) {
    // Public when it is judged, private a moment later: the connection must be to what was judged.
    const net = internet({ names: { 'evil.org': [[GOOD], ['127.0.0.1']] } });
    await M.fetching.safeFetchAnySite('https://evil.org/', { ...OPTIONS, way: net.way });
    assert.deepEqual(net.asked.map((each) => each.address), [GOOD]);
    const again = internet({ names: { 'evil.org': [[GOOD], ['127.0.0.1']] }, answers: { 'https://evil.org/': go('https://evil.org/2') } });
    await refused(M, 'https://evil.org/', again, 'changed by the time of a redirect');
    assert.equal(again.asked.length, 1);
  },
  async 'the way out goes where it is told, and nowhere else'(M) {
    assert.throws(() => M.way.agentFor('127.0.0.1'));
    assert.throws(() => M.way.agentFor('192.168.0.154'));
    assert.throws(() => M.way.agentFor('evil.org'));
    assert.equal(M.way.wayOut({ SEEING_EXIT: 'proton' }), null, 'a way that is not built is no way at all');
    assert.ok(M.way.wayOut({}) !== null && M.way.wayOut({ SEEING_EXIT: 'direct' }) !== null);
    const fixture = { SEEING_EXIT: 'fixture:4567', SEEING_DEV_OPEN: '1' };
    assert.ok(M.way.wayOut({ ...fixture, NODE_ENV: 'development' }) !== null);
    assert.equal(M.way.wayOut({ ...fixture, NODE_ENV: 'production' }), null, "the drives' way is never in a production build");
    assert.equal(M.way.wayOut({ SEEING_EXIT: 'fixture:4567', NODE_ENV: 'development' }), null);
  },
  async 'a redirect to the house'(M) {
    for (const to of ['http://127.0.0.1/', 'http://192.168.0.154:8080/', 'http://192.168.0.154/', 'http://100.64.0.1/', 'https://api.debaser.site/', 'http://localhost/', 'http://2130706433/', '//127.0.0.1/', 'file:///c:/windows/win.ini', 'javascript:alert(1)', 'data:text/html,x', 'http://user:pass@example.org/', 'http://example.org:22/', 'http://[::1]/']) {
      const net = internet({ answers: { 'https://example.org/': go(to) } });
      await refused(M, 'https://example.org/', net, `a redirect to ${to}`);
      assert.equal(net.asked.length, 1, `a redirect to ${to} was not followed`);
    }
  },
  async 'a redirect to a name at the house'(M) {
    const net = internet({ names: { 'evil.org': ['192.168.0.154'] }, answers: { 'https://example.org/': go('https://evil.org/') } });
    await refused(M, 'https://example.org/', net);
    assert.equal(net.asked.length, 1);
  },
  async 'a redirect that never ends'(M) {
    const net = internet({ answers: { 'https://example.org/': go('https://example.org/') } });
    await refused(M, 'https://example.org/', net, 'round and round', /ROUND/);
    assert.equal(net.asked.length, 6);
  },
  async 'other ports'(M) {
    for (const port of [22, 25, 3000, 5432, 6379, 8000, 8080, 8096, 8478, 8479, 8787, 3389, 81]) await neverAsked(M, `http://example.org:${port}/`);
    for (const address of ['http://example.org:80/', 'https://example.org:443/', 'http://example.org:443/', 'https://example.org:80/']) await M.fetching.safeFetchAnySite(address, { ...OPTIONS, way: internet().way });
  },
  async 'user names in an address'(M) {
    for (const address of ['https://me@example.org/', 'https://me:pw@example.org/', 'https://example.org@127.0.0.1/', 'https://:pw@example.org/']) await neverAsked(M, address);
  },
  async 'other schemes'(M) {
    for (const address of ['ftp://example.org/', 'file:///etc/passwd', 'gopher://example.org/', 'javascript:alert(1)', 'data:text/html,hi', 'ws://example.org/', 'blob:https://example.org/x', 'about:blank', '//example.org/', 'example.org']) await neverAsked(M, address);
  },
  async 'a name that leads nowhere'(M) {
    await neverAsked(M, 'https://gone.org/', 'no such site', { 'gone.org': [] });
  },
  async 'known malware and phishing'(M) {
    const net = internet({ names: { 'evil.org': ['0.0.0.0'] } });
    await refused(M, 'https://evil.org/', net, 'known malware', /MALWARE/);
  },
  async 'a body that says it is too large'(M) {
    let read = 0;
    const body = () => new ReadableStream({ pull(c) { read += 1; c.enqueue(new Uint8Array(1000)); if (read > 300) c.close(); } }, { highWaterMark: 0 });
    const net = internet({ answers: { 'https://example.org/': () => new Response(body(), { headers: { 'content-type': 'text/html', 'content-length': '999999999' } }) } });
    await refused(M, 'https://example.org/', net, 'declared large', /LARGE/);
    assert.equal(read, 0, 'none of it was read');
  },
  async 'a body that is too large and does not say so'(M) {
    let sent = 0;
    const body = () => new ReadableStream({ pull(c) { sent += 10_000; c.enqueue(new Uint8Array(10_000)); if (sent > 5_000_000) c.close(); } });
    const net = internet({ answers: { 'https://example.org/': () => new Response(body(), { headers: { 'content-type': 'text/html' } }) } });
    await refused(M, 'https://example.org/', net, 'endless', /LARGE/);
    assert.ok(sent < 1_000_000, 'cut off as it came, not after');
  },
  async 'a compression bomb'(M) {
    // 20 MB of nothing in about 20 KB: what is counted is what comes out.
    const squeezed = zlib.gzipSync(Buffer.alloc(20_000_000));
    assert.ok(squeezed.length < 100_000, 'small enough to pass on its squeezed size');
    const stream = () => new Response(squeezed).body.pipeThrough(new DecompressionStream('gzip'));
    const net = internet({ answers: { 'https://example.org/': () => new Response(stream(), { headers: { 'content-type': 'text/html', 'content-length': String(squeezed.length) } }) } });
    await refused(M, 'https://example.org/', net, 'a bomb', /LARGE/);
  },
  async 'a source that never answers'(M) {
    const net = internet({ answers: { 'https://example.org/': (signal) => new Promise((_, no) => signal.addEventListener('abort', () => no(signal.reason))) } });
    const started = Date.now();
    await refused(M, 'https://example.org/', net, 'silent', /TOO LONG/);
    assert.ok(Date.now() - started < 5000);
  },
  async 'a body that never ends'(M) {
    const body = (signal) => new ReadableStream({ start(c) { signal.addEventListener('abort', () => c.error(signal.reason)); c.enqueue(new Uint8Array(1)); } });
    const net = internet({ answers: { 'https://example.org/': (signal) => new Response(body(signal), { headers: { 'content-type': 'text/html' } }) } });
    await refused(M, 'https://example.org/', net, 'a drip', /STOPPED/);
  },
  async 'kinds that are not shown'(M) {
    for (const type of ['video/mp4', 'audio/mpeg', 'application/x-msdownload', 'application/octet-stream', 'image/png', '']) {
      let read = false;
      const body = () => new ReadableStream({ pull(c) { read = true; c.enqueue(new Uint8Array(1)); c.close(); } }, { highWaterMark: 0 });
      const net = internet({ answers: { 'https://example.org/': () => { const answer = new Response(body()); if (type) answer.headers.set('content-type', type); return answer; } } });
      await refused(M, 'https://example.org/', net, `type ${type}`);
      assert.equal(read, false, 'and its body is not read');
    }
  },
  async 'what else it is told to refuse, on every hop'(M) {
    const net = internet({ answers: { 'https://example.org/': go('https://signin.org/') } });
    const refuses = (url) => (url.hostname === 'signin.org' ? 'SIGN-IN PAGES ARE NEVER SHOWN HERE' : null);
    await assert.rejects(M.fetching.safeFetchAnySite('https://example.org/', { ...OPTIONS, way: net.way, refuses }), /SIGN-IN/);
    assert.equal(net.asked.length, 1);
  },

  /* --- passes --- */
  async 'a pass opens for what it was made for'(M) {
    const pass = { address: 'https://example.org/a.png', person: 'p1', kind: 'picture', until: 2000 };
    const text = M.assets.sealPass(pass);
    assert.deepEqual(M.assets.openPass(text, 1000), pass);
    assert.ok(!text.includes('example') && !Buffer.from(text, 'base64url').toString('latin1').includes('example'), 'and does not say what it is for');
    assert.notEqual(M.assets.sealPass(pass), text, 'no two alike');
  },
  async 'an altered pass'(M) {
    const text = M.assets.sealPass({ address: 'https://example.org/a.png', person: 'p1', kind: 'picture', until: 2000 });
    for (let i = 0; i < text.length; i += 3) {
      const bytes = Buffer.from(text, 'base64url');
      const at = Math.min(Math.floor((i * 3) / 4), bytes.length - 1);
      bytes[at] ^= 1;
      assert.equal(M.assets.openPass(bytes.toString('base64url'), 1000), null, `altered at ${at}`);
    }
    for (const text2 of ['', 'x', '../../etc', 'a'.repeat(9000), text.slice(0, -4), `${text}AA`, `${text}=`]) assert.equal(M.assets.openPass(text2, 1000), null);
  },
  async 'an expired pass'(M) {
    const text = M.assets.sealPass({ address: 'https://example.org/a.png', person: 'p1', kind: 'picture', until: 2000 });
    assert.equal(M.assets.openPass(text, 2000), null);
    assert.equal(M.assets.openPass(text, 9000), null);
  },
  async "somebody else's key"(M) {
    const text = M.assets.sealPass({ address: 'https://example.org/a.png', person: 'p1', kind: 'picture', until: 2000 }, Buffer.alloc(32, 7));
    assert.equal(M.assets.openPass(text, 1000), null);
  },
  async 'HTML sent as a picture, and what each kind may be'(M) {
    for (const kind of ['picture', 'style', 'font', 'script', 'module']) for (const type of ['text/html', 'application/xhtml+xml', 'video/mp4', 'audio/mpeg', 'application/pdf', 'multipart/x-mixed-replace']) assert.ok(!M.assets.ASSET_TYPES[kind].test(type), `${kind} as ${type}`);
    for (const type of ['video/mp4', 'audio/mpeg', 'application/x-mpegurl']) assert.ok(!M.assets.ASSET_TYPES.data.test(type));
    for (const text of ['<!doctype html><script>', '  <HTML>', '\ufeff<script>x', '<!-- x --><html>']) assert.ok(M.assets.looksLikeMarkup(Buffer.from(text)), text);
    assert.ok(!M.assets.looksLikeMarkup(Buffer.from([0x89, 0x50, 0x4e, 0x47])));
    assert.ok(M.assets.looksLikeFont(Buffer.from('wOF2xxxx')) && !M.assets.looksLikeFont(Buffer.from('MZ\u0090\u0000')));
  },
  async 'an SVG with a script, opened by itself'(M) {
    const headers = M.assets.assetHeaders('image/svg+xml');
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
    assert.match(headers['Content-Security-Policy'], /default-src 'none';.* sandbox$/);
    assert.ok(!/allow-/.test(headers['Content-Security-Policy']), 'the sandbox lets nothing back in');
    assert.match(headers['Content-Disposition'], /^attachment/);
    assert.match(headers['Cache-Control'], /^private/);
  },

  /* --- the gate --- */
  async 'no token, a bad token, a guest, another account, the off switch'(M) {
    const OWNER = '11111111-1111-4111-8111-111111111111';
    const OTHER = '22222222-2222-4222-8222-222222222222';
    const env = { NODE_ENV: 'production', NEXT_PUBLIC_AUTH_BACKEND: 'supabase', NEXT_PUBLIC_SUPABASE_URL: 'https://x', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k', SCREENS_OWNER_ID: OWNER };
    const accounts = { [`good${'a'.repeat(30)}`]: OWNER, [`other${'a'.repeat(30)}`]: OTHER };
    const deps = (more = {}) => ({ env: { ...env, ...more }, accountOf: async (token) => accounts[token] ?? null });
    const ask = (token) => new Request('https://debaser.site/api/see/open', { method: 'POST', headers: token ? { authorization: token } : {} });
    const mine = `Bearer good${'a'.repeat(30)}`;
    const theirs = `Bearer other${'a'.repeat(30)}`;
    assert.deepEqual(await M.gate.whoMaySee(ask(mine), deps()), { ok: true, person: OWNER, token: mine.slice(7) });
    for (const token of [null, 'Bearer', 'Bearer x', `Basic good${'a'.repeat(30)}`, `Bearer nobody${'a'.repeat(30)}`, `good${'a'.repeat(30)}`]) {
      const gate = await M.gate.whoMaySee(ask(token), deps());
      assert.equal(gate.ok, false, String(token));
      assert.equal(gate.status, 401);
    }
    assert.equal((await M.gate.whoMaySee(ask(theirs), deps())).ok, false, 'another account, while it is his only');
    assert.equal((await M.gate.whoMaySee(ask(theirs), deps({ SEEING_OPEN: 'accounts' }))).ok, true, 'and once it is open to accounts');
    for (const off of ['off', 'OFF', ' off ']) assert.equal((await M.gate.whoMaySee(ask(mine), deps({ SEEING_MACHINE: off }))).ok, false, 'the off switch');
    assert.equal((await M.gate.whoMaySee(ask(mine), deps({ NEXT_PUBLIC_AUTH_BACKEND: 'mock' }))).ok, false, 'mock accounts');
    assert.equal((await M.gate.whoMaySee(ask(null), deps({ NEXT_PUBLIC_AUTH_BACKEND: 'mock', SEEING_DEV_OPEN: '1' }))).ok, false, 'a production build is never open for drives');
    assert.equal((await M.gate.whoMaySee(ask(null), deps({ NODE_ENV: 'development', SEEING_DEV_OPEN: '1' }))).ok, false, 'nor a server with real accounts');
    assert.equal((await M.gate.whoMaySee(ask(null), deps({ SCREENS_OWNER_ID: '' }))).ok, false);
    assert.equal((await M.gate.whoMaySee(ask(theirs), deps({ SCREENS_OWNER_ID: '' }))).ok, false, 'no owner set: nobody');
    assert.ok(M.gate.passStands(OWNER, env) && !M.gate.passStands(OTHER, env) && !M.gate.passStands(OWNER, { ...env, SEEING_MACHINE: 'off' }) && !M.gate.passStands('dev', env), 'a pass already made ends with them');
  },

  /* --- limits --- */
  async 'limits'(M) {
    let now = 1_000_000;
    const c = M.limits.createCounter(() => now);
    for (let i = 0; i < 60; i += 1) assert.equal(c.page('a'), null);
    assert.match(c.page('a'), /MINUTE/);
    assert.equal(c.page('b'), null, 'one person at a time');
    now += 61_000;
    assert.equal(c.page('a'), null);
    for (let i = 0; i < 400; i += 1) {
      now += 1100;
      c.page('c');
    }
    assert.match(c.page('c'), /A DAY/);
    now += 24 * 3600_000;
    assert.equal(c.page('c'), null);
    assert.equal(c.page('d'), null);
    for (let i = 0; i < 200; i += 1) assert.equal(c.file('d'), true);
    assert.equal(c.file('d'), false, '200 files a page');
    c.sent('e', 200 * 1024 * 1024);
    assert.equal(c.file('e'), false, 'so much in a minute');
    let most = 0;
    let running = 0;
    const work = () => new Promise((done) => { running += 1; most = Math.max(most, running); setTimeout(() => { running -= 1; done(1); }, 5); });
    await Promise.all(Array.from({ length: 30 }, () => c.turn('f', work)));
    assert.equal(most, 6, 'six at once each');
    most = 0;
    await Promise.all(Array.from({ length: 120 }, (_, i) => c.turn(`g${i % 20}`, work)));
    assert.equal(most, 40, 'forty at once for everybody');
    assert.equal(c.atOnce(), 0);
    const hung = [];
    let free;
    const wait = new Promise((done) => { free = done; });
    for (let i = 0; i < 206; i += 1) hung.push(c.turn('h', () => wait));
    assert.equal(await c.turn('h', () => wait), null, 'too many waiting are turned away');
    free();
    await Promise.all(hung);
    // Waiting for everybody's room counts too.
    const busy = [];
    let done;
    const held = new Promise((go) => { done = go; });
    for (let i = 0; i < 40; i += 1) busy.push(c.turn(`j${i % 10}`, () => held));
    for (let i = 0; i < 200; i += 1) busy.push(c.turn('k', () => held));
    assert.equal(await c.turn('k', () => held), null, "too many waiting for everybody's room are turned away too");
    const gone = new AbortController();
    let ran = false;
    busy.push(c.turn('l', async () => { ran = true; }, gone.signal));
    gone.abort();
    done();
    await Promise.all(busy);
    assert.equal(ran, false, 'nothing is fetched for somebody who has gone');
    assert.equal(c.atOnce(), 0);
  },
  "a kept copy": async (M) => {
    const OWNER = '11111111-1111-4111-8111-111111111111';
    const page = (text) => () => new Response(text, { headers: { 'content-type': 'text/html' } });
    const keep = async (address, answers, { person = OWNER, env = {}, writes = true } = {}) => {
      const net = internet({ answers });
      const deps = {
        gate: { env: { NODE_ENV: 'production', NEXT_PUBLIC_AUTH_BACKEND: 'supabase', NEXT_PUBLIC_SUPABASE_URL: 'https://x', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k', SCREENS_OWNER_ID: OWNER, ...env }, accountOf: async () => person },
        way: net.way, counter: M.limits.createCounter(), cache: M.cache.createCache(), visits: { write: async () => writes }, now: Date.now,
      };
      const request = new Request('https://debaser.site/api/see/keep', { method: 'POST', body: JSON.stringify({ address }), headers: { 'content-type': 'application/json', authorization: `Bearer ${'a'.repeat(40)}` } });
      const answer = await M.keep.keepAnswer(request, deps);
      return { status: answer.status, asked: net.asked, ...(await answer.json()) };
    };
    const other = { person: '22222222-2222-4222-8222-222222222222' };
    assert.equal((await keep('https://page.org/', {}, other)).status, 403, 'nobody but the owner');
    const unwritten = await keep('https://page.org/', {}, { ...other, env: { SEEING_OPEN: 'accounts' }, writes: false });
    assert.deepEqual([unwritten.status, unwritten.asked.length], [503, 0], 'nothing is looked at for somebody whose visit could not be written down');
    for (const address of ['https://accounts.google.com/', 'https://doubleclick.net/', 'http://127.0.0.1/']) {
      const answer = await keep(address, {});
      assert.deepEqual([answer.status, answer.asked.length], [403, 0], `${address} is not kept`);
    }
    const sent = await keep('https://page.org/', { 'https://page.org/': go('https://accounts.google.com/') });
    assert.deepEqual([sent.status, sent.asked.length], [403, 1], 'nor where a page leads to one');
    const made = await keep('https://page.org/', { 'https://page.org/': page('<script>a()</script><p onclick=b()>x<form action=/in><input></form><img src=https://127.0.0.1/a.png><img src=/v.svg><iframe src=https://evil.org/></iframe>'), 'https://page.org/v.svg': () => new Response('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>', { headers: { 'content-type': 'image/svg+xml' } }) });
    assert.equal(made.ok, true);
    assert.ok(!/<script|onclick|<form|<iframe|127\.0\.0\.1|svg|data:image/.test(made.copy.html), made.copy.html);
    for (const [status, text] of [[403, '<p>not for you'], [200, '<form><input type=password></form>']]) assert.equal((await keep('https://page.org/', { 'https://page.org/': () => new Response(text, { status, headers: { 'content-type': 'text/html' } }) })).copy, null, 'what is not the page itself is not copied');
    const sheets = await keep('https://page.org/', { 'https://page.org/': page('<p>x' + '<link rel=stylesheet href=/s.css>'.repeat(60)), 'https://page.org/s.css': () => new Response('a{color:red}'.repeat(20_000), { headers: { 'content-type': 'text/css' } }) });
    assert.ok(sheets.copy !== null && sheets.copy.html.length < 10.5 * 1024 * 1024 && sheets.copy.html.length > 9 * 1024 * 1024, 'one sheet many times over stops at ten megabytes');
    const noise = await require('sharp')(require('node:crypto').randomBytes(800 * 800 * 3), { raw: { width: 800, height: 800, channels: 3 } }).png().toBuffer();
    const pictures = await keep('https://page.org/', { 'https://page.org/': page('<p>x' + '<img src=/n.png>'.repeat(200)), 'https://page.org/n.png': () => new Response(noise, { headers: { 'content-type': 'image/png' } }) });
    assert.ok(pictures.copy !== null && pictures.copy.html.length < 10.5 * 1024 * 1024, 'and one picture');
  },
};

const A = 'lib/web/public-address.js';
const S = 'lib/web/safe-fetch.js';
const P = 'lib/seeing/server/assets.js';
const G = 'lib/seeing/server/gate.js';
const L = 'lib/seeing/server/limits.js';
const W = 'lib/seeing/server/way-out.js';
const K = 'lib/seeing/server/keep.js';
/** One guard out at a time. `caught` is the case that must then fail. */
const MUTANTS = [
  { name: 'loopback', file: A, find: "['127.0.0.0', 8],", put: '', caught: 'this machine, in every spelling' },
  { name: 'this network', file: A, find: "['0.0.0.0', 8],", put: '', caught: 'this machine, in every spelling' },
  { name: '192.168', file: A, find: "['192.168.0.0', 16],", put: '', caught: 'the house and its machines' },
  { name: '10', file: A, find: "['10.0.0.0', 8],", put: '', caught: 'the house and its machines' },
  { name: '172.16', file: A, find: "['172.16.0.0', 12],", put: '', caught: 'the house and its machines' },
  { name: '172.16 too wide', file: A, find: "['172.16.0.0', 12],", put: "['172.16.0.0', 8],", caught: 'the house and its machines' },
  { name: 'Tailscale range', file: A, find: "['100.64.0.0', 10],", put: '', caught: 'Tailscale' },
  { name: 'Tailscale names', file: A, find: "'ts.net', ", put: '', caught: 'Tailscale' },
  { name: 'link-local', file: A, find: "['169.254.0.0', 16],", put: '', caught: 'link-local, multicast, reserved, documentation' },
  { name: 'multicast', file: A, find: "['224.0.0.0', 4],", put: '', caught: 'link-local, multicast, reserved, documentation' },
  { name: 'reserved', file: A, find: "['240.0.0.0', 4],", put: '', caught: 'link-local, multicast, reserved, documentation' },
  { name: 'benchmarks', file: A, find: "['198.18.0.0', 15],", put: '', caught: 'link-local, multicast, reserved, documentation' },
  { name: 'own names', file: A, find: "'debaser.site', ", put: '', caught: 'the site itself' },
  { name: 'local names', file: A, find: "'local', ", put: '', caught: 'names that only mean something here' },
  { name: 'whole names only', file: A, find: '(?:\\.[a-z0-9_-]{1,63})+$', put: '(?:\\.[a-z0-9_-]{1,63})*$', caught: 'names that only mean something here' },
  { name: 'leading noughts', file: A, find: "part.length > 1 && part.startsWith('0')", put: 'false', caught: 'a name that resolves to the house' },
  { name: 'ports', file: A, find: "url.port !== '' && url.port !== '80' && url.port !== '443'", put: 'false', caught: 'other ports' },
  { name: 'user names', file: A, find: "url.username !== '' || url.password !== ''", put: 'false', caught: 'user names in an address' },
  { name: 'schemes', file: A, find: "url.protocol !== 'http:' && url.protocol !== 'https:'", put: 'false', caught: 'other schemes' },
  { name: 'IPv6', file: A, find: 'if (value === null)\n        return false;', put: 'if (value === null)\n        return true;', caught: 'any IPv6 address' },
  { name: 'the house, by name', file: S, find: 'isPublicAddress)(each, [home])', put: 'isPublicAddress)(each)', caught: "the house's own public address" },
  // Judged twice, by number and by what a name leads to; both out, since either holds alone.
  { name: 'the house, by number', file: S, find: '[home])', put: '[])', caught: "the house's own public address" },
  { name: 'house unknown', file: S, find: 'if (home === null)', put: 'if (false)', caught: 'nothing is fetched when the house address is not known' },
  { name: 'every address', file: S, find: 'addresses.every(', put: 'addresses.some(', caught: 'a name with one public address and one private' },
  { name: 'addresses judged', file: S, find: '!addresses.every(', put: 'false && !addresses.every(', caught: 'a name that resolves to the house' },
  { name: 'the judged address is used', file: S, find: 'way.connect(verdict.url, addresses[0],', put: 'way.connect(verdict.url, (await way.resolve(verdict.host, signal))[0],', caught: 'a name that changes its mind' },
  { name: 'redirects judged', file: S, find: 'const verdict = (0, public_address_1.judgeAddress)(current, [home]);', put: 'const verdict = hop > 0 ? { ok: true, url: new URL(current), host: new URL(current).hostname } : (0, public_address_1.judgeAddress)(current, [home]);', caught: 'a redirect to the house' },
  { name: 'redirects looked up again', file: S, find: '(0, public_address_1.ipv4Number)(verdict.host) === null ? await', put: 'hop > 0 ? [GOOD_] : (0, public_address_1.ipv4Number)(verdict.host) === null ? await', caught: 'a redirect to a name at the house' },
  { name: 'redirects end', file: S, find: 'hop <= options.maxRedirects; hop += 1) {\n        const verdict', put: 'hop <= 50; hop += 1) {\n        const verdict', caught: 'a redirect that never ends' },
  { name: 'malware', file: S, find: "addresses.includes('0.0.0.0')", put: 'false', caught: 'known malware and phishing' },
  { name: 'size as it comes', file: S, find: "if (total > maxBytes) {\n            await reader.cancel().catch(() => undefined);\n            throw new AnySiteRefusal('TOO LARGE');", put: "if (false) {\n            throw new AnySiteRefusal('TOO LARGE');", caught: 'a compression bomb' },
  { name: 'size as declared', file: S, find: "throw new AnySiteRefusal('TOO LARGE');\n    }\n    if (!response.body)", put: '}\n    if (!response.body)', caught: 'a body that says it is too large' },
  { name: 'time', file: S, find: 'const limit = AbortSignal.timeout(options.timeoutMs);', put: 'const limit = AbortSignal.timeout(options.timeoutMs * 20);', caught: 'a source that never answers' },
  { name: 'kinds', file: S, find: '!options.types.test(type)', put: 'false', caught: 'kinds that are not shown' },
  { name: 'refusals on every hop', file: S, find: '?? null;\n        if (barred !== null)', put: '?? null;\n        if (barred !== null && hop === 0)', caught: 'what else it is told to refuse, on every hop' },
  { name: 'an agent for a private address', file: W, find: 'if (!(0, public_address_1.isPublicAddress)(address))', put: 'if (false)', caught: 'the way out goes where it is told, and nowhere else' },
  { name: 'an unbuilt way', file: W, find: "if (name === '' || name === 'direct')", put: 'if (true)', caught: 'the way out goes where it is told, and nowhere else' },
  { name: "the drives' way, in production", file: W, find: "env.NODE_ENV !== 'production' && ", put: '', caught: 'the way out goes where it is told, and nowhere else' },
  { name: 'expiry', file: P, find: 'until > now ?', put: 'true ?', caught: 'an expired pass' },
  { name: 'the seal', file: P, find: "createDecipheriv)('aes-256-gcm', key,", put: "createDecipheriv)('aes-256-gcm', Buffer.alloc(32, 7),", caught: "somebody else's key" },
  { name: 'a bare sandbox', file: P, find: '; sandbox"', put: '; sandbox allow-scripts"', caught: 'an SVG with a script, opened by itself' },
  { name: 'nosniff', file: P, find: "'X-Content-Type-Options': 'nosniff',", put: '', caught: 'an SVG with a script, opened by itself' },
  { name: 'the off switch', file: G, find: 'if (isOff(deps.env))', put: 'if (false)', caught: 'no token, a bad token, a guest, another account, the off switch' },
  { name: 'the owner only', file: G, find: 'person === seeingOwner(deps.env) ?', put: 'true ?', caught: 'no token, a bad token, a guest, another account, the off switch' },
  { name: 'a token at all', file: G, find: 'if (person === null)', put: 'if (false)', caught: 'no token, a bad token, a guest, another account, the off switch' },
  { name: 'never open in production', file: G, find: "env.NODE_ENV !== 'production' && ", put: '', caught: 'no token, a bad token, a guest, another account, the off switch' },
  { name: 'passes end with the switch', file: G, find: 'function passStands(person, env) {\n    if (isOff(env))', put: 'function passStands(person, env) {\n    if (false)', caught: 'no token, a bad token, a guest, another account, the off switch' },
  { name: 'pages a minute', file: L, find: 'person.minute.length >= exports.LIMITS.pagesAMinute', put: 'false', caught: 'limits' },
  { name: 'pages a day', file: L, find: 'person.day.length >= exports.LIMITS.pagesADay', put: 'false', caught: 'limits' },
  { name: 'files', file: L, find: 'person.files.length >= ', put: 'false && person.files.length >= ', caught: 'limits' },
  { name: 'at once each', file: L, find: 'while (person.running >= exports.LIMITS.fetchesAtOnceEach || ', put: 'while (', caught: 'limits' },
  { name: 'waiting', file: L, find: 'if (person.parked >= exports.LIMITS.waitingEach)', put: 'if (false)', caught: 'limits' },
  { name: 'gone', file: L, find: 'signal?.aborted === true', put: 'false', caught: 'limits' },
  { name: 'at once, all', file: L, find: ' || running >= exports.LIMITS.fetchesAtOnceAll', put: '', caught: 'limits' },
  { name: "a copy's sign-ins", file: K, find: 'refuses: open_1.refusesPage, ', put: '', caught: 'a kept copy' },
  { name: "a copy's visit", file: K, find: 'if (!(await (0, open_1.recorded)(person, [(0, open_1.siteName)(address)], deps, token)))', put: 'if (false)', caught: 'a kept copy' },
  { name: "a copy's scripts", file: K, find: 'answer.url, sign, false)', put: 'answer.url, sign, true)', caught: 'a kept copy' },
  { name: "a copy's forms", file: K, find: 'noForms(filled(page.html))', put: 'filled(page.html)', caught: 'a kept copy' },
  { name: "a copy's drawings", file: K, find: 'got[at] = SHRUNK.test(answered.type) ?', put: 'got[at] = true ?', caught: 'a kept copy' },
  { name: 'a copy of a refusal', file: K, find: 'answer.status === 200 && ', put: '', caught: 'a kept copy' },
  { name: 'a copy of a sign-in', file: K, find: ' && !(page.signIn && reading === null)', put: '', caught: 'a kept copy' },
  { name: "a copy's sheets", file: K, find: 'if (sheet.length > left)', put: 'if (false)', caught: 'a kept copy' },
  { name: "a copy's pictures", file: K, find: 'if (data.length > left)', put: 'if (false)', caught: 'a kept copy' },
];

// Timeouts don't hold the process open by themselves: without this, a case left hanging would end the run quietly, as if it had passed.
setInterval(() => undefined, 1000);
let finished = false;
process.on('exit', () => {
  if (!finished) process.exitCode = 1;
});

(async () => {
  globalThis.GOOD_ = GOOD;
  const real = load();
  for (const [name, run] of Object.entries(CASES)) {
    try {
      await run(real);
    } catch (error) {
      error.message = `${name}: ${error.message}`;
      throw error;
    }
  }
  let missed = 0;
  for (const mutant of MUTANTS) {
    const changed = load(mutant);
    assert.ok(CASES[mutant.caught] !== undefined, `${mutant.caught} is a case`);
    let caught = false;
    try {
      await Promise.race([CASES[mutant.caught](changed), new Promise((_, no) => setTimeout(() => no(new Error('hung')), mutant.file === K ? 30_000 : 3000).unref())]);
    } catch {
      caught = true;
    }
    if (!caught) { console.log(`NOT CAUGHT: with "${mutant.name}" taken out, "${mutant.caught}" still passed`); missed += 1; }
  }
  assert.equal(missed, 0, 'every guard is missed when it is gone');
  finished = true;
  console.log(`the attack list: ${Object.keys(CASES).length} cases refused or held, ${MUTANTS.length} guards each watched failing when taken out`);
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
