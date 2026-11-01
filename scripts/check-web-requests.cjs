/*
 * WEB saving opened items (SPEC-web-search.md; run by `npm run checks:web`):
 *   npx tsc app/lib/web/ingest.ts --outDir Temp/out-web-requests --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *
 * - the migration: RLS on with no policies and no table grants; the page's function only for signed-in people,
 *   checking platform and id, capped at 50 a day; the ingest's two functions refuse without the lock; re-runnable
 * - the platforms the table accepts are exactly the ones fetchOne can resolve
 * - the ingest: off unless asked; saves a found item and marks it done; a gone item failed; no answer retried;
 *   an answer about another item refused; a missing table (before the migration) is quiet; stays in the budget
 * - the page: saving is off unless NEXT_PUBLIC_WEB_SAVE_OPENED=on (on in production since the migration was
 *   pushed, Luke's OK 2026-10-31); it sends only (platform, external id); DISCUSS is not offered on EVERYWHERE
 *   rows while it is off
 */
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { NOW, makeAsserts } = require('./web-search-check-kit.cjs');

const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'Temp', 'out-web-requests', 'lib', 'web');
const ingest = require(join(OUT, 'ingest.js'));
const asserts = makeAsserts('WEB saving opened items');
const { ok, same } = asserts;
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const sqlCode = (text) => text.replace(/--.*$/gm, '').toLowerCase();

