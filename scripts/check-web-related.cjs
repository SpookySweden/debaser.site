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

const SEARCH = { search: [{ id: 'Q1', label: 'Dalek Empire' }, { id: 'Q2', label: 'Dalek', description: 'fictional alien race' }, { id: 'bad', label: 'x' }] };
const rank = (body, words) => r.rankCandidates(r.readCandidates(body), words);
same(rank(SEARCH, 'daleks')[0], 'Q2', 'the entry named exactly the words (plural or not) comes first');
same(rank({ search: [{ id: 'Q9', label: 'Other', description: 'fictional thing' }, { id: 'Q8', label: 'Other two', description: 'fictional film' }] }, 'dalek'), ['Q9', 'Q8'], 'else Wikidata\'s order');
same(rank({ search: [{ id: 'Q206', label: 'corticotropin', description: 'peptide hormone', match: { type: 'alias', text: 'COSY' } }] }, 'cosy'), [], 'a plain word never leads to a hormone that shares its letters (live, 2026-11-02)');
same(rank({ search: 'nope' }, 'x'), [], 'a bad answer is nothing');
// Live shapes, 2026-11-02: "daleks" lists the empty "Daleks!" first, "hobbits" a punk band.
same(
  rank({ search: [{ id: 'Q101539658', label: 'Daleks!', description: '' }, { id: 'Q2749947', label: 'Daleks in Manhattan', description: 'episode of Doctor Who' }, { id: 'Q853715', label: 'Dalek', description: 'fictional alien race featured in the Doctor Who universe', match: { type: 'label', text: 'Daleks' } }] }, 'daleks')[0],
  'Q853715',
  '"daleks": the fictional race before an empty entry that happens to be called "Daleks!"',
);
same(
  rank({ search: [{ id: 'Q11975560', label: 'Hobbits', description: 'Norwegian musical group; punk band' }, { id: 'Q26390987', label: 'Hobbits', description: 'building in Hanley Castle' }, { id: 'Q74359', label: 'Hobbit', description: "fictional race from J. R. R. Tolkien's legendarium", match: { type: 'label', text: 'hobbits' } }] }, 'hobbits')[0],
  'Q74359',
  '"hobbits": the fictional race before a band and a building',
);
same(
  rank({ search: [{ id: 'Q150793', label: 'Sturmabteilung', description: "Nazi Party's paramilitary wing", match: { type: 'alias', text: 'Stormtroopers' } }, { id: 'Q51785', label: 'Stormtrooper', description: 'fictional soldiers in the Star Wars franchise', match: { type: 'alias', text: 'Stormtroopers' } }] }, 'stormtroopers')[0],
  'Q51785',
  'an alias match counts as the name; the story-world one first',
);
// Live shapes, 2026-11-02: Wikidata's own search lists a Turkish province for "batman"; Wikipedia's top page is the hero.
const WIKI = { query: { pages: {
  9: { index: 2, title: 'Batman (disambiguation)', description: 'Topics referred to by the same term', pageprops: { wikibase_item: 'Q281467' } },
  7: { index: 1, title: 'Batman', description: 'DC Comics superhero', pageprops: { wikibase_item: 'Q2695156' } },
  8: { index: 3, title: 'Batman Begins', description: '2005 film by Christopher Nolan', pageprops: { wikibase_item: 'Q166262' } },
  5: { index: 4, title: 'No item' },
} } };
same(r.readWikipediaCandidates(WIKI).map((c) => [c.id, c.label, c.bonus]), [['Q2695156', 'batman', 4], ['Q281467', 'batman', 2], ['Q166262', 'batman begins', 1]], 'Wikipedia\'s pages in its order, titles without their "(...)", a bonus by rank; a page with no item is left out');
same(
  r.rankCandidates([...r.readWikipediaCandidates(WIKI), ...r.readCandidates({ search: [{ id: 'Q80370', label: 'Batman', description: 'province in southeast Turkey' }] })], 'batman')[0],
  'Q2695156',
  '"batman": the superhero, never the province or the disambiguation page',
);
same(r.toTopics(['List of Illumination films', 'Godzilla movies at a glance', 'National Film Registry', 'Bram Stoker bibliography', 'Despicable Me'], 'minions'), [{ label: 'DESPICABLE ME', query: 'despicable me' }], 'reference pages (lists, registries, bibliographies) are never topics');
same(r.singularOf('daleks'), 'dalek', 'the singular of a plural');
same(r.singularOf('star wars'), 'star war', 'only the last word, only an s (an extra form to ask, never the only one)');

const claim = (id) => ({ mainsnak: { datavalue: { value: { id } } } });
const CLAIMS = { entities: { Q2: { claims: { P1080: [claim('Q34316')], P179: [claim('Q34316'), claim('Q2')], P31: [claim('Q5')], P8345: [claim('bad')] } } } };
same(r.relatedIds(CLAIMS, 'Q2'), ['Q34316'], 'what it is tied to, once; never itself, never another property');
const MANY = { entities: { Q3: { claims: { P1441: [claim('Q10'), claim('Q11'), claim('Q12')], P1080: [claim('Q20')], P2512: [claim('Q30')] } } } };
same(r.relatedIds(MANY, 'Q3'), ['Q10', 'Q20', 'Q30'], 'one of each kind of tie: a work, a universe, a spin-off (never three works)');
const NOVEL = { entities: { Q4: { claims: { P31: [claim('Q8261')], P155: [claim('Q40')], P156: [claim('Q41')], P50: [claim('Q42')], P4969: [claim('Q43')] } } } };
same(r.relatedIds(NOVEL, 'Q4'), ['Q42', 'Q43'], 'a novel: its author first, never the author\'s previous or next book');
const FILM = { entities: { Q5: { claims: { P31: [claim('Q11424')], P156: [claim('Q41')], P50: [claim('Q42')] } } } };
same(r.relatedIds(FILM, 'Q5'), ['Q41', 'Q42'], 'a film: its sequel first');
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
