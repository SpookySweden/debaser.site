/*
 * TAG STATION's page, drawn (SPEC-tag-station.md): signed out it shows a prompt and asks for nothing, words are marked with their
 * source, players don't load until asked for, and no third-party text is drawn as HTML.
 *   npx tsc app/components/TagStation.tsx app/components/TagStationGate.tsx app/lib/tag-station/graph.ts app/lib/tag-station/mock-tag-repository.ts --rootDir app --outDir Temp/tag-station-render-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strictNullChecks
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const el = React.createElement;

function stub(file, exports) {
  const resolved = require.resolve(file);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } };
}

/** Stands in for the address bar, so each draw can name what's in it. */
let address = new URLSearchParams();
const pushed = [];
stub('next/navigation', {
  useRouter: () => ({ push: (to) => pushed.push(['push', to]), replace: (to) => pushed.push(['replace', to]) }),
  useSearchParams: () => address,
});
let authStatus = 'signed-in';
stub(path.join(__dirname, 'tag-station-render-out/components/AuthProvider.js'), { useAuth: () => ({ status: authStatus }) });
stub(path.join(__dirname, 'tag-station-render-out/components/MusicPlayerProvider.js'), {
  useMusicPlayer: () => ({ track: null, playing: false, toggle() {}, playList() {} }),
  default: ({ children }) => children,
});

const TagStation = require('./tag-station-render-out/components/TagStation.js');
const Gate = require('./tag-station-render-out/components/TagStationGate.js').default;
const { buildStationGraph } = require('./tag-station-render-out/lib/tag-station/graph.js');
const { MOCK_STATION_ROWS } = require('./tag-station-render-out/lib/tag-station/mock-tag-repository.js');
const { buildIndex } = require('./tag-station-render-out/lib/tag-station/query.js');

const index = buildIndex(buildStationGraph(MOCK_STATION_ROWS));
const draw = (query) => {
  address = new URLSearchParams(query);
  return renderToStaticMarkup(el(TagStation.Station, { index }));
};

// 1. The gate: signed out, a prompt and none of the page; loading, a line; signed in, the page.
const inside = () => el('p', null, 'INSIDE');
authStatus = 'signed-out';
const out = renderToStaticMarkup(el(Gate, null, el(inside)));
assert.ok(out.includes('SIGN IN TO USE TAG STATION'));
assert.ok(!out.includes('INSIDE'), 'nothing of the page, signed out');
authStatus = 'loading';
assert.ok(renderToStaticMarkup(el(Gate, null, el(inside))).includes('CHECKING'));
authStatus = 'signed-in';
assert.ok(renderToStaticMarkup(el(Gate, null, el(inside))).includes('INSIDE'));

// 2. Nothing chosen: the box, the three panels, an open invitation.
const home = draw('view=list');
for (const words of ['WORD, ITEM OR LINK', 'INPUT', 'WORDS', 'NEIGHBOURHOOD', 'MOST USED WORDS', 'PICK A WORD']) assert.ok(home.includes(words), words);
assert.ok(/role="combobox"/.test(home), 'the box is a combobox');
assert.ok(draw('link=https%3A%2F%2Fexample.org%2Fx&view=list').includes('READING THE LINK'), 'a link says so while it is read');
assert.ok(home.includes('aria-label="Text size S"') && home.includes('aria-label="Text size XL"'), 'S to XL');

// 3. A word chosen: said out loud with its closest words, its related words with a reason, and its facts.
const dub = draw('tag=dub&view=list');
assert.ok(/role="status"[^>]*>dub\. CLOSEST: /.test(dub), 'picking reads out the word and its closest');
assert.ok(dub.includes('WITH dub ON 3 ITEMS'), 'a reason that is true');
assert.ok(dub.includes('CLOSE · '), 'close pairs are marked in words');
assert.ok(dub.includes('ABOUT THIS WORD') && dub.includes('OFTEN WITH'));
assert.ok(dub.includes('INTERNET ARCHIVE'), 'every item names its source');

// 4. An item chosen: its words marked with where they came from, its player not loaded until asked for.
const withPlayer = MOCK_STATION_ROWS.find((row) => row.item.embedUrl && row.item.kind === 'video') ?? MOCK_STATION_ROWS.find((row) => row.item.embedUrl);
const item = draw(`item=${encodeURIComponent(withPlayer.item.id)}&view=list`);
assert.ok(item.includes('ITS WORDS'));
assert.ok(/aria-label="Go to [^"]+, Claude&#x27;s word"/.test(item), "Claude's words say so");
assert.ok(!item.includes('<iframe'), 'no player until asked for');
assert.ok(item.includes('PLAY'), 'but a key for it');

