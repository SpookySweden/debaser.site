/*
 * WEB Phase 2, run offline (SPEC-web.md; run by `npm run checks:web`, part of `npm run verify`):
 *   npx tsc app/lib/web/supabase-web-repository.ts app/lib/web/ingest.ts app/api/web/ingest/route.ts --outDir Temp/out-web-db --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - the Supabase repository, driven against an in-memory `web_items` that orders and filters the way
 *   Postgres does (timestamps by time, id byte by byte as collation "C"): walking every page with every
 *   page size neither drops nor repeats an item, ties included, and the order is the mock's (compareItems)
 * - the cursor round-trips: what a page hands out decodes to its last item, Postgres-style timestamps included
 * - every query selects only the column lists and has a limit; a forged cursor queries nothing
 * - the ingest: one failing source never stops the others; errors are plain words; an item the table
 *   would refuse is skipped, not fatal; an item sent twice is saved once; the per-run cap holds
 * - the ingest store through the (fake) lock functions: it touches no table, every call carries the lock;
 *   enabled sources only, never-checked first, with a limit; the save never writes `enabled`; a check updates
 *   its own source only; a wrong lock is an IngestLockError and writes nothing
 * - the route: shut (503) without the public Supabase values; 401 for a header outside the lock's bounds
 *   without asking the database; a plausible lock is handed to the database, and its refusal is a 401
 */
const { join } = require('node:path');

const OUT = join(__dirname, '..', 'Temp', 'out-web-db');
const { createSupabaseWebRepository } = require(join(OUT, 'lib', 'web', 'supabase-web-repository.js'));
const { runIngest, makeIngestStore, IngestLockError, SAVE_BATCH, MAX_SOURCES_PER_RUN, RUN_BUDGET_MS } = require(join(OUT, 'lib', 'web', 'ingest.js'));
const { compareItems, decodeCursor, encodeCursor } = require(join(OUT, 'lib', 'web', 'paging.js'));
const { WEB_ITEM_COLUMNS, WEB_SOURCE_COLUMNS, rowToItem } = require(join(OUT, 'lib', 'web', 'rows.js'));
const { SafeFetchError } = require(join(OUT, 'lib', 'web', 'safe-fetch.js'));

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

/* ------------------------------------------------------------------ a stand-in PostgREST over rows */
const queries = [];
function fakeClient(tables) {
  return {
    from(table) {
      const q = { table, columns: null, filters: [], orders: [], limit: null, upsert: null, update: null };
      queries.push(q);
      const cmp = (column, a, b) => {
        if (column === 'published_at' || column === 'last_checked_at') return Date.parse(a) - Date.parse(b);
        if (typeof a === 'boolean') return a === b ? 0 : a ? 1 : -1;
        // collation "C": byte order, which for ASCII is JS's own string order.
        return a < b ? -1 : a > b ? 1 : 0;
      };
      const builder = {
        select(columns) {
          q.columns = columns;
          return builder;
        },
        eq(column, value) {
          q.filters.push((row) => cmp(column, row[column], value) === 0);
          return builder;
        },
        lt(column, value) {
          q.filters.push((row) => cmp(column, row[column], value) < 0);
          return builder;
        },
        upsert(rows, options) {
          q.upsert = { rows, options };
          for (const row of rows) {
            const list = (tables[table] ||= []);
            const at = list.findIndex((r) => r.platform === row.platform && r.external_id === row.external_id);
            if (at === -1) list.push({ enabled: true, ...row });
            else list[at] = { ...list[at], ...row };
          }
          return builder;
        },
        update(values) {
          q.update = values;
          return builder;
        },
        order(column, { ascending, nullsFirst }) {
          q.orders.push([column, ascending, nullsFirst]);
          return builder;
        },
        limit(n) {
          q.limit = n;
          return builder;
        },
        then(resolve) {
          if (q.upsert) return resolve({ data: null, error: null });
          if (q.update) {
            for (const row of (tables[table] || []).filter((r) => q.filters.every((f) => f(r)))) Object.assign(row, q.update);
            return resolve({ data: null, error: null });
          }
          if (q.limit == null) return resolve({ data: null, error: { message: 'no limit' } });
          let rows = (tables[table] || []).filter((row) => q.filters.every((f) => f(row)));
          rows = [...rows].sort((a, b) => {
            for (const [column, ascending, nullsFirst] of q.orders) {
              if (a[column] == null || b[column] == null) {
                if (a[column] == null && b[column] == null) continue;
                return (a[column] == null) === Boolean(nullsFirst) ? -1 : 1;
              }
              const c = cmp(column, a[column], b[column]);
              if (c !== 0) return ascending ? c : -c;
            }
            return 0;
          });
          resolve({ data: rows.slice(0, q.limit), error: null });
        },
      };
      return builder;
    },
  };
}

