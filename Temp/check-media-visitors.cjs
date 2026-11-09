/*
 * MEDIA (/media) opened to signed-out visitors, 2026-11-09 (Luke: "Everything", and his OK for
 * supabase/migrations/20261109003047_media_open_to_visitors.sql). Live, against the real project and the deployed site:
 *   node Temp/check-media-visitors.cjs [--site https://debaser-site.vercel.app]
 *
 * With no session at all (the public key only), it asks for real:
 * - what is now open: the stream, the friends'-server titles, DISCOVER's words and pool files, RECOMMENDED (with no
 *   person or name in any row), and the deployed search route (no sign-in refusal);
 * - what still needs an account and must still refuse: each person's own recommendations and DISCOVER presets, every
 *   write a reader makes from /media (recommend, save an opened item, note seen items), and the account-only routes
 *   (your YouTube, DISCOVER's link reader, a stream room's picture search).
 * Reads only. The refused writes send values that would be harmless even if one were wrongly let through.
 * Prints counts and refused/allowed, never a row's contents.
 */
const { createClient } = require('@supabase/supabase-js');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { loadEnv } = require('../scripts/browser.cjs');

loadEnv();
const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const siteArg = process.argv.indexOf('--site');
const SITE = siteArg > -1 ? process.argv[siteArg + 1] : 'https://debaser-site.vercel.app';
const REFUSED = '42501';

let failures = 0;
function report(ok, label, detail = '') {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail === '' ? '' : ` :: ${detail}`}`);
}

async function main() {
  if (!URL_BASE || !KEY) throw new Error('no Supabase project in the environment (.env.local)');
  const visitor = createClient(URL_BASE, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who } = await visitor.auth.getSession();
  report(who.session === null, 'asking with no session at all');

  console.log('Open to visitors:');
  for (const [table, columns] of [
    ['web_items', 'id'],
    ['web_media_titles', 'id'],
    ['web_media_copies', 'title_id'],
    ['web_word_stats', 'word'],
    ['web_word_facts', 'word'],
    ['web_pool_shards', 'path'],
    ['web_item_tags', 'item_id'],
    ['web_seen_items', 'id'],
  ]) {
    const { data, error } = await visitor.from(table).select(columns).limit(1);
    report(error === null, `${table} readable`, error === null ? `${data.length} row(s) on a limit of 1` : error.code);
  }
  const { data: shard } = await visitor.from('web_pool_shards').select('path').limit(1);
  if (shard && shard.length > 0) {
    const { data: file, error } = await visitor.storage.from('web-pool').download(shard[0].path);
    report(error === null && file !== null && file.size > 0, 'a pool file downloads', error === null ? `${file.size} bytes` : String(error.message ?? error));
  } else {
    report(false, 'a pool file downloads', 'no pool file is listed to try');
  }
  // DISCOVER's map is shared whoever builds it, so a visitor must read the spend flag too (20261109011919_media_visitors_tag_limit.sql).
  const limit = await visitor.rpc('web_tag_limit_reached');
  report(limit.error === null && typeof limit.data === 'boolean', 'the tagging spend flag readable (the shared map is the same for everyone)', limit.error === null ? '' : limit.error.code);
  const feed = await visitor.rpc('web_recommendations_feed', { p_limit: 50 });
  report(feed.error === null, 'RECOMMENDED readable', feed.error === null ? `${feed.data.length} row(s)` : feed.error.code);
  report(feed.error === null && feed.data.every((row) => row.person === null && row.display_name === null), 'no person or name in any RECOMMENDED row', feed.error === null && feed.data.length === 0 ? 'no rows today, so only the rule below proves it' : '');
  const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20261109003047_media_open_to_visitors.sql'), 'utf8');
  report(/named boolean := auth\.uid\(\) is not null and not coalesce\(public\.is_guest\(\), false\);/.test(sql) && /select case when named then r\.person end, case when named then p\.display_name end,/.test(sql), 'the feed names people only for signed-in accounts (the migration)');

  const search = await fetch(`${SITE}/api/web/search?q=night&provider=nowhere`);
  report(search.status === 400, 'the deployed search answers a visitor (400: no such source, nothing fetched)', `status ${search.status}`);
  const map = await fetch(`${SITE}/api/tag-station/graph`);
  report(map.status === 200 || map.status === 503, 'the deployed DISCOVER map answers a visitor', `status ${map.status}`);

  console.log('Still refused to visitors:');
  for (const table of ['web_recommendations', 'discover_presets']) {
    const { data, error } = await visitor.from(table).select('created_at').limit(1);
    report(error?.code === REFUSED || (error === null && data.length === 0), `${table} (each person's own) unreadable`, error?.code ?? `${data.length} rows`);
  }
  for (const [name, args] of [
    ['web_recommend_set', { p_platform: 'youtube', p_external_id: 'visitor-check', p_on: false }],
    ['web_request_add', { p_platform: 'youtube', p_external_id: 'visitor-check' }],
    ['web_seen_add', { p_platform: 'youtube', p_external_ids: [] }],
    ['discover_preset_activate', { p_id: null }],
  ]) {
    const { error } = await visitor.rpc(name, args);
    report(error !== null && (error.code === REFUSED || error.code === '28000'), `${name} refused`, error === null ? 'ALLOWED' : error.code);
  }
  for (const [path, label, method] of [
    ['/api/web/youtube/mine', 'your YouTube', 'POST'],
    ['/api/tag-station/link?url=https%3A%2F%2Fexample.com', "DISCOVER's link reader", 'GET'],
    ['/api/watch/images?q=cat', "a stream room's picture search", 'GET'],
  ]) {
    const answer = await fetch(`${SITE}${path}`, { method });
    report(answer.status === 401, `${label} refuses a visitor`, `status ${answer.status}`);
  }

  console.log(failures === 0 ? 'MEDIA visitors: all ok' : `MEDIA visitors: ${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
