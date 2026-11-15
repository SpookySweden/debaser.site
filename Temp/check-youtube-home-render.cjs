/*
 * YOUR YOUTUBE's view on MEDIA and its IMPORT key, drawn (Luke, 2026-11-14), run from the root:
 *   npx tsc app/components/WebYouTubeHome.tsx --outDir Temp/youtube-home-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-youtube-home-render.cjs
 *
 * "we will have a button for this next to the link youtube button, and replacing the link youtube button once youtube is
 * linked":
 * - not linked: [ LINK YOUTUBE ] then [ IMPORT YOUTUBE HISTORY ]
 * - linked: the IMPORT key in LINK's place, beside [ REFRESH ] and [ UNLINK ], and no LINK key
 * - signed out: [ LOG IN ], and no key that needs an account
 * - the shelf's rows in the order given, as many as asked, [ MORE ] only when there are more
 * - the IMPORT key says whether its panel is open; open, the panel says how to get the file and what is kept
 * A server render with a fake YouTube: no network, no database.
 */
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const el = React.createElement;
// Outside Next there is no router for its Link to read: a plain link stands in.
const linkPath = require.resolve('next/link');
require.cache[linkPath] = { id: linkPath, filename: linkPath, loaded: true, exports: { __esModule: true, default: ({ href, children, className }) => el('a', { href, className }, children) } };
const WebYouTubeHome = require('./youtube-home-render/components/WebYouTubeHome.js').default;

const video = (n) => ({ id: `youtube:video${n}`, title: `Video ${n}` });
const youtube = (over = {}) => ({ items: [], teach: (taste) => taste, standing: { current: new Set() }, needsLink: true, problem: null, link: async () => undefined, unlink: () => undefined, ...over });
const draw = (props) =>
  renderToStaticMarkup(
    el(WebYouTubeHome, { youtube: youtube(), signedIn: true, shown: 12, onMore: () => undefined, renderRow: (item) => el('li', { key: item.id, 'data-row': item.id }, item.title), listClass: 'list', keyClass: 'key', ...props }),
  );
const order = (html, ...words) => words.map((word) => html.indexOf(word));
const rising = (places) => places.every((at, n) => at !== -1 && (n === 0 || at > places[n - 1]));

// 1. Not linked: LINK, then IMPORT beside it.
const unlinked = draw({});
assert.ok(rising(order(unlinked, '[ LINK YOUTUBE ]', '[ IMPORT YOUTUBE HISTORY ]')), 'not linked: [ LINK YOUTUBE ] then [ IMPORT YOUTUBE HISTORY ]');
assert.ok(!unlinked.includes('[ REFRESH ]') && !unlinked.includes('[ UNLINK ]'), '... and nothing to refresh or unlink');
assert.ok(!unlinked.includes('<ul'), '... and no empty list');

// 2. Linked: IMPORT in LINK's place, beside REFRESH and UNLINK.
const linked = draw({ youtube: youtube({ items: [video(1), video(2), video(3)], needsLink: false }), shown: 2 });
assert.ok(rising(order(linked, '[ IMPORT YOUTUBE HISTORY ]', '[ REFRESH ]', '[ UNLINK ]')), 'linked: the IMPORT key leads, beside [ REFRESH ] and [ UNLINK ]');
assert.ok(!linked.includes('[ LINK YOUTUBE ]'), '... and it has taken the LINK key\'s place');
// A kept copy whose permission ran out with nothing to show offers the link again.
assert.ok(draw({ youtube: youtube({ items: [video(1)], needsLink: true }) }).includes('[ LINK YOUTUBE ]'));

// 3. The shelf: the rows in the order given, as many as asked, [ MORE ] only when there are more.
assert.deepEqual([...linked.matchAll(/data-row="([^"]+)"/g)].map((match) => match[1]), ['youtube:video1', 'youtube:video2'], 'the first rows, in order');
assert.ok(linked.includes('[ MORE ]'), 'more to show: [ MORE ]');
const all = draw({ youtube: youtube({ items: [video(1), video(2), video(3)], needsLink: false }), shown: 12 });
assert.equal([...all.matchAll(/data-row=/g)].length, 3);
assert.ok(!all.includes('[ MORE ]'), 'nothing more: no [ MORE ]');
assert.match(all, /<ul aria-label="From your YouTube" class="list">/, "the page's own list layout");

// 4. Signed out: LOG IN, and no key that needs an account.
const visitor = draw({ signedIn: false });
assert.ok(visitor.includes('[ LOG IN ]') && visitor.includes('href="/account"'));
assert.ok(!visitor.includes('[ LINK YOUTUBE ]') && !visitor.includes('IMPORT YOUTUBE HISTORY'), 'a visitor is not offered a link or an import');

// 5. A problem is said aloud.
assert.match(draw({ youtube: youtube({ problem: 'THAT GOOGLE ACCOUNT BELONGS TO ANOTHER ACCOUNT HERE.' }) }), /role="alert"[^>]*>THAT GOOGLE ACCOUNT BELONGS/);

// 6. The IMPORT key: closed it draws no steps and says so; open, the panel says how to get the file and what is kept.
assert.match(unlinked, /aria-expanded="false"[^>]*data-youtube-import/, 'closed: the key says so');
assert.ok(!unlinked.includes('TAKEOUT.GOOGLE.COM'), '... and the steps are not drawn');
const realUseState = React.useState;
let calls = 0;
// ImportYouTubeHistory's first piece of state is whether its panel is open: started open, as after a press.
React.useState = (initial) => {
  calls += 1;
  return calls === 1 ? [true, () => undefined] : realUseState(initial);
};
const open = draw({});
React.useState = realUseState;
assert.match(open, /aria-expanded="true"[^>]*data-youtube-import/, 'open: the key says so (the site\'s one open look applies)');
assert.ok(open.includes('>[ IMPORT YOUTUBE HISTORY ]<') && unlinked.includes('>[ IMPORT YOUTUBE HISTORY ]<'), 'the same words open or shut, so the keys beside it never move');
assert.match(open, /class="fold-body order-last[^"]*"[^>]*data-youtube-import-panel/, 'the panel sits under the whole row of keys, tied to its key');
assert.ok(rising(order(open, 'TAKEOUT.GOOGLE.COM', 'YOUTUBE AND YOUTUBE MUSIC', 'SET HISTORY TO JSON', 'WATCH-HISTORY', 'CHOOSE WATCH-HISTORY FILE', 'READ IN YOUR BROWSER AND NEVER UPLOADED')), 'the steps in order, then the file key, then what happens to the file');
assert.match(open, /href="https:\/\/takeout\.google\.com\/" target="_blank" rel="noopener noreferrer"/, "Google's own page, in a new tab");
assert.match(open, /<input type="file" accept="\.json,\.html,\.htm,application\/json,text\/html"/, 'the two kinds of file Takeout makes');
assert.ok(!open.includes('[ REMOVE IMPORT ]'), 'nothing imported yet: nothing to remove');
assert.doesNotMatch(open, /<(form|iframe)\b/, 'no form posts the file anywhere');

console.log('ok: YOUR YOUTUBE view: the keys by link state, the shelf rows, and the IMPORT key and its panel');
