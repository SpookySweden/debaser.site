/*
 * Recommendations on screen (SPEC-recommendations.md, Luke 2026-11-10): the title rule, the mock store keeping the
 * database's rules, and what the page and the composer draw signed out and in. (Who may read what is
 * check-recommendations.cjs, on the live database.) Run from the root:
 *   npx tsc app/components/RecommendationsPage.tsx app/lib/recommendations/mock-recommendations-repository.ts --rootDir app --outDir Temp/recommendations-render-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop --strictNullChecks
 *   node Temp/check-recommendations-render.cjs
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const el = React.createElement;
const OUT = path.join(__dirname, 'recommendations-render-out');

function stub(file, exports) {
  const resolved = require.resolve(file);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } };
}

let auth = { status: 'anonymous', user: null };
stub(path.join(OUT, 'components/AuthProvider.js'), { useAuth: () => auth });
stub(path.join(OUT, 'components/ForumProvider.js'), { useForum: () => ({ createThread: async () => ({ id: 't1' }) }) });
stub(path.join(OUT, 'components/CommsProvider.js'), {
  useComms: () => ({ accounts: [{ id: 'me', displayName: 'ME' }, { id: 'b', displayName: 'BEE' }, { id: 'c', displayName: 'SEA' }] }),
});
stub(path.join(OUT, 'components/ProfileAvatarLink.js'), { default: ({ author }) => el('span', { 'data-face': author.id }) });
stub(path.join(OUT, 'components/ProfileName.js'), { default: ({ author }) => el('span', { 'data-name': author.id }, author.displayName) });
stub(path.join(OUT, 'components/TimeStamp.js'), { default: () => el('time', null, 'NOW') });
stub(path.join(OUT, 'components/LetterItemPopout.js'), { default: () => el('div', { 'data-popout': true }) });
stub(path.join(OUT, 'components/SpriteSlot.js'), { default: () => el('span') });
stub(path.join(OUT, 'lib/web/everywhere-client.js'), { searchEverywhere: async () => ({ items: [] }) });
stub('next/navigation', { useSearchParams: () => new URLSearchParams(''), usePathname: () => '/recommendations', useRouter: () => ({ replace: () => undefined }) });

const { recommendationTitle } = require('./recommendations-render-out/lib/recommendations/types.js');
const { createMockRecommendationsRepository } = require('./recommendations-render-out/lib/recommendations/mock-recommendations-repository.js');
const RecommendationsPage = require('./recommendations-render-out/components/RecommendationsPage.js').default;
const RecommendationComposer = require('./recommendations-render-out/components/RecommendationComposer.js').default;

(async () => {
  /* 1. Luke's title rule ---------------------------------------------------------------------- */
  const two = [{ title: 'FIRST' }, { title: 'SECOND' }];
  assert.equal(recommendationTitle('look at these', two), 'look at these', 'the message is the title');
  assert.equal(recommendationTitle('look at this', [{ title: 'ONLY' }]), 'ONLY', 'one thing: its own title');
  assert.equal(recommendationTitle('   ', two), 'FIRST AND 1 MORE', 'no message: the first thing`s title, and how many more');
  console.log('  ok    the title rule');

  /* 2. The mock store keeps the database's rules ------------------------------------------------ */
  let viewer = { id: 'a', name: 'AY' };
  const store = createMockRecommendationsRepository(() => viewer);
  const thing = { kind: 'link', ref: 'https://example.org/', title: 'EXAMPLE' };
  await assert.rejects(store.send({ message: '', isPublic: false, things: [thing], to: ['a'] }), /NOT TO YOURSELF/);
  await assert.rejects(store.send({ message: '', isPublic: false, things: [], to: ['b'] }), /1 TO 50/);
  await assert.rejects(store.send({ message: '', isPublic: false, things: [thing], to: [] }), /SEND IT TO SOMEONE/);
  const id = await store.send({ message: '', isPublic: false, things: [thing], to: ['b'] });
  viewer = { id: 'c', name: 'SEA' };
  assert.equal((await store.items(id)).length, 0, 'someone it wasn`t sent to reads nothing of it');
  await store.played(id);
  viewer = { id: 'b', name: 'BEE' };
  const forB = await store.list('for_me');
  assert.equal(forB.length, 1, 'it is under FOR YOU for the person it was sent to');
  assert.equal(forB[0].readAt, null, 'NEW until opened');
  await store.markRead(id, 'b');
  assert.notEqual((await store.list('for_me'))[0].readAt, null, 'opened, it isn`t NEW');
  await store.played(id);
  assert.deepEqual((await store.players([id]))[id], ['b'], 'the face of who played it, and not of who couldn`t read it');
  viewer = null;
  assert.deepEqual(await store.list('public'), [], 'a private one is never public');
  console.log('  ok    the mock store');

  /* 3. The page, signed out and in ----------------------------------------------------------------- */
  auth = { status: 'anonymous', user: null };
  const out = renderToStaticMarkup(el(RecommendationsPage));
  assert.match(out, />PUBLIC</, 'signed out: PUBLIC');
  assert.doesNotMatch(out, /FOR YOU|>SENT<|MAKE ONE/, 'and nothing that needs an account');
  assert.match(out, /SIGN IN TO SEND/);
  auth = { status: 'signed-in', user: { id: 'me', displayName: 'ME' } };
  const inside = renderToStaticMarkup(el(RecommendationsPage));
  assert.match(inside, /FOR YOU[\s\S]*PUBLIC[\s\S]*SENT/, 'signed in: FOR YOU, PUBLIC, SENT');
  assert.match(inside, /MAKE ONE/, 'and making one');
  console.log('  ok    the page');

  /* 4. The composer: the stream queue's split ----------------------------------------------------- */
  const composer = renderToStaticMarkup(el(RecommendationComposer, { me: 'me', onSend: async () => undefined }));
  assert.match(composer, /YOUR QUEUE[\s\S]*PRE-LIST/, 'your queue on the left, the pre-list on the right');
  assert.match(composer, /\[ YOUR LETTERS \][\s\S]*\[ SEARCH \]/, 'with its two sources');
  assert.match(composer, /PUBLIC: ON THE PUBLIC TAB AND IN THE FORUM/, 'public, or');
  assert.match(composer, /data-name="b"[\s\S]*data-name="c"/, 'people to pick');
  assert.doesNotMatch(composer, /data-name="me"/, 'never yourself');
  assert.match(composer, />SEND</);
  console.log('  ok    the composer');
  console.log('recommendations render checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
