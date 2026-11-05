/*
 * Tagging what anyone sees in MEDIA (SPEC-tag-station.md), offline with fakes: only names go in, only the platform's own text goes to
 * Claude, nobody's name or search is kept, and the $60 limit is enforced in code. The migration only ever adds.
 *   npx tsc app/lib/web/seen-items.ts app/lib/web/tagging.ts app/lib/tag-station/supabase-tag-repository.ts app/lib/tag-station/graph.ts --rootDir app/lib --outDir Temp/tag-station-seen-out --module commonjs --target es2022 --moduleResolution node --skipLibCheck --esModuleInterop --strictNullChecks
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const seen = require('./tag-station-seen-out/web/seen-items.js');
const tagging = require('./tag-station-seen-out/web/tagging.js');
const { FETCH_ONE_PROVIDERS } = require('./tag-station-seen-out/web/search/index.js');
const { createSupabaseTagRepository } = require('./tag-station-seen-out/tag-station/supabase-tag-repository.js');
const { buildStationGraph } = require('./tag-station-seen-out/tag-station/graph.js');

const ROOT = path.join(__dirname, '..');
const webItem = (over = {}) => ({ id: 'youtube:abc', platform: 'youtube', externalId: 'abc', kind: 'video', url: '', canonicalUrl: '', title: 'A title', publishedAt: '2026-01-01T00:00:00.000Z', fetchedAt: '', ...over });
const withToken = new Request('https://x.example/', { headers: { authorization: 'Bearer token' } });

(async () => {
  // 1. Only names, by platform; a media server's private title and a bad id never go in.
  const names = seen.namesToNote([
    webItem(),
    webItem({ id: 'youtube:def', externalId: 'def' }),
    webItem({ id: 'peertube:uuid', platform: 'peertube', externalId: 'uuid' }),
    webItem({ id: 'jellyfin:x', platform: 'jellyfin', externalId: 'x' }),
    webItem({ id: 'kino:movie-1', platform: 'kino', externalId: 'movie-1' }),
    webItem({ id: 'youtube:media', externalId: 'media', media: { kind: 'film' } }),
    webItem({ id: 'youtube:bad', externalId: '../../etc' }),
  ]);
  assert.deepEqual(names.get('youtube'), ['abc', 'def']);
  assert.deepEqual(names.get('peertube'), ['uuid']);
  assert.equal(names.size, 2);
  assert.ok(seen.namesToNote(Array.from({ length: 300 }, (_, i) => webItem({ id: `youtube:i${i}`, externalId: `i${i}` }))).get('youtube').length <= 100, 'one call is capped');

  // 2. Noting: names only reach the database function, and it never throws or repeats.
  const calls = [];
  const fakeDb = { rpc: async (name, args) => (calls.push([name, args]), { data: null, error: null }) };
  await seen.noteSeen(withToken, [webItem({ id: 'youtube:one', externalId: 'one', title: 'SECRET TITLE', description: 'SECRET TEXT' })], fakeDb);
  assert.deepEqual(calls, [['web_seen_add', { p_platform: 'youtube', p_external_ids: ['one'] }]]);
  assert.ok(!JSON.stringify(calls).includes('SECRET'), 'no text goes in');
  await seen.noteSeen(withToken, [webItem({ id: 'youtube:one', externalId: 'one' })], fakeDb);
  assert.equal(calls.length, 1, "the same result twice doesn't use up a person's allowance");
  await seen.noteSeen(withToken, [webItem({ id: 'youtube:two', externalId: 'two' })], { rpc: async () => { throw new Error('down'); } });
  await seen.noteSeen(new Request('https://x.example/'), [webItem({ id: 'youtube:three', externalId: 'three' })]);
  await seen.noteSeen(withToken, [webItem({ id: 'youtube:four', externalId: 'four' })], null);

  // 3. Reading: from the platform's own one-item API; nothing there counts against a name, no answer doesn't, and time is limited.
  const real = FETCH_ONE_PROVIDERS.youtube;
  FETCH_ONE_PROVIDERS.youtube = {
    platform: 'youtube',
    fetchOne: async (id) => {
      if (id === 'gone') return null;
      if (id === 'slow') throw new Error('no answer');
      if (id === 'other') return webItem({ externalId: 'not-what-was-asked' });
      return webItem({ id: `youtube:${id}`, externalId: id, title: `Title ${id}`, creator: 'Ada', description: 'Words', tags: ['t'] });
    },
  };
  const nameOf = (external, platform = 'youtube') => ({ id: `${platform}:${external}`, platform, external_id: external });
  const read = await seen.readSeenItems([nameOf('good'), nameOf('gone'), nameOf('slow'), nameOf('other'), nameOf('x', 'nowhere'), nameOf('bad/id')], {});
  assert.deepEqual(read.items.map((one) => one.id), ['youtube:good']);
  assert.equal(read.items[0].title, 'Title good');
  assert.equal(read.items[0].publishedAt, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(read.unreadable.sort(), ['nowhere:x', 'youtube:bad/id', 'youtube:gone', 'youtube:other'].sort(), 'no answer is not held against it');
  let clock = 0;
  const timed = await seen.readSeenItems(Array.from({ length: 50 }, (_, i) => nameOf(`n${i}`)), {}, () => (clock += 5000));
  assert.ok(timed.items.length < 50, 'stops when the time is up; the rest wait for the next run');
  FETCH_ONE_PROVIDERS.youtube = real;

  // 4. The job: saved items first, then seen ones; each marked in its own table; a batch's cost is counted.
  const { batchCost, worstCaseCost, runTagging, SPEND_LIMIT_USD, MAX_OUTPUT_TOKENS, requestFor, customIdFor } = tagging;
  assert.equal(SPEND_LIMIT_USD, 60);
  assert.equal(requestFor({ id: 'x', kind: 'video', title: 't', creator: null, description: null, tags: null }).params.max_tokens, MAX_OUTPUT_TOKENS, 'the answer is capped');
  assert.ok(Math.abs(batchCost(83553, 5461) - 0.00554) < 0.0002, 'matches the first real batch: about half a cent');
  const item = (id, over = {}) => ({ id, kind: 'video', title: 'A title', creator: null, description: null, tags: null, ...over });
  const fake = (over = {}) => {
    const log = { created: [], sent: [], seenSent: [], spend: [], saved: [] };
    const store = {
      untagged: async (limit) => (over.saved ?? []).slice(0, limit),
      seen: async (limit) => (over.seen ?? []).slice(0, limit),
      seenSent: async (batchId, items) => log.seenSent.push([batchId, items.map((one) => one.id)]),
      spent: async () => over.spent ?? 0,
      recordSpend: async (...args) => log.spend.push(args),
      pending: async () => over.pending ?? [],
      outIn: async () => over.out ?? [],
      sent: async (batchId, ids) => log.sent.push([batchId, ids]),
      save: async (rows) => log.saved.push(...rows),
      release: async () => undefined,
    };
    const client = {
      messages: {
        batches: {
          create: async ({ requests }) => (log.created.push(requests), { id: 'batch-new' }),
          retrieve: async () => ({ processing_status: 'ended' }),
          cancel: async () => undefined,
          results: async () =>
            (async function* () {
              for (const result of over.results ?? []) yield result;
            })(),
        },
      },
    };
    return { store, client, log };
  };
  const mixed = fake({ saved: [item('youtube:saved')], seen: [{ ...item('youtube:seen'), publishedAt: null }] });
  const mixedResult = await runTagging(mixed.client, mixed.store);
  assert.equal(mixedResult.sent, 2);
  assert.deepEqual(mixed.log.created[0].map((request) => request.custom_id), [customIdFor('youtube:saved'), customIdFor('youtube:seen')], 'saved first');
  assert.deepEqual(mixed.log.sent, [['batch-new', ['youtube:saved']]]);
  assert.deepEqual(mixed.log.seenSent, [['batch-new', ['youtube:seen']]]);

  const collected = fake({
    pending: ['b1'],
    out: ['youtube:a'],
    results: [{ custom_id: customIdFor('youtube:a'), result: { type: 'succeeded', message: { stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 100 }, content: [{ type: 'text', text: '{"words":["dub"]}' }] } } }],
  });
  await runTagging(collected.client, collected.store);
  assert.deepEqual(collected.log.spend, [['b1', 1000, 100, batchCost(1000, 100)]], 'what a batch cost is recorded');

  // 5. The limit. At or past it nothing is even read; near it, only what fits the worst case goes; a result says so.
  const atLimit = fake({ spent: 60, saved: [item('a')], seen: [item('b')] });
  let readAtLimit = false;
  atLimit.store.untagged = async () => ((readAtLimit = true), []);
  const stopped = await runTagging(atLimit.client, atLimit.store);
  assert.equal(stopped.stopped, 'spending limit');
  assert.equal(stopped.sent, 0);
  assert.deepEqual(atLimit.log.created, [], 'nothing is sent at the limit');
  assert.equal(readAtLimit, false, 'nothing is even read');

  const one = worstCaseCost(item('x'));
  const near = fake({ spent: 60 - one * 2.5, saved: [item('a1'), item('a2'), item('a3'), item('a4')] });
  const nearResult = await runTagging(near.client, near.store);
  assert.equal(nearResult.sent, 2, 'only what fits the worst case goes');
  assert.equal(nearResult.stopped, 'spending limit');
  assert.ok(near.log.created[0].length === 2);

  const justOver = fake({ spent: 60 - one / 2, saved: [item('a1')] });
  const overResult = await runTagging(justOver.client, justOver.store);
  assert.equal(overResult.sent, 0);
  assert.equal(overResult.stopped, 'spending limit');
  assert.deepEqual(justOver.log.created, []);

  const fine = fake({ saved: [item('a1')] });
  assert.equal((await runTagging(fine.client, fine.store)).stopped, undefined, 'under the limit nothing is said');

  // A long item costs more in the worst case, so the check can't be gamed by long text.
  assert.ok(worstCaseCost(item('x', { description: 'y'.repeat(600) })) > one);
  assert.ok(worstCaseCost(item('x', { description: 'y'.repeat(100000) })) === worstCaseCost(item('x', { description: 'y'.repeat(600) })), 'and text is cut before it is sent');
  // Every item's worst case is well under a cent, so one run can't blow through what's left.
  assert.ok(one * 1000 < 0.2, 'a whole run at worst stays under 20 cents');

  // 6. The migration: only adds, with Row Level Security on all three tables, and no person or search on the seen row.
  const dir = path.join(ROOT, 'supabase/migrations');
  const file = fs.readdirSync(dir).find((name) => name.endsWith('_web_seen_items.sql'));
  assert.ok(file, 'the migration is here');
  const sql = fs.readFileSync(path.join(dir, file), 'utf8');
  const code = sql.replace(/--.*$/gm, '');
  for (const table of ['web_seen_items', 'web_seen_caps', 'web_tag_spend']) {
    assert.ok(new RegExp(`create table if not exists public\\.${table}`).test(code), `${table} is new`);
    assert.ok(new RegExp(`alter table public\\.${table} enable row level security`).test(code), `${table} has Row Level Security`);
    assert.ok(new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`).test(code), `${table}: nobody by default`);
  }
  const altered = [...code.matchAll(/alter table (?:if exists )?public\.(\w+)/g)].map((match) => match[1]);
  assert.ok(altered.every((name) => ['web_seen_items', 'web_seen_caps', 'web_tag_spend'].includes(name)), `alters nothing existing: ${altered}`);
  assert.ok(!/drop table|truncate/i.test(code), 'drops nothing');
  const deletes = [...code.matchAll(/delete from public\.(\w+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(deletes)], ['web_seen_caps'], 'the only delete is yesterday\'s counts, in its own new table');
  const updates = [...code.matchAll(/update public\.(\w+)/g)].map((match) => match[1]);
  assert.ok(updates.every((name) => name === 'web_seen_items'), 'and updates only its own rows');
  const inserts = [...code.matchAll(/insert into public\.(\w+)/g)].map((match) => match[1]);
  assert.ok(inserts.every((name) => ['web_seen_items', 'web_seen_caps', 'web_tag_spend'].includes(name)), 'and inserts only into its own tables');
  const seenTable = /create table if not exists public\.web_seen_items \(([\s\S]*?)\n\);/.exec(code)[1];
  assert.ok(!/person|user|query|search|description|likes|views|rating/i.test(seenTable), 'no person, no search, no description, no counts');
  assert.ok(/grant select \(id, platform, kind, title, creator, published_at, words\) on public\.web_seen_items to authenticated/.test(code), 'readers get names and words only');
  assert.ok(!/web_seen_caps[\s\S]{0,40}to authenticated/.test(code.replace(/grant execute[^\n]*/g, '')), 'nobody reads the counts');
  const addFn = /function public\.web_seen_add\(p_platform text, p_external_ids text\[\]\)/.test(code);
  assert.ok(addFn, 'the way in takes a platform and ids, never text');
  assert.ok(/least\(500 - used, 5000 - site_room/.test(code), 'the two caps');
  assert.ok(code.indexOf('pg_advisory_xact_lock') > -1 && code.indexOf('pg_advisory_xact_lock') < code.indexOf('500 - used'), 'taken under a lock, so calls together cannot slip past them');
  assert.ok(/cardinality\(p_external_ids\) > 1000/.test(code), 'and a huge list is refused before it is read');
  assert.ok(!/'kino'/.test(code), 'KINO cannot be read back, so its titles would only use up the caps');
  for (const name of ['web_seen_waiting', 'web_seen_unreadable', 'web_seen_sent', 'web_seen_pending', 'web_seen_out', 'web_seen_save', 'web_seen_release', 'web_tag_spend_add', 'web_tag_spent']) {
    const body = new RegExp(`function public\\.${name}\\([\\s\\S]*?\\$\\$;`).exec(code)[0];
    assert.ok(body.includes('web_ingest_lock_ok(p_secret)'), `${name} needs the lock`);
  }
  assert.ok(/coalesce\(sum\(t\.usd\), 0\) >= 60/.test(code), 'the page can ask only whether the limit is reached');
  const browserOwned = fs.readFileSync(path.join(ROOT, 'app/lib/web/seen-items.ts'), 'utf8');
  assert.ok(!browserOwned.includes("'use client'"));

  // 7. A browser can't reach this file, and the search route notes after answering, after the session check.
  const walk = (dir_) => fs.readdirSync(dir_, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir_, entry.name)) : [path.join(dir_, entry.name)]));
  for (const name of walk(path.join(ROOT, 'app')).filter((one) => /\.tsx?$/.test(one))) {
    const source = fs.readFileSync(name, 'utf8');
    if (source.startsWith("'use client'")) assert.ok(!source.includes('seen-items') && !source.includes('web_seen_add'), `${name} is browser code`);
  }
  const route = fs.readFileSync(path.join(ROOT, 'app/api/web/search/route.ts'), 'utf8');
  assert.ok(route.indexOf('webSignedIn(request)') < route.indexOf('noteSeenLater(request'), 'the session is checked first');
  assert.ok(/noteSeenLater\(request, items\)/.test(route), 'and every page of results is noted');
  assert.ok(/after\(\(\) => noteSeen\(request, items\)\)/.test(browserOwned), 'once the answer has gone, so it never holds up a search');
  seen.noteSeenLater(withToken, [webItem()]);

  // 8. On the map: a seen row counts, has no address, and a saved copy wins.
  const dbRow = { id: 'youtube:a', platform: 'youtube', external_id: 'a', kind: 'video', url: 'u', canonical_url: 'u', title: 't', creator: null, description: null, thumbnail_url: null, embed_url: null, license_url: null, duration_seconds: null, tags: null, published_at: '2026-01-01T00:00:00+00:00', fetched_at: '2026-01-01T00:00:00+00:00', language: null, web_item_tags: { words: ['dub'] } };
  const seenRows = [
    { id: 'youtube:a', platform: 'youtube', kind: 'video', title: 'copy', creator: null, published_at: null, words: ['other'] },
    { id: 'youtube:b', platform: 'youtube', kind: 'nonsense', title: 'B', creator: 'Ada', published_at: null, words: ['dub', 'bass'] },
  ];
  const query = (result) => {
    const self = { select: () => self, order: () => self, neq: () => self, limit: () => Promise.resolve(result) };
    return self;
  };
  const client = { from: (table) => query(table === 'web_items' ? { data: [dbRow], error: null } : { data: seenRows, error: null }), rpc: async () => ({ data: true, error: null }) };
  const repo = createSupabaseTagRepository(client);
  const rows = await repo.rows();
  assert.deepEqual(rows.map((row) => [row.item.id, Boolean(row.seenOnly)]), [['youtube:a', false], ['youtube:b', true]], 'a result saved since is the saved item');
  assert.equal(rows[1].item.externalId, 'b');
  assert.equal(rows[1].item.kind, 'other', 'a bad kind is not trusted');
  assert.equal(rows[1].item.url, '', 'no address');
  assert.equal(await repo.limitReached(), true);
  const graph = buildStationGraph(rows);
  assert.equal(graph.tags.find((tag) => tag.name === 'dub').count, 2, 'its words count');
  assert.equal(graph.items.find((one) => one.id === 'youtube:b').seenOnly, true);
  assert.equal(graph.items.find((one) => one.id === 'youtube:a').seenOnly, undefined);

  console.log('check-tag-station-seen: all passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
