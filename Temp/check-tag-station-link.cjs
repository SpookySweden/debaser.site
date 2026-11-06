/*
 * TAG STATION's paste-a-link (SPEC-tag-station.md), offline with a fake fetch: the pasted address is never fetched, every request
 * goes to a fixed allow-listed host, words come back tidied, nothing is saved, and failures are outcomes with no detail.
 *   npx tsc app/lib/tag-station/link-words.ts app/lib/tag-station/query.ts app/lib/tag-station/graph.ts --rootDir app/lib --outDir Temp/tag-station-link-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { plainAddress, resolveStationLink } = require('./tag-station-link-out/tag-station/link-words.js');
const { buildStationGraph } = require('./tag-station-link-out/tag-station/graph.js');
const { buildIndex, wordsInText } = require('./tag-station-link-out/tag-station/query.js');

const MBID = '11111111-2222-3333-4444-555555555555';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fake network: answers by host and path, and writes down everything asked. */
function network(routes) {
  const asked = [];
  const fetchImpl = async (input) => {
    asked.push(String(input));
    const url = new URL(String(input));
    for (const [pattern, answer] of routes) {
      if (pattern.test(`${url.hostname}${url.pathname}`)) return typeof answer === 'function' ? answer(url) : answer.clone();
    }
    return new Response('nope', { status: 404 });
  };
  return { asked, fetchImpl };
}
const deps = (net, extra = {}) => ({ fetch: net.fetchImpl, now: () => (clock += 10_000), sleep: async () => undefined, ...extra });
let clock = 1_000_000;
const NO_HOSTS = new Set();

