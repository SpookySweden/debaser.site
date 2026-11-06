/*
 * Recommending, MEDIA's RECOMMENDED and DISCOVER filters, and DISCOVER's presets (SPEC-discover.md): blank until 10,000 items are tagged, people's picks
 * first, no TMDB row can be recommended, a browser can only name an item, and a preset is only what an address can hold.
 *   npx tsc app/lib/tag-station/picks.ts app/lib/tag-station/presets.ts app/lib/tag-station/graph.ts app/lib/web/recommendations.ts --rootDir app/lib --outDir Temp/tag-station-picks-out --module commonjs --target es2022 --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const picks = require('./tag-station-picks-out/tag-station/picks.js');
const presets = require('./tag-station-picks-out/tag-station/presets.js');
const { buildStationGraph } = require('./tag-station-picks-out/tag-station/graph.js');
const { buildIndex } = require('./tag-station-picks-out/tag-station/query.js');
const { EMPTY_RECIPE, parseRecipe } = require('./tag-station-picks-out/tag-station/recipe.js');
const recs = require('./tag-station-picks-out/web/recommendations.js');
const { NO_TASTE } = require('./tag-station-picks-out/web/recommend.js');

const ROOT = path.join(__dirname, '..');
const NOW = Date.parse('2026-11-05T12:00:00Z');
const row = (id, words, publishedAt = '2026-01-01T00:00:00.000Z', over = {}) => ({ item: { id, platform: 'internet_archive', externalId: id, kind: 'audio', url: `https://archive.org/details/${id}`, canonicalUrl: '', title: id, publishedAt, fetchedAt: '', ...over }, claudeWords: words });
const big = (rows, counted) => buildIndex(buildStationGraph(rows, [], { counted, words: [{ word: 'jazz', items: counted, partners: {} }] }));

(async () => {
  // 1. Blank until the pool is large enough, at exactly 10,000, whichever way the items were counted.
  assert.equal(picks.POOL_TARGET, 10000);
  assert.equal(picks.poolReady(big([row('a', ['jazz'])], 9998)), false);
  assert.equal(picks.poolReady(big([row('a', ['jazz'])], 9999)), true, 'one saved and 9,999 counted');
  assert.equal(picks.poolReady(buildIndex(buildStationGraph([row('a', ['jazz'])]))), false);

  const rows = [row('old', ['jazz', 'trains'], '1990-01-01T00:00:00.000Z'), row('mid', ['piano'], '2000-01-01T00:00:00.000Z'), row('new', ['jazz'], '2020-01-01T00:00:00.000Z'), row('other', ['drone', 'jazz'], '2010-01-01T00:00:00.000Z')];
  const index = big(rows, 20000);

  // 2. RECOMMENDED: people's picks first with who picked them, then the algorithm's with nobody beside them, each once.
  const list = picks.recommendedList(index, [{ person: 'p1', displayName: 'Ada', itemId: 'mid' }, { person: 'p2', displayName: 'Bo', itemId: 'mid' }, { person: 'p1', displayName: 'Ada', itemId: 'mid' }, { person: 'p3', displayName: 'Cy', itemId: 'gone' }], NO_TASTE, 'newest', NOW);
  assert.equal(list[0].item.id, 'mid', 'people first');
  assert.deepEqual(list[0].people.map((one) => one.name), ['Ada', 'Bo'], 'each person once');
  assert.ok(list.slice(1).every((one) => one.people.length === 0), 'nobody beside the algorithm');
  assert.equal(new Set(list.map((one) => one.item.id)).size, list.length, 'each item once');
  assert.deepEqual(list.slice(1).map((one) => one.item.id), ['new', 'other', 'old'], 'SORT works on it');
  assert.ok(!list.some((one) => one.item.id === 'gone'), 'a pick of an item not here yet waits');
  assert.deepEqual(picks.recommendedList(index, [], NO_TASTE, 'oldest', NOW).map((one) => one.item.id), ['old', 'mid', 'other', 'new']);

  // 3. DISCOVER: applied the way the settings say, and the reader's taste decides BEST MATCH.
  assert.deepEqual(picks.discoverList(index, { ...EMPTY_RECIPE, must: ['jazz'] }, NO_TASTE, 'oldest', NOW).map((one) => one.id), ['old', 'other', 'new'], 'must-have');
  assert.deepEqual(picks.discoverList(index, { ...EMPTY_RECIPE, not: ['jazz'] }, NO_TASTE, 'newest', NOW).map((one) => one.id), ['mid'], 'exclude');
  assert.equal(picks.discoverList(index, { ...EMPTY_RECIPE, tag: 'piano', item: 'x' }, NO_TASTE, 'newest', NOW).length, 4, "what's chosen on the page isn't part of the settings");
  const taste = { ...NO_TASTE, tags: { drone: 4 } };
  assert.equal(picks.discoverList(index, EMPTY_RECIPE, taste, 'best', NOW)[0].id, 'other', 'what you open moves it up');
  assert.equal(picks.discoverList(index, EMPTY_RECIPE, NO_TASTE, 'popular', NOW)[0].words.some((one) => one.word === 'jazz'), true, "POPULAR is how common an item's words are here");

  // 4. Which rows can be recommended: nothing carrying TMDB's words.
  const item = (platform, over = {}) => ({ platform, ...over });
  for (const platform of ['internet_archive', 'youtube', 'peertube', 'wikimedia_commons', 'openverse', 'vimeo']) assert.equal(recs.canRecommend(item(platform)), true, platform);
  for (const platform of ['kino', 'jellyfin', 'wikidata', 'tvmaze', 'podcast']) assert.equal(recs.canRecommend(item(platform)), false, platform);
  assert.equal(recs.canRecommend(item('youtube', { media: {} })), false, 'a row with media-server details');

  // 5. The mock store: on, again off, and the feed.
  const store = recs.getRecommendationStore();
  const target = { id: 'youtube:abc', platform: 'youtube', externalId: 'abc' };
  await store.set(target, true);
  assert.deepEqual(await store.mine(), ['youtube:abc']);
  assert.equal((await store.feed(10))[0].itemId, 'youtube:abc');
  await store.set(target, false);
  assert.deepEqual(await store.mine(), []);

  // 6. Presets: an address's worth of settings, and what's chosen stays out of them.
  const saved = presets.presetSettings({ ...EMPTY_RECIPE, tag: 'chosen', item: 'x', link: 'https://a.example/', view: 'list', must: ['jazz'], not: ['vocals'], niche: 'rare', near: 'far', strict: 'most', facet: 'mood', era: '1990s', kind: 'audio' });
  assert.ok(!/tag=|item=|link=|view=/.test(saved), saved);
  const back = presets.withPreset({ ...EMPTY_RECIPE, tag: 'kept', view: 'list' }, saved);
  assert.deepEqual(back.must, ['jazz']);
  assert.equal(back.niche, 'rare');
  assert.equal(back.tag, 'kept', "what's chosen now stays");
  assert.equal(back.view, 'list');
  assert.equal(presets.withPreset(EMPTY_RECIPE, 'niche=nonsense&site=constructor&must=https://bad.example').niche, 'all', 'a preset is checked as any address is');
  assert.deepEqual(presets.withPreset(EMPTY_RECIPE, 'must=https://bad.example').must, []);
  assert.equal(presets.cleanPresetName('   '), null);
  assert.equal(presets.cleanPresetName(`  my   mix ${'x'.repeat(100)}`).length, presets.MAX_PRESET_NAME);
  const presetStore = presets.getPresetStore();
  await presetStore.add('one', saved);
  await presetStore.add('two', '');
  const [first, second] = await presetStore.list();
  await presetStore.activate(first.id);
  await presetStore.activate(second.id);
  assert.deepEqual((await presetStore.list()).map((one) => one.active), [false, true], 'one active');
  await presetStore.rename(second.id, 'renamed');
  await presetStore.activate(null);
  assert.deepEqual((await presetStore.list()).map((one) => [one.name, one.active]), [['one', false], ['renamed', false]]);
  await presetStore.remove(first.id);
  assert.equal((await presetStore.list()).length, 1);
  for (let i = 0; i < 19; i += 1) await presetStore.add(`p${i}`, '');
  await assert.rejects(presetStore.add('too many', ''), /Twenty/, 'twenty at most');

  // 7. The migration: only adds; a browser can name an item and nothing else; each person keeps to their own.
  const file = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).find((name) => name.endsWith('_web_recommendations.sql'));
  const code = fs.readFileSync(path.join(ROOT, 'supabase/migrations', file), 'utf8').replace(/--.*$/gm, '');
  for (const table of ['web_recommendations', 'discover_presets']) {
    assert.ok(new RegExp(`create table if not exists public\\.${table}`).test(code));
    assert.ok(new RegExp(`alter table public\\.${table} enable row level security`).test(code));
    assert.ok(new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`).test(code));
  }
  assert.ok(!/drop table|truncate/i.test(code));
  for (const [verb, pattern] of [['alter', /alter table public\.(\w+)/g], ['update', /update public\.(\w+)/g], ['insert', /insert into public\.(\w+)/g], ['delete', /delete from public\.(\w+)/g]]) {
    assert.ok([...code.matchAll(pattern)].every((match) => ['web_recommendations', 'discover_presets'].includes(match[1])), `${verb} touches only its own tables`);
  }
  const table = /create table if not exists public\.web_recommendations \(([\s\S]*?)\n\);/.exec(code)[1];
  assert.ok(!/title|creator|description|note/.test(table), 'names only: a browser cannot put text anywhere');
  assert.ok(!/grant insert[^\n]*web_recommendations/.test(code), 'only the function can add one');
  assert.ok(!/'kino'/.test(code), 'no KINO row, by rule too');
  assert.ok(/>= 200/.test(code), 'two hundred a day');
  assert.ok(/not p\.is_hidden and p\.banned_at is null/.test(code), 'not the test accounts or the banned');
  assert.ok(/perform public\.web_request_add\(p_platform, p_external_id\)/.test(code), 'and the item is saved, so it can still be played');
  for (const name of ['web_recommend_set', 'web_recommendations_feed', 'discover_preset_activate']) {
    const body = new RegExp(`function public\\.${name}\\([\\s\\S]*?\\$\\$;`).exec(code)[0];
    assert.ok(body.includes('auth.uid()'), `${name} needs a person`);
    assert.ok(body.includes("set search_path = ''"), `${name} has a fixed search path`);
    assert.ok(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to authenticated;`).test(code));
    assert.ok(!new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to anon`).test(code), 'not for visitors');
  }
  assert.ok(/for insert to authenticated\s+with check \(owner = auth\.uid\(\) and not active and \(select count\(\*\) from public\.discover_presets d where d\.owner = auth\.uid\(\)\) < 20\)/.test(code), 'owner only, twenty at most');
  assert.ok(/grant insert \(name, settings\), update \(name, settings\) on public\.discover_presets to authenticated/.test(code), 'a browser sets a name and settings only');

  // 8. The page: both filters are there, and neither shows words or scores on MEDIA.
  const list2 = fs.readFileSync(path.join(ROOT, 'app/components/WebPickedList.tsx'), 'utf8');
  assert.ok(/NOT YET: /.test(list2) && /POOL_TARGET/.test(list2), 'a line showing how far along');
  assert.ok(!/word\.word\}|\.words\.map\(\(word\) => \(\s*</.test(list2), 'no word drawn on MEDIA');
  const stream = fs.readFileSync(path.join(ROOT, 'app/components/WebStream.tsx'), 'utf8');
  assert.ok(/canRecommend\(item\) \? <WebRecommendKey/.test(stream), 'the key is on a row only when it may be');
  const restartBody = /const restart = useCallback\([\s\S]*?\[start\],/.exec(stream)[0];
  assert.ok(restartBody.includes('setPicked(null)'), 'a search leaves the list, or its results would sit behind it');
  assert.ok(/if \(picked !== null\) \{\s*setDraft\(withFilter\(draft, 'sort', word\)\);/.test(stream), 'but the SORT keys keep it, and only change its order');
  const recSource = fs.readFileSync(path.join(ROOT, 'app/lib/web/recommendations.ts'), 'utf8');
  assert.ok(/useMyRecommendations\(userId: string \| null\)/.test(recSource) && /userId === loadedFor/.test(recSource), "one account's list never shows for another");
  const privacy = fs.readFileSync(path.join(ROOT, 'app/components/PrivacySwitches.tsx'), 'utf8');
  assert.ok(/\{RECOMMEND_NOTE\}/.test(privacy), 'the PRIVACY tab says a recommendation shows your name');
  assert.ok(/\{RECOMMEND_NOTE\}/.test(list2), 'and so does the list');
  finished = true;
  console.log('check-tag-station-picks: all passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
let finished = false;
process.on('exit', (code) => {
  if (code === 0 && !finished) {
    console.error('check-tag-station-picks stopped before its end');
    process.exitCode = 1;
  }
});
