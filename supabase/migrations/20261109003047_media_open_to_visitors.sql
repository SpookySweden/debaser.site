-- MEDIA (/media) opens to signed-out visitors (Luke, 2026-11-09: "remove the need to be signed in to access the media tab",
-- then "Everything" and his OK for this change). Until now SPEC-media-servers.md decision 4 kept it for signed-in people.
--
-- What changes: visitors (the `anon` role) may read what signed-in people read on /media, with the same columns:
--   - friends' media servers' titles and which server holds each (`web_media_titles`, `web_media_copies`);
--   - the words behind the DISCOVER and RECOMMENDED lists (`web_item_tags`, `web_pool_items`, `web_pool_shards`,
--     `web_seen_items`, `web_word_facts`, `web_word_stats`) and the pool's compressed files (storage bucket `web-pool`);
--   - the RECOMMENDED list (`web_recommendations_feed`), WITHOUT who recommended what: a visitor (or a stream-room guest)
--     gets no person and no name, only the items (the board's ANON rule, SPEC-privacy-decisions.md decision 5).
-- Nothing is deleted or rewritten, and nothing a person owns opens: `web_recommendations` (each person's own),
-- `discover_presets`, and every write stay as they were. The "guests stay out" policies are for the authenticated role
-- and are untouched. These tables hold media details only, no person's id or name.
--
-- Undo: drop the policies named "... readable by visitors", revoke the anon grants below, and put the feed back to
-- `20261105153646_web_recommendations.sql`'s version (sign-in required).
--
-- Re-runnable: policies dropped and recreated by name, `create or replace`, grants revoked before given.

-- The same columns signed-in people are granted (read from the live grants on 2026-11-09).
revoke select on public.web_item_tags from anon;
grant select (item_id, words) on public.web_item_tags to anon;
revoke select on public.web_media_copies from anon;
grant select (title_id, server, local_id, episodes, seen_at) on public.web_media_copies to anon;
revoke select on public.web_media_titles from anon;
grant select (id, media_type, tmdb_id, title, creator, description, thumbnail_url, duration_seconds, released_at, details,
  details_checked_at, published_at, fetched_at, collection_id) on public.web_media_titles to anon;
revoke select on public.web_pool_items from anon;
grant select (id, platform, external_id, host, kind, title, creator, published_at, tmdb_ref, words) on public.web_pool_items to anon;
revoke select on public.web_pool_shards from anon;
grant select (id, path, items, words) on public.web_pool_shards to anon;
revoke select on public.web_seen_items from anon;
grant select (id, platform, kind, title, creator, published_at, words) on public.web_seen_items to anon;
revoke select on public.web_word_facts from anon;
grant select (word, facet, same_as, vague) on public.web_word_facts to anon;
revoke select on public.web_word_stats from anon;
grant select (id, word, items, partners) on public.web_word_stats to anon;

-- The same rows signed-in people see.
drop policy if exists "item words readable by visitors" on public.web_item_tags;
create policy "item words readable by visitors" on public.web_item_tags for select to anon using (true);
drop policy if exists "web media copies readable by visitors" on public.web_media_copies;
create policy "web media copies readable by visitors" on public.web_media_copies for select to anon using (true);
drop policy if exists "web media titles readable by visitors" on public.web_media_titles;
create policy "web media titles readable by visitors" on public.web_media_titles for select to anon using (true);
drop policy if exists "tagged pool items readable by visitors" on public.web_pool_items;
create policy "tagged pool items readable by visitors" on public.web_pool_items for select to anon using (cardinality(words) > 0);
drop policy if exists "pool files listed for visitors" on public.web_pool_shards;
create policy "pool files listed for visitors" on public.web_pool_shards for select to anon using (true);
drop policy if exists "seen items readable by visitors" on public.web_seen_items;
create policy "seen items readable by visitors" on public.web_seen_items for select to anon using (true);
drop policy if exists "word facts readable by visitors" on public.web_word_facts;
create policy "word facts readable by visitors" on public.web_word_facts for select to anon using (true);
drop policy if exists "word stats readable by visitors" on public.web_word_stats;
create policy "word stats readable by visitors" on public.web_word_stats for select to anon using (true);

-- The pool's files, read by DISCOVER's [ MORE ] (signed-in people already may: "web pool files readable by the signed in").
drop policy if exists "web pool files readable by visitors" on storage.objects;
create policy "web pool files readable by visitors" on storage.objects for select to anon using (bucket_id = 'web-pool');

-- RECOMMENDED for everyone; names and ids only for signed-in people who aren't stream-room guests.
create or replace function public.web_recommendations_feed(p_limit integer)
returns table (person uuid, display_name text, item_id text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  named boolean := auth.uid() is not null and not coalesce(public.is_guest(), false);
begin
  return query
    select case when named then r.person end, case when named then p.display_name end, r.platform || ':' || r.external_id, r.created_at
    from public.web_recommendations r
    join public.profiles p on p.id = r.person
    where not p.is_hidden and p.banned_at is null
    order by r.created_at desc, r.person, r.external_id
    limit least(greatest(coalesce(p_limit, 0), 0), 500);
end;
$$;

revoke all on function public.web_recommendations_feed(integer) from public, anon, authenticated;
grant execute on function public.web_recommendations_feed(integer) to anon, authenticated;