/* ------------------------------------------------------------------ rows, with ties and awkward ids */
// Postgres hands timestamps back as `2026-10-22T13:40:00+00:00`, not the cursor's `...000Z`.
const pgTime = (iso) => iso.replace('.000Z', '+00:00');
const ids = ['Alpha', 'alpha', 'a_b', 'a-b', 'a.b', 'Z9', 'z9', '0start', 'b', 'B', 'mid_1', 'mid-1', 'mid.1'];
const moments = ['2026-10-22T13:40:00.000Z', '2026-10-22T13:40:00.000Z', '2026-10-25T08:00:00.000Z', '2026-10-30T23:59:59.000Z'];
const ROWS = [];
ids.forEach((externalId, i) => {
  for (const platform of ['internet_archive', 'openverse']) {
    ROWS.push({
      id: `${platform}:${externalId}`,
      platform,
      external_id: externalId,
      kind: 'audio',
      url: `https://example.org/${externalId}`,
      canonical_url: `https://example.org/${externalId}`,
      title: `Item ${externalId}`,
      creator: null,
      description: null,
      thumbnail_url: null,
      embed_url: null,
      license_url: null,
      duration_seconds: null,
      tags: null,
      published_at: pgTime(moments[i % moments.length]),
      fetched_at: pgTime('2026-10-31T12:00:00.000Z'),
    });
  }
});
const expected = ROWS.map(rowToItem).sort(compareItems).map((item) => item.id);
ok(expected.length === 26, 'the fixture has 26 rows');

