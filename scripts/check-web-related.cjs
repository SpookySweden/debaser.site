/*
 * WEB: "did you mean" and related topics, offline with recorded-shape answers (Luke, 2026-11-02; run by `npm run checks:web`):
 *   npx tsc app/lib/web/related.ts --outDir Temp/out-web-related --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - Wikipedia's suggestion becomes search words; the same words, or none, is no suggestion
 * - Wikidata: the entry whose label is the words wins; its series / universe / franchise become topics, at most two,
 *   never the search itself, labels cut to letters and digits
 * - a misspelling is corrected first, so its topics are the corrected word's ("dalak" -> Doctor Who)
 * - only en.wikipedia.org, www.wikidata.org and api.themoviedb.org are asked; a failure is simply nothing
 * - KINO adds TMDB's exact keyword as a topic; never without a token
 */
const { join } = require('node:path');
const { makeAsserts } = require('./web-search-check-kit.cjs');

const r = require(join(__dirname, '..', 'Temp', 'out-web-related', 'lib', 'web', 'related.js'));
const asserts = makeAsserts('WEB related topics');
const { ok, same } = asserts;

/* ---------------------------------------------------------------- parsers */
same(r.readSuggestion({ query: { searchinfo: { suggestion: 'dalek' } } }, 'dalak'), 'dalek', 'Wikipedia\'s suggestion');
same(r.readSuggestion({ query: { searchinfo: {} } }, 'dalek'), null, 'no suggestion');
same(r.readSuggestion({ query: { searchinfo: { totalhits: 40, suggestion: 'cyber men' } } }, 'cybermen'), null, 'a space put into the same letters is no correction');
same(r.readSuggestion({ query: { searchinfo: { totalhits: 1889, suggestion: 'dale' } } }, 'dalek'), null, 'common words as typed are meant: no "dale" for dalek (live, 2026-11-02)');
same(r.readSuggestion({ query: { searchinfo: { totalhits: 549, suggestion: 'dalek' } } }, 'dalak'), 'dalek', 'rare words get the suggestion');
same(r.readSuggestion({ query: { searchinfo: { suggestion: 'Dalek' } } }, 'dalek'), null, 'the same words are no suggestion');
same(r.readSuggestion({ query: { searchinfo: { suggestion: '<b>x</b>; drop table' } } }, 'y'), 'b x drop table', 'a suggestion is cut to letters and digits (repeats once, as any search)');

const SEARCH = { search: [{ id: 'Q1', label: 'Dalek Empire' }, { id: 'Q2', label: 'Dalek' }, { id: 'bad', label: 'x' }] };
same(r.pickEntity(SEARCH, 'daleks'), 'Q2', 'the entry named exactly the words (plural or not) wins');
same(r.pickEntity({ search: [{ id: 'Q9', label: 'Other' }] }, 'dalek'), 'Q9', 'else the first');
same(r.pickEntity({ search: 'nope' }, 'x'), null, 'a bad answer is nothing');

const claim = (id) => ({ mainsnak: { datavalue: { value: { id } } } });
const CLAIMS = { entities: { Q2: { claims: { P1080: [claim('Q34316')], P179: [claim('Q34316'), claim('Q2')], P31: [claim('Q5')], P8345: [claim('bad')] } } } };
same(r.belongsTo(CLAIMS, 'Q2'), ['Q34316'], 'the bigger work it belongs to, once; never itself, never another property');
same(r.readLabels({ entities: { Q34316: { labels: { en: { value: 'Doctor Who' } } }, Q5: {} } }, ['Q34316', 'Q5']), ['Doctor Who'], 'English labels, missing ones left out');
same(r.toTopics(['Doctor Who', 'doctor who!', 'Dalek', 'Torchwood', 'Extra'], 'dalek'), [{ label: 'DOCTOR WHO', query: 'doctor who' }, { label: 'TORCHWOOD', query: 'torchwood' }], 'at most two topics, no repeats, never the search itself');
same(r.cleanLabel('<i>Star</i> Trek: TNG'), 'Star Trek TNG', 'labels lose markup and are letters, digits and spaces only');

/* ---------------------------------------------------------------- the whole lookup, with a fake web */
function fakeWeb({ suggestion = null, fail = false } = {}) {
  const asked = [];
  const fetch = async (url, init) => {
    asked.push({ url, auth: init?.headers?.Authorization });
    if (fail) throw new Error('down');
    const u = new URL(url);
    const p = u.searchParams;
    if (u.hostname === 'en.wikipedia.org') return new Response(JSON.stringify({ query: { searchinfo: suggestion ? { suggestion } : {} } }));
    if (p.get('action') === 'wbsearchentities') return new Response(JSON.stringify(p.get('search') === 'dalek' ? SEARCH : { search: [] }));
    if (p.get('action') === 'wbgetentities' && p.get('props') === 'claims') return new Response(JSON.stringify(CLAIMS));
    if (p.get('action') === 'wbgetentities') return new Response(JSON.stringify({ entities: { Q34316: { labels: { en: { value: 'Doctor Who' } } } } }));
    if (u.hostname === 'api.themoviedb.org') return new Response(JSON.stringify({ results: [{ id: 210024, name: 'dalek' }, { id: 5, name: 'daleks invasion' }] }));
    return new Response('{}', { status: 404 });
  };
  return { asked, fetch };
}

(async () => {
  const typo = fakeWeb({ suggestion: 'dalek' });
  const answer = await r.relatedFor('dalak', { fetch: typo.fetch, kino: false });
  same(answer, { suggestion: 'dalek', topics: [{ label: 'DOCTOR WHO', query: 'doctor who' }] }, '"dalak": DID YOU MEAN dalek, and its topic Doctor Who');
  ok(typo.asked.every((call) => ['en.wikipedia.org', 'www.wikidata.org'].includes(new URL(call.url).hostname)), 'only Wikipedia and Wikidata are asked');
  ok(typo.asked.every((call) => call.auth === undefined), 'and they get no token');

  const kino = fakeWeb();
  const withKeyword = await r.relatedFor('dalek', { fetch: kino.fetch, kino: true, tmdbToken: 'tok' });
  same(withKeyword.topics[0], { label: 'TAGGED: DALEK', query: 'dalek', keyword: 210024 }, 'KINO: TMDB\'s exact keyword comes first');
  same(withKeyword.topics[1], { label: 'DOCTOR WHO', query: 'doctor who' }, 'then the Wikidata topic');
  ok(kino.asked.filter((call) => new URL(call.url).hostname === 'api.themoviedb.org').every((call) => call.auth === 'Bearer tok' && !call.url.includes('tok')), 'the TMDB token goes in a header only');
  const noToken = fakeWeb();
  await r.relatedFor('dalek', { fetch: noToken.fetch, kino: true });
  ok(!noToken.asked.some((call) => call.url.includes('themoviedb')), 'no token: TMDB is not asked');

  same((await r.relatedFor('daleks', { fetch: fakeWeb().fetch, kino: false })).topics, [{ label: 'DOCTOR WHO', query: 'doctor who' }], 'a plural Wikidata has no label for is asked once in the singular');
  same(await r.relatedFor('dalek', { fetch: fakeWeb({ fail: true }).fetch, kino: true, tmdbToken: 't' }), { suggestion: null, topics: [] }, 'everything down: nothing, never an error');
  asserts.done();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
