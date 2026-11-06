-- Swept items as compressed files (Luke, 2026-11-06: "find a way around the database limit"; SPEC-discover.md). A row in the database takes about 520
-- bytes and the free plan has 500 MB; the same row in a compressed file takes about 30, and file storage has its own 1 GB.
--
-- What this adds or changes, and nothing else:
--   - The bucket `web-pool`: private, 20 MB a file (a full batch's list while it's out). Signed-in people can read it. Only the job can write to it, with the same lock as every web_tag_*
--     function, sent as a header. Holds source, id, type, title, creator, date, Claude's words and a film's TMDB number from Wikidata: no description,
--     no counts, no person, no TMDB text.
--   - web_pool_shards: one row per file: where it is, how many items, and which words are in it, as numbers. How a list finds the right files.
--     Signed-in people can read it; nobody can write through the API.
--   - web_word_stats.id: a small number for each word.
--   - web_pool_items.filed_at: when a row was copied into a file. The row limit goes back to the 100,000 Luke approved, and a row can only be removed
--     once it's filed, so nothing tagged is lost.
--   - web_pool_room also says no past 800 MB of files.
--
-- No other table, rule or row is touched. Re-runnable.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('web-pool', 'web-pool', false, 20971520, array['application/octet-stream'])
on conflict (id) do update
  set public = false, file_size_limit = 20971520, allowed_mime_types = array['application/octet-stream'];

-- The job's lock, as the storage API passes it on: the header of the request being served.
create or replace function public.web_pool_header_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.web_ingest_lock_ok(coalesce(nullif(pg_catalog.current_setting('request.headers', true), '')::json ->> 'x-web-ingest-secret', ''));
$$;

revoke all on function public.web_pool_header_ok() from public, anon, authenticated;
grant execute on function public.web_pool_header_ok() to anon;

drop policy if exists "web pool files readable by the signed in" on storage.objects;
create policy "web pool files readable by the signed in" on storage.objects
  for select to authenticated using (bucket_id = 'web-pool');

drop policy if exists "web pool files read by the job" on storage.objects;
create policy "web pool files read by the job" on storage.objects
  for select to anon using (bucket_id = 'web-pool' and public.web_pool_header_ok());

drop policy if exists "web pool files added by the job" on storage.objects;
create policy "web pool files added by the job" on storage.objects
  for insert to anon with check (bucket_id = 'web-pool' and public.web_pool_header_ok());

drop policy if exists "web pool files replaced by the job" on storage.objects;
create policy "web pool files replaced by the job" on storage.objects
  for update to anon using (bucket_id = 'web-pool' and public.web_pool_header_ok()) with check (bucket_id = 'web-pool' and public.web_pool_header_ok());

drop policy if exists "web pool files removed by the job" on storage.objects;
create policy "web pool files removed by the job" on storage.objects
  for delete to anon using (bucket_id = 'web-pool' and public.web_pool_header_ok());

alter table public.web_word_stats add column if not exists id integer generated always as identity;
create unique index if not exists web_word_stats_id_idx on public.web_word_stats (id);
-- A list looks words up by this number, with the reader's own rights.
grant select (id) on public.web_word_stats to authenticated;

alter table public.web_pool_items add column if not exists filed_at timestamptz;
create index if not exists web_pool_items_unfiled_idx on public.web_pool_items (swept_at) where filed_at is null;

create table if not exists public.web_pool_shards (
  id bigint generated always as identity primary key,
  path text collate "C" not null unique,
  items integer not null,
  -- web_word_stats.id of the words in this file.
  words integer[] not null default '{}',
  added_at timestamptz not null default now()
);

alter table public.web_pool_shards drop constraint if exists web_pool_shards_sizes;
alter table public.web_pool_shards add constraint web_pool_shards_sizes check (char_length(path) <= 200 and items >= 0);

create index if not exists web_pool_shards_words_idx on public.web_pool_shards using gin (words);

alter table public.web_pool_shards enable row level security;

drop policy if exists "pool files listed for the signed in" on public.web_pool_shards;
create policy "pool files listed for the signed in" on public.web_pool_shards
  for select to authenticated using (true);

revoke all on public.web_pool_shards from public, anon, authenticated;
grant select (id, path, items, words) on public.web_pool_shards to authenticated;