(async () => {
  // 1. A plain address keeps the host and path only.
  assert.equal(plainAddress('https://open.spotify.com/track/abc?si=secret#x').toString(), 'https://open.spotify.com/track/abc');
  assert.equal(plainAddress('http://SoundCloud.com/a/b').toString(), 'https://soundcloud.com/a/b', 'always https');
  assert.equal(plainAddress('https://user:pass@soundcloud.com/a'), null, 'no names');
  assert.equal(plainAddress('https://soundcloud.com:8443/a'), null, 'no ports');

  // 2. A Spotify link: asks Spotify's own oEmbed and MusicBrainz about it, never the address itself, and never with its query.
  const spotify = network([
    [/^open\.spotify\.com\/oembed$/, json({ title: 'A <b>Song</b>', author_name: 'An Artist', html: '<iframe></iframe>' })],
    [/^musicbrainz\.org\/ws\/2\/url$/, json({ relations: [{ 'target-type': 'recording', recording: { id: MBID } }] })],
    [new RegExp(`^musicbrainz\\.org/ws/2/recording/${MBID}$`), json({ title: 'A Song', genres: [{ name: 'Dub', count: 99 }], tags: [{ name: 'field recordings', count: 3 }, { name: 'https://spam.example' }, { name: 'x'.repeat(90) }] })],
  ]);
  const song = await resolveStationLink('https://open.spotify.com/track/abc?si=secret', NO_HOSTS, deps(spotify));
  assert.equal(song.outcome, 'found');
  assert.equal(song.item, null, 'no player: an open link only');
  assert.equal(song.card.title, 'A Song', 'plain text: the markup is gone');
  assert.equal(song.card.creator, 'An Artist');
  assert.equal(song.card.source, 'SPOTIFY');
  assert.equal(song.card.link, 'https://open.spotify.com/track/abc', 'the link out has no tracking');
  assert.deepEqual(song.words, [{ word: 'dub', from: 'musicbrainz' }, { word: 'field recordings', from: 'musicbrainz' }], 'tidied, and no addresses or sentences');
  assert.ok(!JSON.stringify(song).includes('99') && !JSON.stringify(song).includes('count'), 'vote counts are never passed on');
  for (const asked of spotify.asked) {
    const url = new URL(asked);
    assert.ok(['open.spotify.com', 'musicbrainz.org'].includes(url.hostname), `only fixed hosts: ${asked}`);
    assert.ok(url.pathname !== '/track/abc', 'the pasted page itself is never fetched');
    assert.ok(!asked.includes('si%3Dsecret') && !asked.includes('si=secret'), 'its query never leaves');
  }
  assert.ok(spotify.asked.some((one) => one.includes('resource=https%3A%2F%2Fopen.spotify.com%2Ftrack%2Fabc')), 'MusicBrainz is asked by the clean address');

  // 3. A service MusicBrainz doesn't know still gets its title; one with no oEmbed and no entry finds nothing.
  const unknownToMb = network([[/^soundcloud\.com\/oembed$/, json({ title: 'A Set', author_name: 'A DJ' })]]);
  const set = await resolveStationLink('https://soundcloud.com/a-dj/a-set', NO_HOSTS, deps(unknownToMb));
  assert.equal(set.outcome, 'found');
  assert.deepEqual(set.words, []);
  const noneAtAll = await resolveStationLink('https://someone.bandcamp.com/album/x', NO_HOSTS, deps(network([])));
  assert.equal(noneAtAll.outcome, 'not-found');

  // 4. A site we know nothing of is refused without a single request.
  const refused = network([[/.*/, json({})]]);
  for (const link of ['https://evil.example/x', 'https://169.254.169.254/latest', 'http://localhost/', 'https://open.spotify.com.evil.example/x', 'https://soundcloud.com@evil.example/']) {
    assert.equal((await resolveStationLink(link, NO_HOSTS, deps(refused))).outcome, 'unknown', link);
  }
  assert.equal((await resolveStationLink('not a link', NO_HOSTS, deps(refused))).outcome, 'unknown');
  assert.equal((await resolveStationLink(7, NO_HOSTS, deps(refused))).outcome, 'unknown');
  assert.deepEqual(refused.asked, [], 'nothing was fetched for any of them');

  // 5. A MusicBrainz page names its entity directly, and a bad id asks nothing.
  const mb = network([[new RegExp(`^musicbrainz\\.org/ws/2/artist/${MBID}$`), json({ name: 'An Artist', genres: [{ name: 'Reggae' }] })]]);
  const artist = await resolveStationLink(`https://musicbrainz.org/artist/${MBID}`, NO_HOSTS, deps(mb));
  assert.equal(artist.card.title, 'An Artist');
  assert.equal(artist.card.source, 'MUSICBRAINZ');
  assert.deepEqual(artist.words, [{ word: 'reggae', from: 'musicbrainz' }]);
  const bad = network([[/.*/, json({})]]);
  assert.equal((await resolveStationLink('https://musicbrainz.org/artist/not-an-id', NO_HOSTS, deps(bad))).outcome, 'not-found');
  assert.deepEqual(bad.asked, []);

  // 6. An Internet Archive link: MEDIA's own resolver for the item, its metadata API for its subjects.
  const archive = network([
    [/^archive\.org\/metadata\/some-item$/, json({ metadata: { identifier: 'some-item', title: 'Some Item', mediatype: 'audio', creator: 'Someone', publicdate: '2020-01-01 00:00:00' } })],
    [/^archive\.org\/metadata\/some-item\/metadata$/, json({ result: { subject: ['Dub', 'Field Recordings'] } })],
    [/^archive\.org\/advancedsearch\.php$/, json({ response: { numFound: 1, docs: [{ identifier: 'some-item', title: 'Some Item', mediatype: 'audio', creator: 'Someone', publicdate: '2020-01-01T00:00:00Z' }] } })],
  ]);
  const found = await resolveStationLink('https://archive.org/details/some-item', NO_HOSTS, deps(archive));
  if (found.outcome === 'found') {
    assert.equal(found.item.platform, 'internet_archive');
    assert.deepEqual(found.words.map((one) => one.word), ['dub', 'field recordings']);
    assert.ok(archive.asked.every((one) => ['archive.org', 'musicbrainz.org'].includes(new URL(one).hostname)));
  } else {
    assert.fail(`the Archive link should resolve: ${found.outcome}, asked ${archive.asked.join(' ')}`);
  }
  const subjectString = network([
    [/^archive\.org\/metadata\/some-item\/metadata$/, json({ result: { subject: 'Dub; Field Recordings' } })],
    [/^archive\.org\/advancedsearch\.php$/, json({ response: { numFound: 1, docs: [{ identifier: 'some-item', title: 'Some Item', mediatype: 'audio', publicdate: '2020-01-01T00:00:00Z' }] } })],
    [/^archive\.org\/metadata\/some-item$/, json({ metadata: { identifier: 'some-item', title: 'Some Item', mediatype: 'audio', publicdate: '2020-01-01 00:00:00' } })],
  ]);
  assert.deepEqual((await resolveStationLink('https://archive.org/details/some-item', NO_HOSTS, deps(subjectString))).words.map((one) => one.word), ['dub', 'field recordings'], 'a subject may be one string');

  // 7. Failures are outcomes, with nothing of the error passed on.
  const downItem = await resolveStationLink('https://archive.org/details/gone-item', NO_HOSTS, deps(network([])));
  assert.ok(['not-found', 'no-answer'].includes(downItem.outcome));
  assert.equal(downItem.item, null);
  const broken = network([[/^open\.spotify\.com/, () => { throw new Error('secret network detail'); }], [/^musicbrainz/, () => { throw new Error('secret network detail'); }]]);
  const failed = await resolveStationLink('https://open.spotify.com/track/abc', NO_HOSTS, deps(broken));
  assert.equal(failed.outcome, 'not-found');
  assert.ok(!JSON.stringify(failed).includes('secret'));

  // 8. MusicBrainz's one-a-second is kept: a request waits its turn, and a long queue goes without rather than holding the reader.
  const fixed = network([[/^musicbrainz\.org/, json({ relations: [] })]]);
  const slept = [];
  const frozen = 9_000_000_000;
  const paced = { fetch: fixed.fetchImpl, now: () => frozen, sleep: async (ms) => slept.push(ms) };
  await resolveStationLink('https://someone.bandcamp.com/album/a', NO_HOSTS, paced);
  await resolveStationLink('https://someone.bandcamp.com/album/b', NO_HOSTS, paced);
  assert.ok(slept.length >= 1 && slept.every((ms) => ms > 0), 'the second one waited');
  const before = fixed.asked.length;
  for (let i = 0; i < 8; i += 1) await resolveStationLink(`https://someone.bandcamp.com/album/q${i}`, NO_HOSTS, paced);
  assert.ok(fixed.asked.length - before < 8, 'past the wait limit, MusicBrainz is skipped');

  // 9. Title words: whole words and phrases on at least two items, never a stray rare word.
  const row = (id, words) => ({ item: { id, platform: 'peertube', externalId: id, kind: 'video', url: '', canonicalUrl: '', title: id, publishedAt: '2026-01-01T00:00:00.000Z', fetchedAt: '' }, claudeWords: words });
  const index = buildIndex(buildStationGraph([row('a', ['field recordings', 'dub', 'lonely']), row('b', ['field recordings', 'dub'])]));
  assert.deepEqual(wordsInText(index, 'Field recordings of a dub band').sort(), ['field recordings'], 'a short word is not matched alone, and a phrase is');
  assert.deepEqual(wordsInText(index, 'lonely'), [], 'on only one item: not enough to place a link');
  assert.deepEqual(wordsInText(index, ''), []);

  // 10. Nothing is saved or tagged: this code has no way to write, and the page's route is signed-in only.
  const source = fs.readFileSync(path.join(__dirname, '..', 'app/lib/tag-station/link-words.ts'), 'utf8');
  assert.ok(!/supabase|insert\(|upsert\(|\.update\(|anthropic|tagging/i.test(source.replace(/\/\*[\s\S]*?\*\//g, '')), 'no database or tagger here');
  const route = fs.readFileSync(path.join(__dirname, '..', 'app/api/tag-station/link/route.ts'), 'utf8');
  assert.ok(route.indexOf('webSignedIn(request)') > -1 && route.indexOf('webSignedIn(request)') < route.indexOf('searchParams'), 'the session first, before the link is read');
  const graphRoute = fs.readFileSync(path.join(__dirname, '..', 'app/api/tag-station/graph/route.ts'), 'utf8');
  assert.ok(graphRoute.indexOf('webSignedIn(request)') > -1 && graphRoute.indexOf('webSignedIn(request)') < graphRoute.indexOf('sharedStationMap('), 'and before the map is read');

  console.log('check-tag-station-link: all passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
