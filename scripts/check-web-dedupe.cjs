/*
 * WEB Phase 4, cross-platform dedupe, run offline (SPEC-web.md; run by `npm run checks:web`, part of `npm run verify`):
 *   npx tsc app/lib/web/dedupe.ts app/lib/web/rows.ts app/lib/web/mock-web-repository.ts app/lib/web/supabase-web-repository.ts --outDir Temp/out-web-p4d --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - the fingerprint: case, punctuation and accents do not matter, creator order does not matter; no creator,
 *   a short title or a generic one ("Episode 12", "Chapter III") gives none; it has the shape the migration checks
 * - a group holds only when nothing contradicts it: durations agree, and two copies on one platform both give one
 * - the rows: the newest copy leads, the others ride on it as ALSO ON, a group that does not hold is shown
 *   ungrouped, and every copy is on exactly one row (as the row or in its ALSO ON), page by page
 * - the mock: its duplicate pair is one row, and walking every page shows every item exactly once
 * - the Supabase repository: siblings are read with .in('dedupe_key', shaped keys), the column list and a limit;
 *   a group split across pages is still one row; a failed sibling read shows the page ungrouped, not an error
 * - the ingest writes dedupe_key; the migration adds it with the same shape, an index, and deletes nothing
 */
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'Temp', 'out-web-p4d', 'lib', 'web');
const { dedupeKey, groupHolds, collapsePage, readStreamPage, DEDUPE_KEY_SHAPE, tidy } = require(join(OUT, 'dedupe.js'));
const { itemToRow, rowToItem, WEB_ITEM_COLUMNS } = require(join(OUT, 'rows.js'));
const { MOCK_WEB_ITEMS, getMockWebRepository } = require(join(OUT, 'mock-web-repository.js'));
// Updated on purpose 2026-11-01 (SPEC-media-servers.md): the mock's media-server titles join its stream.
const { MOCK_MEDIA_ITEMS } = require(join(OUT, 'mock-media-titles.js'));
const { createSupabaseWebRepository } = require(join(OUT, 'supabase-web-repository.js'));
const { compareItems } = require(join(OUT, 'paging.js'));

process.exitCode = 1;
let passed = 0;
const fail = (message) => {
  console.log(`FAIL ${message}`);
  process.exit(1);
};
const ok = (condition, message) => {
  if (!condition) fail(message);
  passed += 1;
};
const same = (a, b, message) => ok(JSON.stringify(a) === JSON.stringify(b), `${message} (got ${JSON.stringify(a)})`);

const item = (platform, externalId, publishedAt, extra = {}) => ({
  id: `${platform}:${externalId}`,
  platform,
  externalId,
  kind: 'audio',
  url: `https://example.org/${externalId}`,
  canonicalUrl: `https://example.org/${externalId}`,
  title: 'The Burning of Rome',
  creator: 'Tacitus',
  publishedAt,
  fetchedAt: '2026-10-31T12:00:00.000Z',
  ...extra,
});

/* ------------------------------------------------------------------ the fingerprint */
const base = dedupeKey({ title: 'The Burning of Rome', creator: 'Tacitus' });
ok(typeof base === 'string' && DEDUPE_KEY_SHAPE.test(base), `the key has the stored shape (${base})`);
same(dedupeKey({ title: '  the BURNING of rome!! ', creator: 'TACITUS' }), base, 'case, spaces and punctuation do not change the key');
same(dedupeKey({ title: 'Thé Bürning of Rôme', creator: 'Tacitus' }), base, 'accents do not change the key');
same(
  dedupeKey({ title: 'Annals', creator: 'Reader One; Reader Two' }),
  dedupeKey({ title: 'Annals', creator: 'Reader Two, Reader One' }),
  'creator order does not change the key',
);
ok(dedupeKey({ title: 'The Burning of Rome', creator: 'Suetonius' }) !== base, 'another creator is another key');
ok(dedupeKey({ title: 'The Burning of Carthage', creator: 'Tacitus' }) !== base, 'another title is another key');
ok(dedupeKey({ title: 'The Burning of Rome' }) === null, 'no creator, no key');
ok(dedupeKey({ title: 'The Burning of Rome', creator: '  ;; ' }) === null, 'a creator of punctuation only, no key');
for (const generic of ['Episode 12', 'Chapter III', 'Part 1', 'Untitled', 'ep. 4', '1984', 'Intro', 'Vol 2 No 3']) {
  ok(dedupeKey({ title: generic, creator: 'Someone' }) === null, `a generic title gets no key: "${generic}"`);
}
for (const real of ['Civil Disobedience', 'Mix Tape', 'Episode of the Iron Horse', 'Lives of the Caesars']) {
  ok(dedupeKey({ title: real, creator: 'Someone' }) !== null, `a real title keeps its key: "${real}"`);
}
ok(dedupeKey({ title: 'Ox', creator: 'Someone' }) === null, 'a very short title gets no key');
same(tidy('Rock & Roll'), 'rock and roll', '& reads as "and"');