-- A file the job has just written. Writing the same one twice changes nothing.
create or replace function public.web_pool_shard_add(p_secret text, p_path text, p_items integer, p_words text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  insert into public.web_pool_shards (path, items, words)
    values (p_path, p_items, array(select s.id from public.web_word_stats s where s.word = any (p_words)))
  on conflict (path) do nothing;
end;
$$;

-- The files holding most of these words. The seed keeps one reader's order steady for a visit and different from the next.
create or replace function public.web_pool_shards_for(p_words text[], p_limit integer, p_seed text)
returns setof text
language sql
stable
set search_path = ''
as $$
  with wanted as (
    select array(select s.id from public.web_word_stats s where s.word = any (p_words)) as ids
  )
  select f.path::text
  from public.web_pool_shards f, wanted
  where f.words operator(pg_catalog.&&) wanted.ids
  order by (select count(*) from unnest(f.words) w where w = any (wanted.ids)) desc, pg_catalog.md5(f.path || coalesce(p_seed, ''))
  limit least(greatest(coalesce(p_limit, 0), 0), 8);
$$;

revoke all on function public.web_pool_shards_for(text[], integer, text) from public, anon, authenticated;
grant execute on function public.web_pool_shards_for(text[], integer, text) to authenticated;

-- Tagged rows not in a file yet.
create or replace function public.web_pool_unfiled(p_secret text, p_limit integer)
returns table (id text, platform text, external_id text, host text, kind text, title text, creator text, published_at timestamptz, tmdb_ref text, words text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  return query
    select p.id::text, p.platform, p.external_id, p.host, p.kind, p.title, p.creator, p.published_at, p.tmdb_ref, p.words
    from public.web_pool_items p
    where p.filed_at is null and p.batch_id is null and cardinality(p.words) > 0
    order by p.swept_at, p.id
    limit least(greatest(coalesce(p_limit, 0), 0), 1000);
end;
$$;

create or replace function public.web_pool_filed(p_secret text, p_ids text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  update public.web_pool_items p set filed_at = now() where p.id = any (p_ids);
end;
$$;

-- A sample of each finished batch stays as rows, already filed, for the map's own list.
create or replace function public.web_pool_hot_add(p_secret text, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  insert into public.web_pool_items (id, platform, external_id, host, kind, title, creator, published_at, tmdb_ref, words, tagged_at, filed_at)
    select r.value ->> 'id', r.value ->> 'platform', r.value ->> 'externalId', r.value ->> 'host', r.value ->> 'kind',
           left(r.value ->> 'title', 600), left(r.value ->> 'creator', 200), (r.value ->> 'publishedAt')::timestamptz, r.value ->> 'tmdbRef',
           array(select jsonb_array_elements_text(r.value -> 'words')), now(), now()
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  on conflict (id) do nothing;
end;
$$;

-- As before, except the limit is back to 100,000, and only rows already in a file can go.
create or replace function public.web_pool_release(p_secret text, p_batch text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz;
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  update public.web_pool_items p set batch_id = null where p.batch_id = p_batch;
  update public.web_sweep_batches set collected_at = now() where batch_id = p_batch and collected_at is null;
  select o.swept_at into cutoff from public.web_pool_items o order by o.swept_at desc offset 100000 limit 1;
  if cutoff is not null then
    delete from public.web_pool_items p where p.swept_at < cutoff and p.batch_id is null and p.filed_at is not null;
  end if;
end;
$$;

-- Past 300 MB of database or 800 MB of files, the sweep sends nothing.
create or replace function public.web_pool_room(p_secret text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  return pg_catalog.pg_database_size(pg_catalog.current_database()) < 300 * 1024 * 1024
    and (select coalesce(sum((o.metadata ->> 'size')::bigint), 0) from storage.objects o where o.bucket_id = 'web-pool') < 800 * 1024 * 1024;
end;
$$;

revoke all on function public.web_pool_shard_add(text, text, integer, text[]) from public, anon, authenticated;
revoke all on function public.web_pool_unfiled(text, integer) from public, anon, authenticated;
revoke all on function public.web_pool_filed(text, text[]) from public, anon, authenticated;
revoke all on function public.web_pool_hot_add(text, jsonb) from public, anon, authenticated;

grant execute on function public.web_pool_shard_add(text, text, integer, text[]) to anon;
grant execute on function public.web_pool_unfiled(text, integer) to anon;
grant execute on function public.web_pool_filed(text, text[]) to anon;
grant execute on function public.web_pool_hot_add(text, jsonb) to anon;
