/*
 * SPEC-forum-v3.md part 1: YOUR DESK and the one SEARCH box, rendered, and their plain rules.
 *   npx tsc app/components/DeskWindow.tsx app/components/SearchWindow.tsx app/lib/desk/desk-window.ts app/lib/search/site-search.ts --rootDir app --outDir Temp/desk-search-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-desk-search.cjs
 *
 * The windows' own behaviour (opening once a day, folds, Ctrl+K, results that open their thing, a visitor with no desk) is
 * driven in a browser: scripts/drive-desk-search.cjs. Here: the rules, and each window's inside drawn from stubbed stores.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const el = React.createElement;
const OUT = path.join(__dirname, 'desk-search-out');
function stub(file, exports) {
  const resolved = require.resolve(file);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } };
}
const at = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();

const notifications = [
  { id: 'n1', userId: 'me', kind: 'reply', actorId: 'jo', actorName: 'JO', threadId: 't1', threadTitle: 'Panel thumbnails', body: 'the third one', gameId: null, inviteId: null, recommendationId: null, createdAt: at(3), readAt: null },
];
const threads = [
  { id: 't1', title: 'Panel thumbnails', body: 'Words', author: { id: 'me', displayName: 'ME' }, createdAt: at(60), anchor: { kind: 'board', id: 'board-general', label: 'GENERAL BOARD' }, tags: [], comments: [], origin: 'user' },
  { id: 't2', title: 'Marmalade sketches', body: 'Orange', author: { id: 'jo', displayName: 'JO' }, createdAt: at(30), anchor: { kind: 'board', id: 'board-general', label: 'GENERAL BOARD' }, tags: [], comments: [], origin: 'user' },
];
stub(path.join(OUT, 'components/AuthProvider.js'), { useAuth: () => ({ status: 'signed-in', user: { id: 'me', displayName: 'ME' } }) });
stub(path.join(OUT, 'components/DockWindow.js'), { default: ({ title, children }) => el('section', { 'data-window': title }, children) });
stub(path.join(OUT, 'components/ProfileName.js'), { default: ({ author }) => el('a', { href: `/profile/${author.id}` }, author.displayName) });
stub(path.join(OUT, 'components/NotificationsProvider.js'), { useNotifications: () => ({ items: notifications }) });
stub(path.join(OUT, 'components/CommsProvider.js'), { useComms: () => ({ accounts: [{ id: 'jo', displayName: 'JO' }], unreadTotal: 2 }) });
stub(path.join(OUT, 'components/PresenceProvider.js'), { usePresenceDirectory: () => ({ statusFor: (id) => (id === 'jo' ? 'online' : 'offline') }) });
stub(path.join(OUT, 'components/ForumProvider.js'), { useForum: () => ({ threads }) });
stub(path.join(OUT, 'lib/watch/use-music-room.js'), { useLiveRooms: () => ({ rooms: [], error: null }) });
stub(path.join(OUT, 'lib/recommendations/store.js'), { useUnreadRecommendations: () => 1, useRecommendationList: () => ({ value: [], error: null, loading: false }) });
stub(path.join(OUT, 'lib/books/repository.js'), { getBooksRepository: () => ({ places: async () => [] }) });
stub(path.join(OUT, 'lib/audio/repository.js'), { getMusicRepository: () => ({ forYou: async () => [] }) });
stub(path.join(OUT, 'lib/docs/repository.js'), { getDocsRepository: () => ({ listDocs: async () => [] }) });
stub(path.join(OUT, 'lib/media/catalogue.js'), { useCatalogue: () => ({ items: [], entries: [], answered: true, loading: false }) });
stub(path.join(OUT, 'lib/web/everywhere-client.js'), { searchEverywhere: async () => ({ items: [], problems: [], nextCursor: null, link: null }) });
stub('next/navigation', { useSearchParams: () => new URLSearchParams(''), usePathname: () => '/forum', useRouter: () => ({ replace: () => undefined, push: () => undefined }) });

const { default: DeskWindow, DeskBody } = require('./desk-search-out/components/DeskWindow.js');
const { default: SearchWindow, SearchBody } = require('./desk-search-out/components/SearchWindow.js');
const { localDay, opensByItself, deskRequested } = require('./desk-search-out/lib/desk/desk-window.js');
const { searchWords, matchesWords, resultLine, searchRequested } = require('./desk-search-out/lib/search/site-search.js');

/* The rules -------------------------------------------------------------------------------------------- */
assert.equal(localDay(new Date(2026, 10, 17, 23, 59)), '2026-11-17', "the reader's own day");
assert.equal(opensByItself({ signedIn: true, onForum: true, lastDay: null, today: '2026-11-17' }), true, 'the first visit of the day opens it (D1A+)');
assert.equal(opensByItself({ signedIn: true, onForum: true, lastDay: '2026-11-17', today: '2026-11-17' }), false, 'not twice the same day');
assert.equal(opensByItself({ signedIn: true, onForum: true, lastDay: '2026-11-16', today: '2026-11-17' }), true, 'and again the next day');
assert.equal(opensByItself({ signedIn: false, onForum: true, lastDay: null, today: '2026-11-17' }), false, 'a visitor has no desk');
assert.equal(opensByItself({ signedIn: true, onForum: false, lastDay: null, today: '2026-11-17' }), false, 'only on the forum');
assert.equal(deskRequested('?view=gallery&desk=1'), true);
assert.equal(searchRequested('?search=1'), true);
assert.deepEqual(searchWords('  Glass   CORRIDOR '), ['glass', 'corridor']);
assert.equal(matchesWords(['glass', 'corridor'], 'THE GLASS', 'CORRIDOR'), true, 'every word, across the texts');
assert.equal(matchesWords(['glass', 'lake'], 'THE GLASS CORRIDOR'), false, 'all the words, not any');
assert.equal(matchesWords([], 'anything'), false, 'no words, no match');
assert.equal(resultLine('a\n  b'), 'a b');