/* ------------------------------------------------------------------ when a group holds */
const ia = item('internet_archive', 'rome_ia', '2026-10-30T10:00:00.000Z');
const pod = item('podcast', 'rome_pod', '2026-10-29T10:00:00.000Z');
ok(groupHolds([ia, pod]), 'two platforms, no durations: one work');
ok(!groupHolds([ia]), 'one copy is not a group');
ok(!groupHolds([ia, item('internet_archive', 'rome_ia2', '2026-10-28T10:00:00.000Z')]), 'one platform, no durations: kept apart');
ok(
  groupHolds([item('internet_archive', 'a', '2026-10-30T10:00:00.000Z', { durationSeconds: 3600 }), item('internet_archive', 'b', '2026-10-29T10:00:00.000Z', { durationSeconds: 3650 })]),
  'one platform, durations within 3%: one work',
);
ok(
  !groupHolds([item('internet_archive', 'a', '2026-10-30T10:00:00.000Z', { durationSeconds: 3600 }), item('internet_archive', 'b', '2026-10-29T10:00:00.000Z')]),
  'one platform, one duration missing: kept apart',
);
ok(
  !groupHolds([item('internet_archive', 'a', '2026-10-30T10:00:00.000Z', { durationSeconds: 3600 }), item('podcast', 'b', '2026-10-29T10:00:00.000Z', { durationSeconds: 5400 })]),
  'durations that disagree: kept apart, even across platforms',
);
ok(
  groupHolds([item('internet_archive', 'a', '2026-10-30T10:00:00.000Z', { durationSeconds: 100 }), item('podcast', 'b', '2026-10-29T10:00:00.000Z', { durationSeconds: 108 })]),
  'a short gap (under 10 seconds) is still the same length',
);
ok(
  !groupHolds([ia, pod, item('podcast', 'rome_pod2', '2026-10-28T10:00:00.000Z')]),
  'one doubtful pair keeps the whole group apart',
);

/* ------------------------------------------------------------------ rows */
// Updated on purpose 2026-11-01 (film series, media-collections.ts): a series row also places the films in its picker.
const placed = (rows) => rows.flatMap((row) => [...new Set([row.id, ...row.alsoOn.map((copy) => copy.id), ...(row.media?.parts ?? []).map((part) => part.id)])]);

let rows = collapsePage([ia, pod], [ia, pod]);
same(rows.map((row) => row.id), [ia.id], 'the newest copy leads');
same(rows[0].alsoOn.map((copy) => copy.id), [pod.id], 'the other copy is ALSO ON');

rows = collapsePage([pod], [ia, pod]);
same(rows, [], 'a copy whose leader is on an earlier page is not shown again');

const other = item('openverse', 'unrelated', '2026-10-29T12:00:00.000Z', { title: 'Something Else' });
rows = collapsePage([ia, other, pod], [ia, pod]);
same(rows.map((row) => row.id), [ia.id, other.id], 'an unrelated item keeps its own row and its place');
same(rows[1].alsoOn, [], 'and has no ALSO ON');

const split = item('internet_archive', 'rome_ia2', '2026-10-28T10:00:00.000Z');
rows = collapsePage([ia, pod, split], [ia, pod, split]);
same(rows.map((row) => row.id), [ia.id, pod.id, split.id], 'a group that does not hold is shown ungrouped');
ok(rows.every((row) => row.alsoOn.length === 0), 'with no ALSO ON on any row');

// Under a search the leader must match: here only the podcast copy does, so it leads and lists the other.
rows = collapsePage([pod], [ia, pod], [pod]);
same(rows.map((row) => row.id), [pod.id], 'under a search, the newest MATCHING copy leads');
same(rows[0].alsoOn.map((copy) => copy.id), [ia.id], 'and every other copy is still listed');

// The whole-stream invariant: across pages, every copy sits on exactly one row.
const many = [];
const platforms = ['internet_archive', 'podcast', 'openverse', 'peertube', 'youtube'];
for (let i = 0; i < 40; i += 1) {
  const work = i % 7;
  const day = String(1 + (i % 28)).padStart(2, '0');
  many.push(
    item(platforms[i % platforms.length], `copy${i}`, `2026-10-${day}T0${i % 10}:00:00.000Z`, {
      title: work < 3 ? `Work number ${['one', 'two', 'three'][work]}` : `Lonely item ${i}`,
      durationSeconds: work === 2 && i % 2 ? 10000 : undefined,
    }),
  );
}
const ordered = [...many].sort(compareItems);
for (const size of [1, 3, 7, 40]) {
  const all = [];
  for (let at = 0; at < ordered.length; at += size) {
    const page = ordered.slice(at, at + size);
    const keys = new Set(page.map(dedupeKey).filter(Boolean));
    all.push(...collapsePage(page, many.filter((copy) => keys.has(dedupeKey(copy)))));
  }
  const ids = placed(all);
  same([...ids].sort(), many.map((copy) => copy.id).sort(), `pages of ${size}: every copy is on exactly one row`);
}