// 5. An unknown word, a gone item: said plainly, with suggestions and no crash.
const typo = draw('tag=bristoll');
assert.ok(typo.includes('NO SUCH WORD: bristoll'));
assert.ok(typo.includes('Go to bristol'), 'offers the near miss');
assert.ok(draw('item=gone%3Aitem').includes('THAT ITEM IS GONE'));

// 6. Third-party text is only ever text.
const hostile = buildIndex(buildStationGraph([{ item: { id: 'peertube:x', platform: 'peertube', externalId: 'x', kind: 'video', url: 'javascript:alert(1)', canonicalUrl: '', title: '<img src=x onerror=alert(1)>', creator: '<script>bad()</script>', description: '<b>x</b>', embedUrl: 'https://evil.example/frame', thumbnailUrl: 'https://evil.example/t.png', publishedAt: '2026-01-01T00:00:00.000Z', fetchedAt: '' }, claudeWords: ['<i>word</i>'] }]));
address = new URLSearchParams('item=peertube%3Ax&view=list');
const safe = renderToStaticMarkup(el(TagStation.Station, { index: hostile }));
assert.ok(!safe.includes('<img src=x') && !safe.includes('<script>'), 'markup is escaped');
assert.ok(!safe.includes('evil.example') && !safe.includes('javascript:'), 'a bad address draws no link, picture or player');
for (const name of fs.readdirSync(path.join(__dirname, '..', 'app/components')).filter((file) => file.startsWith('TagStation'))) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app/components', name), 'utf8');
  assert.ok(!source.includes('dangerouslySetInnerHTML'), `${name}: never as HTML`);
  assert.ok(!/transition|ease-|animate-/.test(source), `${name}: nothing eases`);
}

// 7. The map: one Tab stop, real text, the recipe's marks. A server render has no size yet, so its labels are drawn with a
// measured size given through the map's own state.
const realUseState = React.useState;
React.useState = (initial) => {
  const value = typeof initial === 'function' ? initial() : initial;
  const seeded = value !== null && typeof value === 'object' && 'width' in value && 'height' in value ? { width: 900, height: 640 } : value;
  return realUseState(seeded);
};
const map = draw('tag=dub&must=bristol&not=vocals');
React.useState = realUseState;
assert.ok(map.includes('aria-label="Map of words.'), 'the map says how to use it');
const labels = map.match(/data-word="[^"]+"/g) ?? [];
assert.ok(labels.length > 5, 'real text labels');
assert.equal((map.match(/data-word="[^"]+"[^>]*tabindex="0"|tabindex="0"[^>]*data-word="[^"]+"/gi) ?? []).length, 1, 'one Tab stop');
assert.ok(map.includes('>+ <!-- -->bristol') || map.includes('>+ bristol'), 'a must-have is marked without colour');
assert.ok(map.includes('border-dotted'), 'dotted lines to its closest words');
assert.ok(!map.includes('<svg'), 'with no drawn picture');

// 8. The recipe: everything set from the address shows, folded open, with CLEAR.
const recipe = draw('tag=dub&must=bristol&any=reggae&not=vocals&strict=most&niche=rare&near=far&src=claude&era=1990s&kind=audio&sort=new&view=list');
for (const words of ['MUST HAVE: bristol', 'ANY OF: reggae', 'EXCLUDE: vocals', 'CLEAR', 'STRICT', 'NICHE', 'HOW FAR', 'WORDS FROM', 'ERA', 'TYPE', 'SOURCE', 'FROM', 'ADD A WORD']) assert.ok(recipe.includes(words), words);
assert.ok(!draw('tag=dub&view=list').includes('[ CLEAR ]'), 'nothing set, nothing to clear');
assert.ok(draw('tag=dub&must=nothing+like+it&view=list').includes('NOTHING FOUND'), 'an empty result says so');
assert.ok(/DROP MUST-HAVE nothing like it: \d+ MORE/.test(draw('tag=dub&must=nothing+like+it&view=list')), 'and what to loosen, with what it gains');

// 9. The one header key, and nothing else outside the page.
const nav = fs.readFileSync(path.join(__dirname, '..', 'app/components/SiteNav.tsx'), 'utf8');
assert.equal((nav.match(/href: '\/tag-station'/g) ?? []).length, 1, 'one nav entry');

console.log('check-tag-station-render: all passed');
