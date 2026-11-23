/*
 * BROWSER's rewriter, READER and the routes' answers (SPEC-seeing-machine.md, Phase 2; Luke 2026-11-23), offline: made-up pages and a
 * made-up internet. (What may be fetched at all is check-see-attack.cjs; the frame in a real browser is scripts/drive-see.cjs.)
 *   npx tsc app/lib/seeing/server/open.ts --rootDir app --outDir Temp/see-rewrite-out --module commonjs --target es2022 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strictNullChecks
 *   node Temp/check-see-rewrite.cjs
 *
 * - nothing on a page is left pointing anywhere: pictures, sets, styles, fonts, imports, scripts and modules are signed, and frames,
 *   plug-ins, the page's own policy, refreshes, hints and base go; links become whole addresses
 * - known ad servers and trackers are refused and said, once each; their boxes are marked, and words like `gradient` are not
 * - a password box is dead; with scripts off no script and no handler is left
 * - broken pages, a Shift_JIS page, a page in a raw element that never ends, scripts holding `<!-- <script>`, and a 5 MB page
 * - READER: the story and not the furniture, every tag ours, nothing of the page's markup
 * - the routes: no session, nothing fetched; another account, nothing fetched; a file by pass only, for as long as it stands; HTML sent
 *   as a picture refused; sign-in pages refused on a redirect too; nothing of the address in any answer's address
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const at = (name) => require(path.join(__dirname, 'see-rewrite-out/lib/seeing/server', name));
const { rewritePage, rewriteSrcset, siteOf } = at('rewrite.js');
const { rewriteCss } = at('css.js');
const { rewriteImports, rewriteLocation } = at('modules.js');
const { readingOf } = at('reading.js');
const { wordsOf } = at('words.js');
const { tokensOf, decodeEntities } = at('html.js');
const { watcherAt } = at('watchers-list.js');
const { refusesSignIn } = at('sign-ins.js');
const { createCounter } = at('limits.js');
const { createCache } = at('cache.js');
const { createMemoryVisits } = at('visits.js');
const assets = at('assets.js');
const open = at('open.js');

const PAGE = 'https://news.seeing.org/a/story?x=1';
const signed = [];
const sign = (address, kind) => {
  if (!/^https?:/.test(address)) return null;
  signed.push([kind, address]);
  return `https://see.org/api/see/asset/${kind}-${signed.length}`;
};
const write = (html, scripts = true) => {
  signed.length = 0;
  return rewritePage(html, PAGE, sign, scripts);
};
const has = (kind, address) => assert.ok(signed.some((each) => each[0] === kind && each[1] === address), `${kind} ${address} was signed (${JSON.stringify(signed)})`);

/* ------------------------------------------------------------------ addresses */
let p = write('<img src="b.png" srcset="/c.png 1x, d.png 2x"><picture><source srcset="e.webp 640w,f.webp 1280w"></picture><link rel=stylesheet href=s.css media=print><script src="//cdn.seeing.org/x.js" integrity=sha256-x crossorigin nonce=1></script><script type=module src=/m.js></script>');
for (const each of [['picture', 'https://news.seeing.org/a/b.png'], ['picture', 'https://news.seeing.org/c.png'], ['picture', 'https://news.seeing.org/a/d.png'], ['picture', 'https://news.seeing.org/a/f.webp'], ['style', 'https://news.seeing.org/a/s.css'], ['script', 'https://cdn.seeing.org/x.js'], ['module', 'https://news.seeing.org/m.js']]) has(...each);
assert.ok(!/integrity|crossorigin|nonce/.test(p.html), 'what binds a file to its first bytes goes');
assert.match(p.html, /<style media="print">@import url\("https:/);
assert.equal(p.files, 8);
p = write('<base href="/other/" target=_blank><base href="/third/"><img src=q.png><a href=r.html>r</a>');
has('picture', 'https://news.seeing.org/other/q.png');
assert.match(p.html, /<a href="https:\/\/news\.seeing\.org\/other\/r\.html">/);
assert.ok(!/<base/.test(p.html));
p = write('<a href="#top">1</a><a href="/a/story?x=1#two">2</a><a href="../z">3</a><a href="javascript:go()">4</a><a href="data:text/html,x">5</a><a href="mailto:a@b.org" ping="https://x.org" target=_blank download>6</a><a href=" https://e.org/?a=1&amp;b=2 ">7</a>');
assert.match(p.html, /href="#top">1.*href="#two">2.*href="https:\/\/news\.seeing\.org\/z">3.*href="javascript:go\(\)">4<\/a><a>5.*href="mailto:a@b\.org">6.*href="https:\/\/e\.org\/\?a=1&amp;b=2">7/);
assert.ok(!/ping|target|download/.test(p.html));
assert.ok(!/javascript:/.test(write('<a href="java&#x73;cript:go()">x</a>', false).html), 'scripts off: no javascript: address');

/* ------------------------------------------------------------------ what goes */
p = write('<!DOCTYPE html><html lang=fr><head><meta charset=x><meta http-equiv=refresh content="0;url=https://evil.org"><meta http-equiv="Content-Security-Policy" content="x"><link rel="preload prefetch" href=/a><link rel=dns-prefetch href=//t.org><link rel=icon href=/i><link rel=manifest href=/m><link rel="modulepreload" href=/mp.js><title>A &amp; B &lt;i&gt;</title></head><body><object data=/o.swf><p>fallback</p></object><embed src=/e><applet code=x></applet><form action=/s><input name=q formaction=/evil></form><portal src=/p></portal><noembed><p>x</p></noembed><script type=importmap>{"imports":{"a":"/a.js"}}</script><script type=speculationrules>{}</script>');
for (const gone of ['refresh', 'http-equiv', 'evil.org', 'preload', 'prefetch', 'manifest', 'rel="icon"', '<object', '<embed', '<applet', '<portal', 'formaction', 'importmap', 'speculationrules', '"imports"']) assert.ok(!p.html.includes(gone), `${gone} goes`);
assert.ok(p.html.includes('<p>fallback</p>'), 'what a plug-in falls back to may be read');
assert.match(p.html, /<form action="https:\/\/news\.seeing\.org\/s">/);
assert.equal(p.title, 'A & B <i>');
assert.equal(p.language, 'fr');
p = write('<iframe src="https://player.video.org/embed/1" srcdoc="<script>x</script>" width=640 height=360><p>inside</p></iframe><p>after');
assert.match(p.html, /^<a data-see-frame href="https:\/\/player\.video\.org\/embed\/1">\[ FRAME: player\.video\.org \]<\/a><p>after$/);
p = write('<video src=/v.mp4 poster=/p.jpg autoplay><source src=/v.webm type=video/webm><track src=/t.vtt></video><audio src=/a.mp3></audio>');
assert.ok(!/\ssrc=/.test(p.html), 'video and sound never pass through');
assert.deepEqual(signed.map((each) => each[0]), ['picture'], 'only a poster');

// However it is written, in a script's words too, no browser finds a frame.
for (const html of ['<p><IFRAME>', '<iframe/src=x>', '<svg><iframe></svg>', '<script>x="<iframe src=y>"</script>', '<textarea><iframe></textarea>', '<title></title><frame>', '<a title="<iframe>">', '<x<iframe>', '<!--><iframe>', '<iframe\n', '<math><mtext></mtext><iframe></math>', '<noscript><iframe></noscript>', '<template><iframe></template>', '<style><iframe></style>', '<object>', '<embed>', '<frameset><frame>', '<noembed><link rel=preconnect></noembed>', '<svg><style><p><link></style></svg>', '<svg><script><p><link></script></svg>', '<LINK rel=icon>', '<link rel=stylesheet href=/s.css>', '<xmp><link></xmp>']) assert.ok(!/<\/?(?:iframe|frame|frameset|object|embed|link)(?![a-z0-9-])/i.test(write(html).html), html);

/* ------------------------------------------------------------------ styles */
const css = (text) => {
  signed.length = 0;
  return rewriteCss(text, (address, kind) => sign(new URL(address, PAGE).href, kind));
};
assert.match(css('@import "x.css"; @import url(y.css) screen; a{background:url( "b.png" )}'), /^@import url\("https:\/\/see.*"\); @import url\(".*"\) screen; a\{background:url\(".*"\)\}$/);
assert.deepEqual(signed.map((each) => each[0]), ['style', 'style', 'picture']);
css('@font-face{font-family:x;src:url(f.woff2) format("woff2")} b{background:url(c.png)}');
assert.deepEqual(signed.map((each) => each[0]), ['font', 'picture']);
for (const [text, want] of [['a{background:u\\72l(x.png)}', 1], ['a{background:URL(x.png)}', 1], ['a{background:url(x.png', 1], ['a{background:url("x.png', 1], ['a{background:image-set("x.png" 1x, "y.png" 2x)}', 2], ['a{content:"url(no.png)"}', 0], ['/* url(no.png) */', 0], ['a{background:url(data:image/png;base64,AAAA)}', 0], ['a{background:url(#clip)}', 0], ['@import/**/"x.css";', 1], ['a{b:c}@IMPORT \'x.css\'', 1]]) {
  css(text);
  assert.equal(signed.length, want, text);
}
assert.ok(!/javascript:/.test(css('a{background:url(javascript:alert(1))}')));
assert.ok(!/<\/style/i.test(css('a{content:"</style><script>x"}')), 'nothing in a sheet can close its element');
assert.equal(rewriteCss('a{background:url(x)}', () => null), 'a{background:url("")}', 'a refused one points nowhere');
assert.ok(!css('a{background:url("x\\22 );b:url(y")}').includes('y")}'), 'an escaped quote ends nothing');
p = write('<style>@import "k.css";</style><p style="background:url(&quot;l.png&quot;)">');
has('style', 'https://news.seeing.org/a/k.css');
has('picture', 'https://news.seeing.org/a/l.png');
p = write('<svg><style>a{fill:url(m.svg)}</style><image href=n.png /><use xlink:href="#x"/><use href="https://e.org/sprite.svg#a"/><script>1</script></svg>', false);
has('picture', 'https://news.seeing.org/a/n.png');
assert.ok(!p.html.includes('<script'), 'scripts off: none in a drawing either');
assert.equal(rewriteSrcset('a.png, b.png 2x,c.png 3x, data:image/png;base64,AA== 4x', (one) => `S(${one})`), 'S(a.png), S(b.png) 2x, S(c.png) 3x, data:image/png;base64,AA== 4x');
assert.equal(rewriteImports('import a from"./a.js";import"/b.js";export*from \'https://c.org/c.js\';import("./d.js");import r from"react";const s="from \'./e\'x"', (x) => `<${x}>`), 'import a from"<./a.js>";import"</b.js>";export*from \'<https://c.org/c.js>\';import("<./d.js>");import r from"react";const s="from \'<./e>\'x"', 'in the quotes it came in, so a string stays a string');

for (const [text, want] of [
  ['location.href="/a"', '__seeLocation.href="/a"'],
  ['window.location="/a"', 'window.__seeLocation="/a"'],
  ['top.location.replace(x)', 'window.__seeLocation.replace(x)'],
  ['if(document.location.hostname==="x")', 'if(window.__seeLocation.hostname==="x")'],
  ['location = "/b"', '__seeLocation = "/b"'],
  ['a.location.href', 'a.location.href'],
  ['const location=f()', 'const location=f()'],
  ['function r({a,location="x"}){return location.pathname}', 'function r({a,location="x"}){return location.pathname}'],
  ['{location:1,window:2}', '{location:1,window:2}'],
  ['location==x', 'location==x'],
  ['geolocation.href', 'geolocation.href'],
  ['mylocation = 1', 'mylocation = 1'],
]) assert.equal(rewriteLocation(text), want, text);
p = write('<meta http-equiv=Refresh content="3; url=\'/on\'"><script>location.href="/a"</script><script type="application/json">{"location":"window.location"}</script>');
assert.deepEqual(p.refresh, { address: 'https://news.seeing.org/on', after: 3 });
assert.ok(p.html.includes('__seeLocation.href="/a"') && p.html.includes('"window.location"') && !/refresh/i.test(p.html));
assert.equal(write('<meta http-equiv=refresh content="5">').refresh, null, 'a page that only reloads itself is left');

/* ------------------------------------------------------------------ watchers, billboards, sign-ins */
p = write('<script src="https://www.googletagmanager.com/gtm.js?id=1"></script><img src="https://www.google-analytics.com/p.gif"><img src="https://sb.scorecardresearch.com/p"><img src="https://cdn.other.org/x.png"><img src="https://img.seeing.org/y.png"><iframe src="https://ad.doubleclick.net/x" width=300 height=250></iframe>');
assert.equal(p.refused, 4);
assert.deepEqual(p.watchers.map((each) => [each.company, each.refused]), [['Google', true], ['Google', true], ['Comscore', true], ['other.org', false], ['Google', true]], 'each once, who they are, and the site\'s own are nobody');
assert.ok(!/googletagmanager|google-analytics|scorecard|doubleclick/.test(p.html), 'nothing of theirs is left');
assert.match(p.html, /<span data-see-ad style="[^"]*width:300px;height:250px/);
for (const mark of ['ad', 'ads', 'ad-slot', 'banner_ad', 'google-ads-1', 'adsbygoogle', 'x advert y', 'div-gpt-ad-123']) assert.match(write(`<div class="${mark}">x</div>`).html, /data-see-ad/, mark);
for (const mark of ['header', 'gradient', 'download', 'add', 'shadow', 'ready', 'loading', 'adapt', 'road']) assert.ok(!/data-see-ad/.test(write(`<div class="${mark}">x</div>`).html), mark);
assert.ok(!/data-see-(?:ad|dead|waiting)/.test(write('<div data-see-ad data-see-waiting>x</div>').html), "a page can't make our marks");
p = write('<form><input type=text name=u><input TYPE="PassWord" name=p value=secret></form>');
assert.equal(p.signIn, true);
assert.ok(!/secret|type="password"/i.test(p.html) && /disabled data-see-dead/.test(p.html));
for (const host of ['accounts.google.com', 'login.microsoftonline.com', 'x.okta.com', 'online.hsbc.co.uk', 'appleid.apple.com']) assert.ok(refusesSignIn(new URL(`https://${host}/a`)), host);
for (const address of ['https://github.com/login', 'https://github.com/login/oauth', 'https://x.com/i/flow/login']) assert.ok(refusesSignIn(new URL(address)), address);
for (const address of ['https://github.com/loginov/repo', 'https://github.com/', 'https://www.google.com/', 'https://notokta.com/', 'https://hsbc.co.uk.evil.org/']) assert.equal(refusesSignIn(new URL(address)), null, address);
assert.equal(watcherAt('notdoubleclick.net'), null);
assert.equal(watcherAt('a.b.doubleclick.net.').company, 'Google');
assert.equal(siteOf('www.bbc.co.uk'), 'bbc.co.uk');

/* ------------------------------------------------------------------ scripts off */
p = write('<body onload=x() ONCLICK="y()"><script>bad()</script><script src=/a.js></script><noscript><p>plain</p></noscript><img data-src=/lazy.png src="data:image/gif;base64,AA"><p>end', false);
assert.ok(!/<script|bad\(\)|onload|onclick/i.test(p.html));
assert.match(p.html, /<div><p>plain<\/p><\/div>/);
has('picture', 'https://news.seeing.org/lazy.png');
assert.match(write('<noscript><p>plain</p></noscript><p onclick="y()">').html, /<template><p>plain<\/p><\/template><p onclick="y\(\)">/);

/* ------------------------------------------------------------------ broken pages */
for (const [html, want] of [
  ['<p>one<p>two<div>three', '<p>one<p>two<div>three'],
  ['a < b && c > d', 'a &lt; b && c > d'],
  ['<img src=x.png', ''],
  ['<p title="never closed>x', ''],
  ['<!-- never closed <img src=x>', ''],
  ['<!--><p>1</p><!---><p>2</p>', '<p>1</p><p>2</p>'],
  ['<p a="1" a="2">', '<p a="1">'],
  ["<p a='say \"hi\"'>", '<p a="say &quot;hi&quot;">'],
  ['</><p>x</p></ p>', '<p>x</p>'],
  ['<![CDATA[<b>x</b>]]>', 'x</b>]]>'],
  ['<textarea><script>no()</script></textarea>', '<textarea><script>no()</script></textarea>'],
  ['<title><img src=x></title>', '<title><img src=x></title>'],
]) {
  const got = write(html).html;
  assert.equal(got, want, html);
}
const script = (text) => [...tokensOf(`<script>${text}</script><b>`)].filter((each) => each.kind === 'raw').map((each) => each.text);
assert.deepEqual(script('if(a<b){"</p>"}'), ['if(a<b){"</p>"}']);
assert.deepEqual(script('<!-- <script>x</script> -->y'), ['<!-- <script>x</script> -->y'], 'as a browser reads it');
assert.deepEqual(script('<!-- x'), ['<!-- x']);
assert.equal([...tokensOf('<style>a{}')].at(-1).text, 'a{}', 'a sheet that never ends is one');
assert.deepEqual([...tokensOf('<svg><title><b>x</b></title></svg><title><b>')].filter((each) => each.kind === 'raw').map((each) => each.text), ['<b>'], "a drawing's title holds tags, a page's holds words");
assert.equal(decodeEntities('&amp;&lt;&#x41;&#66;&copy;&copy=1&nbsp;&#0;&#128;'), '&<AB\u00a9&copy=1\u00a0\ufffd\u20ac');

const sjis = Buffer.concat([Buffer.from('<meta charset="Shift_JIS"><title>'), Buffer.from([0x93, 0xfa, 0x96, 0x7b]), Buffer.from('</title>')]);
assert.equal(write(wordsOf(sjis, null)).title, '\u65e5\u672c');
assert.equal(wordsOf(Buffer.from([0x93, 0xfa]), 'shift_jis'), '\u65e5');
assert.equal(wordsOf(Buffer.from('caf\u00e9'), 'no-such-alphabet'), 'caf\u00e9');
assert.equal(wordsOf(Buffer.from([0xff, 0xfe, 0x41, 0]), 'utf-8'), 'A');

const big = `<p class=ad-slot>${'<div style="background:url(x.png)"><a href=/y>word word</a><img src=z.png></div>'.repeat(60_000)}`;
assert.ok(big.length > 4_500_000);
let started = performance.now();
p = write(big);
assert.ok(p.files === 120_000 && performance.now() - started < 15_000, `a 5 MB page in ${Math.round(performance.now() - started)} ms`);
started = performance.now();
for (const nasty of ['<'.repeat(200_000), '<a '.repeat(100_000), '<!--'.repeat(100_000), '&'.repeat(300_000), `<script>${'<!--'.repeat(50_000)}`, `<style>${'url('.repeat(50_000)}`, `<p style="${'/*'.repeat(50_000)}">`, '<svg>'.repeat(50_000), `<img srcset="${'a '.repeat(50_000)}">`, `<a href="${'&#'.repeat(50_000)}">`]) write(nasty);
assert.ok(performance.now() - started < 10_000, `pages made to be slow to read: ${Math.round(performance.now() - started)} ms`);

// The same to READER, which makes a tree: depth and stray ends must cost nothing, and end in an answer, not a stack.
for (const nasty of ['<div>'.repeat(700_000) + '</b>'.repeat(300_000), '<p>'.repeat(1_000_000), '<svg>'.repeat(400_000) + '</x>'.repeat(400_000), '<math><mi>'.repeat(200_000) + '</q>'.repeat(200_000), '<ul><li>'.repeat(300_000), '<a class="' + 'ad '.repeat(1_000_000) + '">', '<b '.concat('x=1 '.repeat(900_000), '>'), '<base href='.repeat(300_000), 'from' + ' '.repeat(2_000_000), '<script>' + 'import '.repeat(400_000), '<script>window' + ' '.repeat(2_000_000) + '</script>']) {
  const began = performance.now();
  write(nasty);
  readingOf(nasty, PAGE, null, sign);
  const took = performance.now() - began;
  assert.ok(took < 6_000, `${nasty.slice(0, 20)}... (${Math.round(nasty.length / 1e6)} MB) took ${Math.round(took)} ms`);
}

/* ------------------------------------------------------------------ READER */
const words = (n) => Array.from({ length: n }, (_, i) => `word${i},`).join(' ');
const story = `<html><head><title>Story - Site</title></head><body><nav><ul><li><a href=/1>${words(30)}</a></li></ul></nav><header class=masthead>Masthead ${words(30)}</header><div id=content><article class=story><h1>Story</h1><p>First ${words(60)}</p><script>track()</script><p>Second <b onclick=x()>bold</b> <a href="/z?a=1&amp;b=2" onclick=y()>link</a> ${words(60)}</p><img src="pic.jpg" alt="A &quot;pic&quot;" onerror=z()><img src=px.gif width=1 height=1><div class="related-links"><a href=/r>${words(20)}</a></div><blockquote>Quote</blockquote><ul><li>one<li>two</ul><table><tr><td colspan=2>cell</table><p>&lt;script&gt;alert(1)&lt;/script&gt;</p></article></div><aside>Aside ${words(60)}</aside><footer>Footer ${words(60)}</footer></body></html>`;
signed.length = 0;
const read = readingOf(story, PAGE, 'Story - Site', sign);
for (const kept of ['<h1>Story</h1>', 'First word0', '<b>bold</b>', '<a href="https://news.seeing.org/z?a=1&amp;b=2">link</a>', 'alt="A &quot;pic&quot;"', '<blockquote>Quote</blockquote>', '<li>one</li><li>two</li>', '<td colspan="2">cell</td>', '&lt;script&gt;alert(1)&lt;/script&gt;']) assert.ok(read.includes(kept), `${kept} in ${read.slice(-700)}`);
for (const gone of ['Masthead', 'Aside', 'Footer', 'track()', 'onclick', 'onerror', '<script', 'related', 'class=', 'px.gif']) assert.ok(!read.includes(gone), `${gone} is not the story`);
assert.equal((read.match(/<h1>/g) ?? []).length, 1);
has('picture', 'https://news.seeing.org/a/pic.jpg');
assert.equal(signed.length, 1);
assert.equal(readingOf('<ul><li><a href=/1>one two</a></li></ul>', PAGE, null, sign), null, 'a page of links has no main text');
assert.ok(readingOf(`<p>${'\u79c1\u306f\u305d\u306e\u4eba\u3092\u5e38\u306b\u5148\u751f\u3068\u547c\u3093\u3067\u3044\u305f\u3002'.repeat(20)}</p>`, PAGE, null, sign) !== null, 'and one without spaces between its words has');
for (const m of readingOf(story, PAGE, '"><script>x</script>', sign).matchAll(/<\/?([a-z0-9]+)/g)) assert.ok(/^(?:h[1-6]|p|b|a|img|blockquote|ul|li|table|tr|td|tbody|div)$/.test(m[1]), m[1]);

/* ------------------------------------------------------------------ the routes */
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = { [OWNER]: `owner${'a'.repeat(30)}`, [OTHER]: `other${'a'.repeat(30)}` };
function world(answers, env = {}) {
  const asked = [];
  let now = 1_000_000;
  const visits = createMemoryVisits();
  const deps = {
    gate: {
      env: { NODE_ENV: 'production', NEXT_PUBLIC_AUTH_BACKEND: 'supabase', NEXT_PUBLIC_SUPABASE_URL: 'https://x', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k', SCREENS_OWNER_ID: OWNER, ...env },
      accountOf: async (token) => Object.entries(TOKEN).find(([, value]) => value === token)?.[0] ?? null,
    },
    way: {
      homeAddress: async () => '81.2.69.142',
      resolve: async () => ['93.184.216.34'],
      connect: async (url) => {
        asked.push(url.href);
        const answer = answers[url.href];
        return answer === undefined ? new Response('no', { status: 404, headers: { 'content-type': 'text/html' } }) : answer();
      },
    },
    counter: createCounter(() => now),
    cache: createCache(),
    visits,
    now: () => now,
  };
  return { deps, asked, visits, later: (ms) => { now += ms; } };
}
const body = (text, type, more = {}) => () => new Response(text, { headers: { 'content-type': type, ...more } });
const ask = (where, data, person = OWNER, headers = {}) => new Request(`https://debaser.site/api/see/${where}`, { method: 'POST', body: JSON.stringify(data), headers: { 'content-type': 'application/json', origin: 'https://debaser.site', ...(person ? { authorization: `Bearer ${TOKEN[person] ?? person}` } : {}), ...headers } });
const passIn = (text) => /\/api\/see\/asset\/([\w-]+)/.exec(text)[1];
const file = (pass, deps) => open.assetRoute(new Request(`https://debaser.site/api/see/asset/${pass}`), pass, deps);

(async () => {
  const answers = {
    'https://page.org/': body('<title>T</title><img src=/a.png><link rel=stylesheet href=/s.css><script type=module src=/m.js></script><p>x', 'text/html; charset=utf-8'),
    'https://page.org/a.png': body(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/png'),
    'https://page.org/s.css': body('a{background:url(b.png)}', 'text/css'),
    'https://page.org/m.js': body('import "./n.js"', 'text/javascript'),
    'https://page.org/fake.png': body('<!doctype html><script>x</script>', 'image/png'),
    'https://page.org/page.png': body('<p>', 'text/html'),
    'https://page.org/v.svg': body('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>', 'image/svg+xml'),
    'https://page.org/d.json': body('{"a":1}', 'application/json'),
    'https://page.org/pdf': body('%PDF', 'application/pdf'),
    'https://page.org/film': body('x', 'video/mp4'),
    'https://page.org/plain': body('<b>not markup</b>', 'text/plain'),
    'https://page.org/pic': body(new Uint8Array([1]), 'image/png'),
    'https://page.org/go': () => new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/signin' } }),
  };
  let w = world(answers);
  const opened = await (await open.openAnswer(ask('open', { address: 'https://page.org/' }), w.deps)).json();
  assert.equal(opened.ok, true);
  const { document } = opened;
  assert.deepEqual([document.title, document.eye, document.files, document.status, document.scripts, document.assets], ['T', 'SERVER EYE', 3, 200, true, 'https://debaser.site/api/see/asset/']);
  assert.ok(!/page\.org/.test(document.html), 'nothing of the address is in any file address');
  assert.equal(w.visits.rows.length, 0, "the owner's own pages are not recorded");

  // Every way of not being allowed: refused, and nothing was fetched.
  for (const [what, request, env] of [
    ['no session', ask('open', { address: 'https://page.org/' }, null)],
    ['a made-up session', ask('open', { address: 'https://page.org/' }, 'nobody-nobody-nobody-nobody')],
    ['another account', ask('open', { address: 'https://page.org/' }, OTHER)],
    ['the off switch', ask('open', { address: 'https://page.org/' }), { SEEING_MACHINE: 'off' }],
    ['a form, not JSON', ask('open', { address: 'https://page.org/' }, OWNER, { 'content-type': 'text/plain' })],
    ['a body that is too big', ask('open', { address: 'https://page.org/', x: 'x'.repeat(70_000) })],
    ['a list', ask('open', [1])],
    ['an address that is a number', ask('open', { address: 5 })],
    ['a house address', ask('open', { address: 'http://192.168.0.154:8080/' })],
    ['the site', ask('open', { address: 'https://api.debaser.site/' })],
    ['a sign-in page', ask('open', { address: 'https://accounts.google.com/' })],
    ['open to accounts, but nowhere to write the visit', ask('open', { address: 'https://page.org/' }, OTHER), { SEEING_OPEN: 'accounts', noVisits: true }],
  ]) {
    const { noVisits, ...more } = env ?? {};
    w = world(answers, more);
    if (noVisits) w.deps.visits = { write: async () => false };
    const answer = await open.openAnswer(request, w.deps);
    const said = await answer.json();
    assert.equal(said.ok, false, what);
    assert.ok(answer.status >= 400, what);
    assert.equal(w.asked.length, 0, `${what}: nothing was fetched`);
    assert.ok(typeof said.reason === 'string' && !/Error|at \w+ \(/.test(said.reason), what);
  }
  for (const route of [open.sealAnswer, open.askedAnswer]) {
    for (const person of [null, OTHER]) {
      w = world(answers);
      assert.ok((await route(ask('x', { page: 'https://page.org/', address: 'https://page.org/d.json', files: [] }, person), w.deps)).status >= 401);
      assert.equal(w.asked.length, 0);
    }
  }

  // Somebody else, once it is open to accounts: their visit is written, by the site's name alone, before the page is fetched.
  w = world(answers, { SEEING_OPEN: 'accounts' });
  assert.equal((await (await open.openAnswer(ask('open', { address: 'https://page.org/?secret=1' }, OTHER), w.deps)).json()).ok, true);
  assert.deepEqual(w.visits.rows.map(({ person, site }) => ({ person, site })), [{ person: OTHER, site: 'page.org' }]);
  // What a script asks for, and what it has signed, are written too: there is no way to have a thing fetched that is not.
  await open.askedAnswer(ask('ask', { page: 'https://page.org/', address: 'https://elsewhere.org/x' }, OTHER), w.deps);
  await open.sealAnswer(ask('seal', { page: 'https://page.org/', files: [{ address: '/a.png', kind: 'picture' }, { address: 'https://third.org/b.png', kind: 'picture' }] }, OTHER), w.deps);
  assert.deepEqual(w.visits.rows.map(({ site }) => site), ['page.org', 'elsewhere.org', 'third.org'], 'each site once in a while');
  w = world(answers, { SEEING_OPEN: 'accounts' });
  w.deps.visits = { write: async () => false };
  assert.ok((await open.askedAnswer(ask('ask', { page: 'https://page.org/', address: 'https://page.org/d.json' }, OTHER), w.deps)).status >= 400);
  assert.ok((await open.sealAnswer(ask('seal', { page: 'https://page.org/', files: [{ address: '/a.png', kind: 'picture' }] }, OTHER), w.deps)).status >= 400);
  assert.equal(w.asked.length, 0, 'and with nowhere to write, nothing is');

  // Files, by pass.
  w = world(answers);
  const page = (await (await open.openAnswer(ask('open', { address: 'https://page.org/' }), w.deps)).json()).document;
  const picture = await file(passIn(page.html), w.deps);
  assert.equal(picture.status, 200);
  assert.equal(picture.headers.get('content-type'), 'image/png');
  assert.match(picture.headers.get('content-security-policy'), /sandbox$/);
  const before = w.asked.length;
  await file(passIn(page.html), w.deps);
  assert.equal(w.asked.length, before, 'kept for a little while');
  const sheetPass = passIn(/@import url[^;]+/.exec(page.html)[0]);
  const sheet = await (await file(sheetPass, w.deps)).text();
  assert.match(sheet, /url\("https:\/\/debaser\.site\/api\/see\/asset\//);
  const module_ = await (await file(passIn(/<script type="module"[^>]+>/.exec(page.html)[0]), w.deps)).text();
  assert.match(module_, /^import "https:\/\/debaser\.site\/api\/see\/asset\//);
  for (const pass of ['', 'x', `${passIn(page.html).slice(0, -2)}AA`, '..%2f..']) assert.equal((await file(pass, w.deps)).status, 403, 'no pass, no file');
  w.deps.gate.env.SEEING_MACHINE = 'off';
  assert.equal((await file(passIn(page.html), w.deps)).status, 403, 'the off switch reaches pages already open');
  w.deps.gate.env.SEEING_MACHINE = '';
  w.later(60 * 60_000 + 1);
  assert.equal((await file(passIn(page.html), w.deps)).status, 403, 'a pass ends');

  const passFor = (address, kind, w2) => assets.sealPass({ address, kind, person: OWNER, until: w2.deps.now() + 1000 });
  w = world(answers);
  for (const [address, kind, what] of [['https://page.org/fake.png', 'picture', 'HTML sent as a picture'], ['https://page.org/page.png', 'picture', 'a page'], ['https://page.org/film', 'picture', 'a film'], ['https://page.org/a.png', 'script', 'a picture as a script'], ['https://page.org/a.png', 'style', 'a picture as a sheet'], ['https://page.org/gone', 'picture', 'a 404'], ['http://127.0.0.1/', 'picture', 'this machine'], ['https://accounts.google.com/x', 'picture', 'a sign-in host'], ['https://www.google-analytics.com/x', 'script', 'a tracker']]) {
    const answer = await file(passFor(address, kind, w), w.deps);
    assert.ok(answer.status >= 400, `${what} is refused`);
    assert.match(answer.headers.get('content-type'), /^text\/plain/);
  }
  const svg = await file(passFor('https://page.org/v.svg', 'picture', w), w.deps);
  assert.equal(svg.status, 200);
  assert.match(svg.headers.get('content-security-policy'), /^default-src 'none'.*sandbox$/, 'a drawing with a script in it is nobody, and can do nothing');
  assert.equal((await file(assets.sealPass({ address: 'https://page.org/a.png', kind: 'picture', person: OTHER, until: 9e15 }), w.deps)).status, 403, 'a pass for somebody it is not open to');

  // What is not a page.
  for (const [address, why] of [['https://page.org/pdf', /READ/], ['https://page.org/film', /NOT SHOWN/], ['https://page.org/go', /SIGN-IN/]]) {
    const said = await (await open.openAnswer(ask('open', { address }), w.deps)).json();
    assert.match(said.reason, why, address);
  }
  assert.match((await (await open.openAnswer(ask('open', { address: 'https://page.org/plain' }), w.deps)).json()).document.html, /&lt;b&gt;not markup/);
  assert.match((await (await open.openAnswer(ask('open', { address: 'https://page.org/pic' }), w.deps)).json()).document.html, /<img src="https:\/\/debaser\.site\/api\/see\/asset\//);

  // A script's own requests.
  const data = await open.askedAnswer(ask('ask', { page: 'https://page.org/', address: '/d.json' }), w.deps);
  assert.equal(await data.text(), '{"a":1}');
  assert.equal(data.headers.get('x-see-type'), 'application/json');
  assert.equal(data.headers.get('content-type'), 'application/octet-stream', 'never a document of ours');
  for (const address of ['http://localhost/', 'https://api.debaser.site/rest/v1/', 'https://www.google-analytics.com/collect', 'file:///c:/', 'https://page.org/film']) assert.equal((await open.askedAnswer(ask('ask', { page: 'https://page.org/', address }), w.deps)).status, 403, address);
  const sealed = await (await open.sealAnswer(ask('seal', { page: 'https://page.org/a/', files: [{ address: 'b.png', kind: 'picture' }, { address: 'https://doubleclick.net/x.js', kind: 'script' }, { address: 'c', kind: 'data' }, { address: 'd', kind: 'nonsense' }, null, { address: 'javascript:x', kind: 'script' }] }), w.deps)).json();
  assert.deepEqual(sealed.addresses.map((each) => each === null), [false, true, true, true, true, true]);
  assert.equal((await open.sealAnswer(ask('seal', { page: 'https://page.org/', files: Array(61).fill({ address: 'x', kind: 'picture' }) }), w.deps)).status, 400);

  // Kept files: an end, and no more than there is room for.
  let now = 0;
  const small = createCache(1000, 100, () => now);
  small.put('a', { type: 'x', body: new Uint8Array(100) });
  assert.ok(small.get('a'));
  now = 101;
  assert.equal(small.get('a'), null);
  for (let i = 0; i < 50; i += 1) small.put(`k${i}`, { type: 'x', body: new Uint8Array(100) });
  assert.equal(small.size(), 1000);
  small.put('huge', { type: 'x', body: new Uint8Array(500) });
  assert.equal(small.get('huge'), null);

  console.log('the rewriter, READER and the routes: nothing left pointing anywhere, nothing fetched that should not be');
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