(async () => {
  /* ---------------------------------------------------------------- the migration */
  const file = readdirSync(join(ROOT, 'supabase', 'migrations')).find((name) => /^\d{14}_web_requests\.sql$/.test(name));
  ok(file, 'the web_requests migration exists');
  ok(file > readdirSync(join(ROOT, 'supabase', 'migrations')).find((name) => /_web_ingest_lock\.sql$/.test(name)), 'it comes after the lock it uses');
  const sql = sqlCode(read(`supabase/migrations/${file}`));
  ok(/create table if not exists public\.web_requests/.test(sql), 'the table is made only if missing');
  ok(/alter table public\.web_requests enable row level security;/.test(sql), 'RLS is on');
  ok(!/create policy/.test(sql), 'no policy: nobody reads or writes the table directly');
  ok(/revoke all on table public\.web_requests from public, anon, authenticated;/.test(sql), 'no table grants for the API roles');
  ok(!/grant (select|insert|update|delete|all) on/.test(sql), 'no table grant anywhere');
  ok(/on conflict \(platform, external_id\) where status = 'pending' do nothing/.test(sql), 'a repeat is skipped');
  ok(/create unique index if not exists web_requests_one_pending on public\.web_requests \(platform, external_id\) where status = 'pending'/.test(sql), 'one pending request per item');
  const fn = (name) => {
    const at = sql.indexOf(`function public.${name}(`);
    ok(at >= 0, `${name} is defined`);
    return sql.slice(at, sql.indexOf('$$;', at));
  };
  const add = fn('web_request_add');
  ok(/security definer/.test(add) && /set search_path = ''/.test(add), 'the page function runs as its owner with an empty search path');
  ok(/me uuid := auth\.uid\(\)/.test(add) && /if me is null then\s+raise exception/.test(add), 'only for someone signed in');
  ok(/>= 50 then\s+return;/.test(add) && /interval '1 day'/.test(add), 'at most 50 a person a day');
  ok(/p_external_id !~ '\^\[a-za-z0-9\]\[a-za-z0-9\._-\]\{0,199\}\$'/.test(add), 'the id is checked');
  ok(/values \(p_platform, p_external_id, me\)/.test(add), 'the row is filed under the caller, never a sent id');
  ok(/grant execute on function public\.web_request_add\(text, text\) to authenticated;/.test(sql), 'callable by signed-in people');
  ok(!/grant execute on function public\.web_request_add\(text, text\) to anon/.test(sql), 'not by visitors');
  for (const name of ['web_ingest_requests', 'web_ingest_request_done']) {
    const body = fn(name);
    ok(/if not public\.web_ingest_lock_ok\(p_secret\) then\s+raise exception 'not allowed' using errcode = '28000'/.test(body), `${name} refuses without the lock`);
    ok(/security definer/.test(body) && /set search_path = ''/.test(body), `${name} runs as its owner with an empty search path`);
  }
  ok(/limit least\(greatest\(coalesce\(p_limit, 0\), 0\), 10\)/.test(fn('web_ingest_requests')), 'the ingest reads at most 10');
  ok(/when tries \+ 1 >= 5 then 'failed'/.test(fn('web_ingest_request_done')), 'failed after five tries');

  const listed = (text) => [...text.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  const tablePlatforms = listed(sql.match(/check \(platform in \(([^)]*)\)\)/)[1]);
  const fnPlatforms = listed(add.match(/p_platform not in \(([^)]*)\)/)[1]);
  same(fnPlatforms, tablePlatforms, 'the function and the table accept the same platforms');
  const index = read('app/lib/web/search/index.ts');
  const providerFiles = { internet_archive: 'internet-archive', youtube: 'youtube', peertube: 'peertube', wikimedia_commons: 'wikimedia-commons', openverse: 'openverse', vimeo: 'vimeo' };
  same(Object.keys(providerFiles).sort(), tablePlatforms, 'the accepted platforms are exactly those with a fetchOne');
  for (const [platform, name] of Object.entries(providerFiles)) {
    ok(index.includes(`./providers/${name}'`), `${platform} has a provider in the registry`);
    ok(new RegExp(`platform: '${platform}'`).test(read(`app/lib/web/search/providers/${name}.ts`)), `${name}.ts serves ${platform}`);
  }

  /* ---------------------------------------------------------------- the ingest */
  const item = (platform, externalId, extra = {}) => ({
    id: `${platform}:${externalId}`, platform, externalId, kind: 'video', url: `https://archive.org/details/${externalId}`,
    canonicalUrl: `https://archive.org/details/${externalId}`, title: externalId, publishedAt: NOW, fetchedAt: NOW, ...extra,
  });
  function makeStore(requests, { failRead = false } = {}) {
    const saved = [];
    const marks = [];
    return {
      saved,
      marks,
      async sourcesToCheck() { return []; },
      async saveItems(rows) { saved.push(...rows); },
      async recordCheck() {},
      async requestsToResolve(limit) {
        if (failRead) throw new Error('function public.web_ingest_requests does not exist');
        return requests.slice(0, limit);
      },
      async markRequest(id, outcome) { marks.push([id, outcome]); },
    };
  }
  const asked = [];
  const providers = {
    internet_archive: {
      platform: 'internet_archive',
      async fetchOne(id, deps) {
        asked.push([id, deps.env && deps.env.YOUTUBE_API_KEY]);
        if (id === 'gone') return null;
        if (id === 'down') throw new Error('timed out');
        if (id === 'other') return item('internet_archive', 'someone-else');
        if (id === 'bad-url') return item('internet_archive', 'bad-url', { url: 'http://archive.org/details/bad-url' });
        return item('internet_archive', id);
      },
    },
  };
  const requests = [
    { id: 'r1', platform: 'internet_archive', externalId: 'found' },
    { id: 'r2', platform: 'internet_archive', externalId: 'gone' },
    { id: 'r3', platform: 'internet_archive', externalId: 'down' },
    { id: 'r4', platform: 'internet_archive', externalId: 'other' },
    { id: 'r5', platform: 'podcast', externalId: 'x' },
    { id: 'r6', platform: 'internet_archive', externalId: 'never-read' },
  ];

  const off = makeStore(requests);
  const quiet = await ingest.runIngest(off, {}, { now: () => new Date(NOW) });
  same(quiet.requests, undefined, 'off unless asked: no requests are read');
  same(off.marks.length, 0, '... and none are marked');

  const on = makeStore(requests);
  const result = await ingest.runIngest(on, {}, { now: () => new Date(NOW) }, { providers, env: { YOUTUBE_API_KEY: 'k' } });
  same(
    result.requests,
    [
      { requestId: 'r1', outcome: 'done' },
      { requestId: 'r2', outcome: 'failed' },
      { requestId: 'r3', outcome: 'retry' },
      { requestId: 'r4', outcome: 'failed' },
      { requestId: 'r5', outcome: 'failed' },
    ],
    'found: done; gone: failed; no answer: retry; another item: failed; no provider: failed; at most five a run',
  );
  same(on.saved.map((row) => row.id), ['internet_archive:found'], 'only the found item is saved');
  same(on.marks, [['r1', 'done'], ['r2', 'failed'], ['r3', 'retry'], ['r4', 'failed'], ['r5', 'failed']], 'each is marked');
  ok(asked.every(([, key]) => key === 'k'), 'the providers get the server-only settings');
  const badUrl = makeStore([{ id: 'r7', platform: 'internet_archive', externalId: 'bad-url' }]);
  same((await ingest.runIngest(badUrl, {}, { now: () => new Date(NOW) }, { providers })).requests, [{ requestId: 'r7', outcome: 'failed' }], 'an item that does not fit the table is not saved');
  same(badUrl.saved.length, 0, '... nothing saved');

  const missing = makeStore(requests, { failRead: true });
  const before = await ingest.runIngest(missing, {}, { now: () => new Date(NOW) }, { providers });
  same(before.requests, [], 'before the migration the requests part is quiet');

  let clock = Date.parse(NOW);
  const slow = makeStore(requests);
  const late = await ingest.runIngest(slow, {}, { now: () => new Date((clock += 20_000)) }, { providers });
  ok((late.requests ?? []).length <= 1, `no request starts past the run's budget (${(late.requests ?? []).length} started)`);

  /* ---------------------------------------------------------------- the page */
  const save = read('app/lib/web/save-opened.ts');
  ok(/export const SAVE_OPENED = process\.env\.NEXT_PUBLIC_WEB_SAVE_OPENED === 'on' && WEB_DATA_SOURCE === 'supabase';/.test(save), 'saving is off unless switched on (with the Supabase data source)');
  ok(/db\.rpc\('web_request_add', \{ p_platform: item\.platform, p_external_id: item\.externalId \}\)/.test(save), 'the page sends only the platform and the id');
  ok(!/\.from\(/.test(save), 'the page touches no table');
  // Switched on once the table existed (pushed with Luke's OK, 2026-10-31). Before that this asserted the opposite.
  ok(/^NEXT_PUBLIC_WEB_SAVE_OPENED=on$/m.test(read('.env.production').replace(/\r/g, '')), 'production switches saving on (the table exists)');
  const stream = read('app/components/WebStream.tsx');
  ok(/\{!found \|\| SAVE_OPENED \? <WebDiscussKey item=\{item\} onOpen=\{opened\} \/> : null\}/.test(stream), 'DISCUSS is offered on EVERYWHERE rows only while saving is on');
  ok(/if \(found\) void recordOpened\(item\);/.test(stream), 'only EVERYWHERE rows ask to be saved');

  asserts.done();
})().catch((error) => {
  console.log(`FAIL ${error.stack}`);
  process.exit(1);
});