/* The windows ------------------------------------------------------------------------------------------ */
assert.equal(renderToStaticMarkup(el(DeskWindow)), '', 'shut, the desk draws nothing');
assert.equal(renderToStaticMarkup(el(SearchWindow)), '', 'shut, the search draws nothing');
const desk = renderToStaticMarkup(el(DeskBody, { me: 'me', onLeave: () => undefined }));
assert.match(desk, /REPLIES TO YOU \(1 NEW\)/, 'REPLIES TO YOU, with how many are new');
assert.match(desk, /JO REPLIED &quot;Panel thumbnails&quot;/, 'who replied, and where');
assert.match(desk, /href="\/forum#thread-t1"/, 'a reply line opens its post');
assert.match(desk, /LIVE NOW/, 'LIVE NOW, for the person whose lamp is on');
assert.match(desk, /WAITING FOR YOU[\s\S]*2 MESSAGES[\s\S]*1 RECOMMENDATION/, 'WAITING FOR YOU, messages and recommendations');
assert.doesNotMatch(desk, /CONTINUE READING/, 'no book started, no section');
assert.doesNotMatch(desk, /FROM PEOPLE YOU TALK TO/, 'nobody close yet, no section');
const find = renderToStaticMarkup(el(SearchBody, { initial: 'marmalade', onLeave: () => undefined }));
assert.match(find, /id="site-search-box"/, 'a box, labelled');
assert.match(find, /data-search-group="POSTS &amp; REPLIES"[\s\S]*Marmalade sketches/, 'POSTS & REPLIES finds the post');
assert.match(find, /data-search-group="OUTSIDE"[\s\S]*ASKING THE OUTSIDE PLATFORMS/, 'OUTSIDE is asked after, and says so meanwhile');
assert.ok(find.indexOf('POSTS &amp; REPLIES') < find.indexOf('data-search-group="OUTSIDE"'), "the site's own come first (S1B)");
assert.match(find, /href="\/media\?q=marmalade"/, 'and the whole of it is one press away in MEDIA');
const people = renderToStaticMarkup(el(SearchBody, { initial: 'jo', onLeave: () => undefined }));
assert.match(people, /data-search-group="PEOPLE"[\s\S]*href="\/profile\/jo"/, 'PEOPLE finds a person, to their profile');

console.log('desk and search: rules, the desk sections, the search groups - all pass');