(async () => {
  const repo = createSupabaseWebRepository(() => fakeClient({ web_items: ROWS }));
  ok(repo.source === 'supabase', 'the repository says it is the Supabase one');

  for (const size of [1, 2, 3, 5, 7, 10, 26, 50]) {
    const seen = [];
    let cursor = null;
    for (let guard = 0; guard < 100; guard += 1) {
      const page = await repo.listItems({ cursor, limit: size });
      ok(page.items.length <= size, `a page of ${size} has at most ${size} items`);
      seen.push(...page.items.map((item) => item.id));
      if (!page.nextCursor) break;
      const at = decodeCursor(page.nextCursor);
      const last = page.items[page.items.length - 1];
      ok(at && at.id === last.id && at.publishedAt === last.publishedAt, 'the cursor decodes to the last item on its page');
      ok(encodeCursor(at) === page.nextCursor, 'the cursor re-encodes to itself');
      cursor = page.nextCursor;
    }
    same(seen, expected, `paging by ${size} gives every item once, in the mock's order`);
  }

  for (const q of queries) {
    ok(q.limit != null && q.limit >= 1 && q.limit <= 51, `every query has a limit (${q.limit})`);
    // Updated on purpose 2026-11-01 (SPEC-media-servers.md): the media titles' read is held by check-web-media-db.cjs.
    if (q.table === 'web_media_titles') continue;
    ok(q.columns === WEB_ITEM_COLUMNS, `every item query selects WEB_ITEM_COLUMNS (got ${q.columns})`);
  }

  queries.length = 0;
  for (const forged of ['x', encodeCursor({ publishedAt: 'yesterday', id: 'internet_archive:a' }), btoa('2026-10-22T13:40:00.000Z|a),id.gt.0')]) {
    const page = await repo.listItems({ cursor: forged, limit: 5 });
    same(page, { items: [], nextCursor: null }, `a forged cursor gives an empty page (${forged.slice(0, 20)})`);
  }
  ok(queries.length === 0, 'a forged cursor queries nothing');

  const sourcesRepo = createSupabaseWebRepository(() =>
    fakeClient({ web_sources: [{ id: 's1', platform: 'internet_archive', ref: 'q', label: 'L', enabled: true, last_checked_at: null, last_error: null }] }),
  );
  queries.length = 0;
  const sources = await sourcesRepo.listSources();
  ok(sources.length === 1 && sources[0].label === 'L' && sources[0].lastCheckedAt === undefined, 'sources map from their rows');
  ok(queries[0].columns === WEB_SOURCE_COLUMNS && queries[0].limit != null, 'the sources query selects WEB_SOURCE_COLUMNS with a limit');

  let threw = null;
  try {
    await createSupabaseWebRepository(() => null).listItems({});
  } catch (error) {
    threw = error.message;
  }
  ok(threw === 'Media could not be read.', `no client is a plain-words error (got ${threw})`);

  /* ---------------------------------------------------------------- the ingest */
  const item = (platform, externalId, extra = {}) => ({
    id: `${platform}:${externalId}`,
    platform,
    externalId,
    kind: 'audio',
    url: `https://example.org/${externalId}`,
    canonicalUrl: `https://example.org/${externalId}`,
    title: `Item ${externalId}`,
    publishedAt: '2026-10-30T10:00:00.000Z',
    fetchedAt: '2026-10-31T12:00:00.000Z',
    ...extra,
  });
  const source = (id, platform) => ({ id, platform, ref: id, label: id.toUpperCase(), enabled: true });
  const adapters = {
    internet_archive: {
      platform: 'internet_archive',
      allowedHosts: [],
      linkHosts: [],
      async fetchItems(src) {
        if (src.id === 'fetch-fails') throw new SafeFetchError('timed out');
        if (src.id === 'bug') throw new Error('TypeError: cannot read x of undefined at /var/task/secret.js:1');
        if (src.id === 'save-fails') return [item('internet_archive', 'boom')];
        return [
          item('internet_archive', `${src.id}-1`),
          item('internet_archive', `${src.id}-2`, { title: 'first copy' }),
          item('internet_archive', `${src.id}-2`, { title: 'second copy' }),
          item('internet_archive', `${src.id}-http`, { url: 'http://example.org/x' }),
          item('openverse', `${src.id}-wrongplatform`),
          item('internet_archive', `${src.id}-long`, { title: 'x'.repeat(501) }),
        ];
      },
    },
  };
  const saved = [];
  const checks = [];
  const store = (list) => ({
    async sourcesToCheck(limit) {
      return list.slice(0, limit);
    },
    async saveItems(rowsToSave) {
      if (rowsToSave.some((row) => row.external_id === 'boom')) throw new Error('duplicate key value violates unique constraint');
      saved.push(...rowsToSave);
    },
    async recordCheck(id, at, error) {
      checks.push({ id, at, error });
    },
  });
  const now = () => new Date('2026-10-31T13:00:00.000Z');
  const list = [source('fetch-fails', 'internet_archive'), source('bug', 'internet_archive'), source('save-fails', 'internet_archive'), source('good', 'internet_archive'), source('nobody', 'peertube')];
  const result = await runIngest(store(list), adapters, { now });

  ok(result.checked === 5, `all five sources are checked although three fail (got ${result.checked})`);
  same(checks.map((c) => c.id), list.map((s) => s.id), 'every source has its check recorded, in order');
  ok(checks.every((c) => c.at === '2026-10-31T13:00:00.000Z'), 'last_checked_at is the run time');
  const byId = Object.fromEntries(result.results.map((r) => [r.sourceId, r]));
  ok(byId['fetch-fails'].error === 'The source could not be read (timed out).', `a fetch failure says so plainly (${byId['fetch-fails'].error})`);
  ok(byId.bug.error === 'The source could not be read.', `an unexpected error is not passed on (${byId.bug.error})`);
  ok(byId['save-fails'].error === 'The items were read but could not be saved.', `a database error is not passed on (${byId['save-fails'].error})`);
  ok(byId.nobody.error === 'WEB has no reader for this platform.', 'a platform with no adapter is a plain error');
  ok(byId.good.error === null && byId.good.saved === 2 && byId.good.skipped === 4, `odd items and a repeat are skipped, the rest saved (${JSON.stringify(byId.good)})`);
  same(saved.map((row) => row.id), ['internet_archive:good-1', 'internet_archive:good-2'], 'only the fitting items reach the table');
  ok(saved.find((row) => row.id === 'internet_archive:good-2').title === 'second copy', 'an item sent twice is saved once, the last copy');
  ok(saved.every((row) => !('enabled' in row)), 'the ingest never writes enabled (a takedown stays down)');
  ok(checks.find((c) => c.id === 'good').error === null, 'a good run clears last_error');
  for (const r of result.results) ok(!r.error || !/at \/|TypeError|constraint|\n/.test(r.error), `no stack or database text in an error (${r.error})`);

  const many = Array.from({ length: MAX_SOURCES_PER_RUN + 4 }, (_, i) => source(`s${i}`, 'internet_archive'));
  const overList = { ...store(many), sourcesToCheck: async () => many };
  const capped = await runIngest(overList, adapters, { now });
  ok(capped.checked === MAX_SOURCES_PER_RUN, `a run is capped at ${MAX_SOURCES_PER_RUN} sources even if more come back (got ${capped.checked})`);

  // The time budget: each read takes 14s on this clock, so sources start at 0, 14 and 28s; the fourth would
  // start at 42s, past RUN_BUDGET_MS, and waits for the next run (unrecorded, so it stays first in line).
  let clock = Date.parse('2026-10-31T13:00:00.000Z');
  const slow = {
    internet_archive: {
      ...adapters.internet_archive,
      async fetchItems(src) {
        clock += 14_000;
        return [item('internet_archive', `${src.id}-1`)];
      },
    },
  };
  checks.length = 0;
  const budgeted = await runIngest(store(many.slice(0, 5)), slow, { now: () => new Date(clock) });
  ok(RUN_BUDGET_MS === 30_000 && budgeted.checked === 3, `no source starts after ${RUN_BUDGET_MS}ms (checked ${budgeted.checked} of 5)`);
  ok(checks.length === 3, 'a source the budget held back has no check recorded');

  /* ---------------------------------------------------------------- the store on the tables */
  const srcRow = (id, enabled, lastChecked) => ({ id, platform: 'internet_archive', ref: id, label: id, enabled, last_checked_at: lastChecked, last_error: null });
  const tables = {
    web_sources: [srcRow('recent', true, '2026-10-31T10:00:00+00:00'), srcRow('off', false, null), srcRow('never', true, null), srcRow('older', true, '2026-10-30T10:00:00+00:00')],
    web_items: [{ ...ROWS[0], id: 'internet_archive:good-1', external_id: 'good-1', title: 'old title', enabled: false }],
  };
  // The three lock functions (20261031190000_web_ingest_lock.sql), as Postgres runs them: a wrong lock is
  // SQLSTATE 28000 before anything is read or written; the save upserts on (platform, external_id) and
  // never writes `enabled`.
  const LOCK = 'f'.repeat(64);
  const calls = [];
  const rpcClient = {
    from() {
      throw new Error('the ingest store must not touch a table directly');
    },
    async rpc(name, args) {
      calls.push({ name, args });
      if (args.p_secret !== LOCK) return { data: null, error: { code: '28000', message: 'not allowed' } };
      if (name === 'web_ingest_sources') {
        const rows = tables.web_sources
          .filter((r) => r.enabled)
          .sort((a, b) => (a.last_checked_at === null ? -1 : b.last_checked_at === null ? 1 : Date.parse(a.last_checked_at) - Date.parse(b.last_checked_at)))
          .slice(0, Math.min(Math.max(args.p_limit ?? 0, 0), 5));
        return { data: rows, error: null };
      }
      if (name === 'web_ingest_save') {
        for (const row of args.p_rows) {
          const { enabled: _dropped, ...fields } = row;
          const at = tables.web_items.findIndex((r) => r.platform === row.platform && r.external_id === row.external_id);
          if (at === -1) tables.web_items.push({ enabled: true, ...fields });
          else tables.web_items[at] = { ...tables.web_items[at], ...fields };
        }
        return { data: args.p_rows.length, error: null };
      }
      if (name === 'web_ingest_record') {
        const source = tables.web_sources.find((r) => r.id === args.p_source_id);
        if (source) Object.assign(source, { last_checked_at: args.p_checked_at, last_error: args.p_error });
        return { data: null, error: null };
      }
      return { data: null, error: { code: '42883', message: 'no such function' } };
    },
  };
  const real = makeIngestStore(rpcClient, LOCK);
  same((await real.sourcesToCheck(3)).map((x) => x.id), ['never', 'older', 'recent'], 'enabled sources only, never-checked first, then oldest');
  ok(calls[0].name === 'web_ingest_sources' && calls[0].args.p_limit === 3, 'the sources read asks the lock function, with its limit');
  await real.saveItems(saved.filter((row) => row.external_id.startsWith('good-')));
  ok(calls.every((c) => c.args.p_secret === LOCK), 'every call carries the lock it was given');
  const bulk = Array.from({ length: 250 }, (_, i) => ({ ...ROWS[0], id: `internet_archive:bulk-${i}`, external_id: `bulk-${i}` }));
  const savesBefore = calls.filter((c) => c.name === 'web_ingest_save').length;
  await real.saveItems(bulk);
  const bulkCalls = calls.filter((c) => c.name === 'web_ingest_save').slice(savesBefore);
  ok(bulkCalls.length === 3 && bulkCalls.every((c) => c.args.p_rows.length <= SAVE_BATCH) && SAVE_BATCH === 100, `250 rows go in batches of at most 100, the database's cap (${bulkCalls.map((c) => c.args.p_rows.length).join(', ')})`);
  ok(bulk.every((row) => tables.web_items.some((r) => r.id === row.id)), 'every batched row is saved');
  tables.web_items = tables.web_items.filter((r) => !r.id.startsWith('internet_archive:bulk-'));
  const wrong = makeIngestStore(rpcClient, 'e'.repeat(64));
  let refused = null;
  try {
    await wrong.sourcesToCheck(3);
  } catch (error) {
    refused = error;
  }
  ok(refused instanceof IngestLockError, `a wrong lock is an IngestLockError (${refused && refused.constructor.name})`);
  const before = JSON.stringify(tables);
  await wrong.saveItems([{ ...ROWS[0], id: 'internet_archive:intruder', external_id: 'intruder' }]).catch(() => {});
  await wrong.recordCheck('older', '2027-01-01T00:00:00.000Z', null).catch(() => {});
  ok(JSON.stringify(tables) === before, 'a wrong lock writes nothing');
  const taken = tables.web_items.find((r) => r.id === 'internet_archive:good-1');
  ok(taken.enabled === false && taken.title === 'Item good-1', 'a re-read updates a taken-down item and leaves it down');
  ok(tables.web_items.length === 2, 'the upsert updated one row and inserted one');
  await real.recordCheck('older', '2026-10-31T13:00:00.000Z', 'The source could not be read.');
  const after = Object.fromEntries(tables.web_sources.map((r) => [r.id, r]));
  ok(after.older.last_checked_at === '2026-10-31T13:00:00.000Z' && after.older.last_error === 'The source could not be read.', 'a check is recorded on its source');
  ok(after.never.last_checked_at === null && after.recent.last_error === null, 'and on no other source');

  /* ---------------------------------------------------------------- the route's lock */
  // No network: past the lock the database call fails at once, whatever the local DNS does.
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };
  const { POST } = require(join(OUT, 'api', 'web', 'ingest', 'route.js'));
  const call = (secret) => POST(new Request('https://x.test/api/web/ingest', { method: 'POST', headers: secret == null ? {} : { 'x-web-ingest-secret': secret } }));
  const SECRET = 'a'.repeat(64);
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'public-key';
  ok((await call(SECRET)).status === 503, 'no Supabase address: shut (503)');
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ingest-check.invalid';
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  ok((await call(SECRET)).status === 503, 'no public key: shut (503)');
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'public-key';
  let asked = 0;
  globalThis.fetch = async () => {
    asked += 1;
    throw new TypeError('fetch failed');
  };
  ok((await call(null)).status === 401, 'no header: 401');
  ok((await call('short')).status === 401, 'a header too short to be the lock: 401');
  ok((await call('a'.repeat(201))).status === 401, 'a header too long to be the lock: 401');
  ok(asked === 0, `a header outside the lock's bounds never reaches the database (${asked} calls)`);
  const pastGate = await call(SECRET);
  const body = await pastGate.json();
  // A plausible lock goes to the (unreachable) database, which judges it; the route answers in plain words.
  ok(asked > 0 && pastGate.status === 500 && body.error === 'The WEB sources could not be read.', `a plausible lock is handed to the database (${pastGate.status} ${JSON.stringify(body)})`);
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ code: '28000', message: 'not allowed', details: null, hint: null }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  const refusedCall = await call(SECRET);
  ok(refusedCall.status === 401, `the database refusing the lock is a 401 (${refusedCall.status})`);

  console.log(`ok: ${passed} assertions (WEB Supabase paging and cursor, ingest isolation, route lock)`);
  process.exitCode = 0;
})().catch((error) => fail(error && error.stack));
