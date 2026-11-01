-- WEB media servers (SPEC-media-servers.md; Luke's OK for these tables 2026-11-01).
--
-- Titles found on Luke's own and his friends' media servers, read from each server's list file by the hourly
-- WEB update, and which server holds which title (and, for a show, which episodes). Metadata only: no video,
-- no rating, vote count or popularity, ever.
--
-- What this adds, and nothing else:
--   - web_media_titles: one row per title (a film, a show, or a server's own video), keyed `media:<key>`:
--     TMDB's number when the list gives one (so one film on two servers is one row), else server + its own id.
--     TMDB's details (title, date, overview, poster file, runtime, genres, seasons) sit in `details`.
--   - web_media_copies: one row per server holding a title, with that server's episodes for a show.
--   - Row Level Security on both: readable by signed-in people only (`authenticated`), never by a visitor
--     (`anon`), and writable by nobody through the API.
--   - Four functions for the hourly update, callable with the public key but useless without the WEB ingest
--     lock (supabase/migrations/20261031190000_web_ingest_lock.sql): save a batch of one server's titles, finish
--     that server's run (drop what its list no longer has), list titles waiting for TMDB's details, save them.
-- web_items, web_sources, their policies and the existing functions are unchanged.
-- Re-runnable: `if not exists`, `create or replace`, policies dropped and recreated by name, grants revoked first.

create table if not exists public.web_media_titles (
  id text collate "C" primary key,
  media_type text not null,
  tmdb_id integer,
  title text not null,
  creator text,
  description text,
  thumbnail_url text,
  duration_seconds integer,
  released_at text,
  details jsonb,
  details_checked_at timestamptz,
  -- When the title first appeared on a server: its place in the stream. Never changed by a later run.
  -- Milliseconds only: the page's cursor carries milliseconds (paging.ts), and a microsecond left over would make
  -- the next page's `published_at = cursor` read miss the rest of a batch saved in the same instant.
  published_at timestamptz not null default date_trunc('milliseconds', now()),
  fetched_at timestamptz not null default date_trunc('milliseconds', now())
);

alter table public.web_media_titles drop constraint if exists web_media_titles_id_shape;
alter table public.web_media_titles add constraint web_media_titles_id_shape check (id ~ '^media:[A-Za-z0-9][A-Za-z0-9._-]{0,199}$');
alter table public.web_media_titles drop constraint if exists web_media_titles_type;
alter table public.web_media_titles add constraint web_media_titles_type check (media_type in ('movie', 'tv', 'other'));
alter table public.web_media_titles drop constraint if exists web_media_titles_tmdb;
alter table public.web_media_titles add constraint web_media_titles_tmdb check (tmdb_id is null or tmdb_id between 1 and 999999999);
alter table public.web_media_titles drop constraint if exists web_media_titles_text;
alter table public.web_media_titles add constraint web_media_titles_text check (
  char_length(title) between 1 and 300
  and (creator is null or char_length(creator) <= 200)
  and (description is null or char_length(description) <= 1000)
  and (released_at is null or char_length(released_at) <= 40)
);
alter table public.web_media_titles drop constraint if exists web_media_titles_thumb;
alter table public.web_media_titles add constraint web_media_titles_thumb check (
  thumbnail_url is null or (thumbnail_url like 'https://%' and char_length(thumbnail_url) <= 600)
);
alter table public.web_media_titles drop constraint if exists web_media_titles_duration;
alter table public.web_media_titles add constraint web_media_titles_duration check (duration_seconds is null or duration_seconds between 1 and 360000);
alter table public.web_media_titles drop constraint if exists web_media_titles_details;
alter table public.web_media_titles add constraint web_media_titles_details check (
  details is null or (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 20000)
);

create index if not exists web_media_titles_stream_idx on public.web_media_titles (published_at desc, id desc);
create index if not exists web_media_titles_details_idx on public.web_media_titles (details_checked_at nulls first) where tmdb_id is not null;

create table if not exists public.web_media_copies (
  title_id text collate "C" not null references public.web_media_titles (id) on delete cascade,
  server text not null,
  local_id text,
  episodes jsonb,
  -- The run that last saw this copy in the server's list (web_media_finish drops older ones).
  seen_at timestamptz not null default now(),
  primary key (title_id, server)
);

alter table public.web_media_copies drop constraint if exists web_media_copies_server;
alter table public.web_media_copies add constraint web_media_copies_server check (server ~ '^[a-z][a-z0-9_]{0,40}$');
alter table public.web_media_copies drop constraint if exists web_media_copies_local_id;
alter table public.web_media_copies add constraint web_media_copies_local_id check (local_id is null or local_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$');
alter table public.web_media_copies drop constraint if exists web_media_copies_episodes;
alter table public.web_media_copies add constraint web_media_copies_episodes check (
  episodes is null or (jsonb_typeof(episodes) = 'array' and octet_length(episodes::text) <= 200000)
);

create index if not exists web_media_copies_server_idx on public.web_media_copies (server, seen_at);

alter table public.web_media_titles enable row level security;
alter table public.web_media_copies enable row level security;

drop policy if exists "web media titles readable when signed in" on public.web_media_titles;
create policy "web media titles readable when signed in" on public.web_media_titles
  for select to authenticated using (true);

drop policy if exists "web media copies readable when signed in" on public.web_media_copies;
create policy "web media copies readable when signed in" on public.web_media_copies
  for select to authenticated using (true);

-- No insert, update or delete policy exists, so RLS refuses them; the grants say the same thing twice.
revoke all on public.web_media_titles from anon, authenticated;
revoke all on public.web_media_copies from anon, authenticated;
grant select on public.web_media_titles to authenticated;
grant select on public.web_media_copies to authenticated;

-- One batch of one server's titles (at most 500): the titles inserted or updated (a new title's first-seen time
-- is kept for good), and this server's copies stamped with the run. TMDB's details are never written here.
create or replace function public.web_media_save(p_secret text, p_server text, p_run timestamptz, p_titles jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved integer;
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  if p_server !~ '^[a-z][a-z0-9_]{0,40}$' or p_run is null
    or jsonb_typeof(p_titles) is distinct from 'array' or jsonb_array_length(p_titles) > 500 then
    raise exception 'bad batch' using errcode = '22023';
  end if;

  insert into public.web_media_titles as t (id, media_type, tmdb_id, title, creator, description, thumbnail_url, duration_seconds, released_at, published_at, fetched_at)
  select r.id, r.media_type, r.tmdb_id, r.title, r.creator, r.description, r.thumbnail_url, r.duration_seconds, r.released_at,
    date_trunc('milliseconds', p_run), date_trunc('milliseconds', p_run)
  from jsonb_to_recordset(p_titles) as r(
    id text, media_type text, tmdb_id integer, title text, creator text, description text,
    thumbnail_url text, duration_seconds integer, released_at text
  )
  on conflict (id) do update set
    media_type = excluded.media_type,
    tmdb_id = excluded.tmdb_id,
    title = excluded.title,
    creator = excluded.creator,
    description = excluded.description,
    thumbnail_url = excluded.thumbnail_url,
    duration_seconds = excluded.duration_seconds,
    released_at = excluded.released_at,
    fetched_at = excluded.fetched_at;

  insert into public.web_media_copies as c (title_id, server, local_id, episodes, seen_at)
  select r.id, p_server, r.local_id, r.episodes, p_run
  from jsonb_to_recordset(p_titles) as r(id text, local_id text, episodes jsonb)
  on conflict (title_id, server) do update set
    local_id = excluded.local_id,
    episodes = excluded.episodes,
    seen_at = excluded.seen_at;

  get diagnostics saved = row_count;
  return saved;
end;
$$;

-- A server's run is complete: its copies the run did not see are gone from its list, so they go; a title no
-- server holds any more goes with its last copy. Only called after the whole list was read and saved, so a
-- server that did not answer keeps what it had.
create or replace function public.web_media_finish(p_secret text, p_server text, p_run timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  dropped integer;
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  if p_server !~ '^[a-z][a-z0-9_]{0,40}$' or p_run is null then
    raise exception 'bad run' using errcode = '22023';
  end if;
  delete from public.web_media_copies where server = p_server and seen_at < p_run;
  get diagnostics dropped = row_count;
  delete from public.web_media_titles t where not exists (select 1 from public.web_media_copies c where c.title_id = t.id);
  return dropped;
end;
$$;

-- Titles with a TMDB number whose details were never asked for, or not for 30 days: at most 40 a run.
create or replace function public.web_media_needing_details(p_secret text, p_limit integer)
returns table (id text, media_type text, tmdb_id integer)
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
    select t.id, t.media_type, t.tmdb_id
    from public.web_media_titles t
    where t.tmdb_id is not null
      and t.media_type in ('movie', 'tv')
      and (t.details_checked_at is null or t.details_checked_at < now() - interval '30 days')
    order by t.details_checked_at asc nulls first, t.id
    limit least(greatest(coalesce(p_limit, 0), 0), 40);
end;
$$;

-- TMDB's answers: `details` an object (or null when TMDB does not know the number: the list's words stay).
-- Either way the title is marked as asked, so it is not asked again for 30 days.
create or replace function public.web_media_save_details(p_secret text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved integer;
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 40 then
    raise exception 'bad batch' using errcode = '22023';
  end if;
  update public.web_media_titles t
  set details = case when jsonb_typeof(r.details) = 'object' then r.details else t.details end,
      details_checked_at = now()
  from jsonb_to_recordset(p_rows) as r(id text, details jsonb)
  where t.id = r.id;
  get diagnostics saved = row_count;
  return saved;
end;
$$;

revoke all on function public.web_media_save(text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.web_media_finish(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.web_media_needing_details(text, integer) from public, anon, authenticated;
revoke all on function public.web_media_save_details(text, jsonb) from public, anon, authenticated;
-- The ingest route calls them with the public key (as `anon`); without the lock each refuses (28000).
grant execute on function public.web_media_save(text, text, timestamptz, jsonb) to anon;
grant execute on function public.web_media_finish(text, text, timestamptz) to anon;
grant execute on function public.web_media_needing_details(text, integer) to anon;
grant execute on function public.web_media_save_details(text, jsonb) to anon;