/* ------------------------------------------------------------------ the read loop */
(async () => {
  let reads = 0;
  const pages = { null: { items: [pod], nextCursor: 'c1' }, c1: { items: [other], nextCursor: null } };
  const page = await readStreamPage(
    async (at) => {
      reads += 1;
      return pages[String(at)];
    },
    async () => ({ siblings: [ia, pod], rivals: [ia, pod] }),
    null,
  );
  same(page.items.map((row) => row.id), [other.id], 'a page whose items all ride on earlier rows reads on');
  ok(reads === 2, 'and stops once it has a row');

  const ungrouped = await readStreamPage(
    async () => ({ items: [ia, pod], nextCursor: null }),
    async () => {
      throw new Error('boom');
    },
    null,
  );
  same(ungrouped.items.map((row) => row.id), [ia.id, pod.id], 'a failed sibling read shows the page ungrouped');

  /* ---------------------------------------------------------------- the mock */
  const mock = getMockWebRepository();
  const shown = [];
  let cursor = null;
  for (let guard = 0; guard < 50; guard += 1) {
    const result = await mock.listItems({ cursor, limit: 3 });
    shown.push(...result.items);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  same([...placed(shown)].sort(), [...MOCK_WEB_ITEMS, ...MOCK_MEDIA_ITEMS].map((copy) => copy.id).sort(), 'the mock: every item (media titles too) is on exactly one row');
  const pair = shown.find((row) => row.alsoOn.length > 0);
  ok(pair && pair.id === 'internet_archive:mock-item-21', 'the mock has a grouped row (item 21)');
  same(pair.alsoOn.map((copy) => copy.id), ['internet_archive:mock-item-22'], 'item 22 is ALSO ON item 21');
  ok(!shown.some((row) => row.id === 'internet_archive:mock-item-22'), 'item 22 has no row of its own');

  /* ---------------------------------------------------------------- Supabase */
  const queries = [];
  const fakeClient = (rowsIn, { failIn = false } = {}) => ({
    from() {
      const q = { columns: null, filters: [], orders: [], limit: null, inKeys: null };
      queries.push(q);
      const b = {
        select(columns) {
          q.columns = columns;
          return b;
        },
        eq(column, value) {
          q.filters.push((row) => (column === 'published_at' ? Date.parse(row[column]) === Date.parse(value) : row[column] === value));
          return b;
        },
        lt(column, value) {
          q.filters.push((row) => (column === 'published_at' ? Date.parse(row[column]) < Date.parse(value) : row[column] < value));
          return b;
        },
        in(column, values) {
          q.inKeys = { column, values };
          q.filters.push((row) => values.includes(row[column]));
          return b;
        },
        order(column, { ascending }) {
          q.orders.push([column, ascending]);
          return b;
        },
        limit(n) {
          q.limit = n;
          return b;
        },
        then(resolve) {
          if (q.inKeys && failIn) return resolve({ data: null, error: { message: 'column does not exist' } });
          if (q.limit == null) return resolve({ data: null, error: { message: 'no limit' } });
          const found = rowsIn.filter((row) => q.filters.every((f) => f(row))).map(rowToItem).sort(compareItems);
          resolve({ data: found.slice(0, q.limit).map(itemToRow).map(({ dedupe_key, ...rest }) => rest), error: null });
        },
      };
      return b;
    },
  });

  const stored = [ia, other, pod, item('youtube', 'lonely', '2026-10-27T10:00:00.000Z', { title: 'Alone here' })].map(itemToRow);
  ok(stored.every((row) => row.dedupe_key === dedupeKey(rowToItem(row))), 'the ingest row carries dedupe_key from dedupeKey');
  ok(itemToRow(item('youtube', 'x', '2026-10-27T10:00:00.000Z', { creator: undefined })).dedupe_key === null, 'no fingerprint is a null dedupe_key');

  const repo = createSupabaseWebRepository(() => fakeClient(stored));
  const first = await repo.listItems({ limit: 1 });
  same(first.items.map((row) => row.id), [ia.id], 'Supabase: page one is the leader');
  same(first.items[0].alsoOn.map((copy) => copy.id), [pod.id], 'with its copy from a later page as ALSO ON');
  const rest = [];
  let next = first.nextCursor;
  while (next) {
    const result = await repo.listItems({ cursor: next, limit: 1 });
    rest.push(...result.items.map((row) => row.id));
    next = result.nextCursor;
  }
  same(rest, [other.id, `youtube:lonely`], 'the copy on a later page never gets its own row');

  const sibling = queries.filter((q) => q.inKeys);
  ok(sibling.length > 0, 'siblings are read with .in()');
  for (const q of sibling) {
    ok(q.inKeys.column === 'dedupe_key', 'on dedupe_key');
    ok(q.inKeys.values.every((key) => DEDUPE_KEY_SHAPE.test(key)), 'with shaped keys only');
    ok(q.columns === WEB_ITEM_COLUMNS && q.limit != null && q.limit <= 200, 'selecting the column list, with a limit');
  }

  const broken = createSupabaseWebRepository(() => fakeClient(stored, { failIn: true }));
  const fallback = await broken.listItems({ limit: 5 });
  same(fallback.items.map((row) => row.id), [ia.id, other.id, pod.id, 'youtube:lonely'], 'a failed sibling read (no column yet) shows the stream ungrouped');

  // Walks every page and returns the rows, for the two "no copy may vanish" cases below.
  const walkRows = async (r, size) => {
    const all = [];
    let at = null;
    for (let guard = 0; guard < 200; guard += 1) {
      const result = await r.listItems({ cursor: at, limit: size });
      all.push(...result.items);
      if (!result.nextCursor) break;
      at = result.nextCursor;
    }
    return all;
  };

  // A copy whose stored dedupe_key is still empty (a row from before the migration) is found by nobody's
  // sibling read, so it must keep its own row rather than ride on a row that cannot list it.
  const unkeyed = stored.map((row) => (row.id === pod.id ? { ...row, dedupe_key: null } : row));
  for (const size of [1, 2, 10]) {
    const all = await walkRows(createSupabaseWebRepository(() => fakeClient(unkeyed)), size);
    same([...placed(all)].sort(), stored.map((row) => row.id).sort(), `an unkeyed copy is still on exactly one row (pages of ${size})`);
  }

  // A fingerprint with many copies crowds a shared read; the pair split across pages must still be one row.
  const crowd = [];
  for (let i = 0; i < 40; i += 1) {
    crowd.push(item(platforms[i % platforms.length], `crowd${i}`, `2026-10-30T1${i % 10}:${String(i).padStart(2, '0')}:00.000Z`, { title: 'A Crowded Title' }));
  }
  const crowded = [...crowd, ia, pod, other].map(itemToRow);
  for (const size of [1, 2, 5, 33]) {
    queries.length = 0;
    const all = await walkRows(createSupabaseWebRepository(() => fakeClient(crowded)), size);
    same([...placed(all)].sort(), crowded.map((row) => row.id).sort(), `a crowded fingerprint drops no copy (pages of ${size})`);
    const iaRow = all.find((row) => row.id === ia.id);
    ok(iaRow && iaRow.alsoOn.length === 1 && iaRow.alsoOn[0].id === pod.id, `the pair is still one row beside a crowd (pages of ${size})`);
    ok(queries.every((q) => q.limit != null && q.limit <= 51 * 11), 'every read keeps a limit');
  }
  ok(!groupHolds(crowd.slice(0, 11).map((copy, i) => ({ ...copy, platform: `p${i}` }))), 'more than 10 copies is not one work');

  /* ---------------------------------------------------------------- the migration */
  const name = readdirSync(join(ROOT, 'supabase', 'migrations')).filter((file) => /^\d{14}_web_search_dedupe\.sql$/.test(file));
  ok(name.length === 1, 'exactly one *_web_search_dedupe.sql migration');
  ok(name[0] > '20261031134418_web_items.sql', 'it runs after the web_items migration');
  const sql = readFileSync(join(ROOT, 'supabase', 'migrations', name[0]), 'utf8').replace(/--.*$/gm, '').toLowerCase();
  ok(/add column if not exists dedupe_key text/.test(sql), 'dedupe_key is added (if not exists)');
  const shape = sql.match(/dedupe_key ~ '([^']+)'/);
  ok(shape && shape[1] === DEDUPE_KEY_SHAPE.source, `its CHECK is DEDUPE_KEY_SHAPE (${shape && shape[1]})`);
  ok(sql.includes('drop constraint if exists web_items_dedupe_key_shape'), 'the CHECK is dropped before it is recreated');
  ok(/create index if not exists web_items_dedupe_idx on public\.web_items \(dedupe_key\)/.test(sql), 'dedupe_key has an index');
  ok(!/\b(delete|truncate|drop table|drop column|update public)\b/.test(sql), 'the migration deletes and rewrites nothing');

  console.log(`ok: ${passed} assertions (WEB dedupe: fingerprint, groups, rows, mock pair, Supabase siblings, migration)`);
  process.exitCode = 0;
})().catch((error) => fail(error.stack));
