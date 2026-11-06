-- The catalogue sweep (SPEC-discover.md; Luke's OKs 2026-11-05: the tables, $50 for the sweep, named collections, the TMDB number column).
-- Open catalogues are read through their public APIs, tagged by Claude through the Message Batches API, and counted. Most swept items are
-- then dropped: what stays is a word's count and its closest words, and the newest 100,000 items that can be offered to people.
--
-- What this adds, and nothing else:
--   - web_pool_items: swept items. Which source and id, type, title, creator, date, Claude's words, and for a film or show the TMDB number
--     Wikidata lists (a number from Wikidata, no TMDB text, so a KINO row can be matched later). No description, no counts, no person.
--     Signed-in people can read tagged rows; nobody can write through the API. Past 100,000 rows the job removes the oldest, from this table only.
--   - web_word_stats: for each word, how many swept items carried it and its top 100 partner words. At most 50,000 words, plus one row,
--     '#total', holding how many items have been counted. Signed-in people can read it; nobody can write through the API.
--   - web_sweep_state: where each source got to. Unreadable through the API.
--   - web_pool_* and web_sweep_*: what /api/web/sweep needs, callable with the public key but useless without the lock, like the web_tag_*
--     functions. Wrong lock: SQLSTATE 28000. web_pool_room says no once the database passes 300 MB, and the job then sends nothing.
--   - web_word_waiting and web_word_vocabulary (20261105135926_web_word_facts.sql) also read words in web_word_stats that are on at least 3 items.
--   - the job: every three hours pg_cron asks pg_net to POST to the route, at minute 11, away from the ingest at 17 and the tagging at 41.
--
-- No other table, rule or row is touched. Re-runnable: `if not exists`, `create or replace`, constraint and policy dropped and recreated by
-- name, grants revoked before given, and the job unscheduled by name before it is scheduled.

create table if not exists public.web_pool_items (
  -- `${platform}:${external_id}`.
  id text collate "C" primary key,
  platform text not null,
  external_id text not null,
  -- A PeerTube item's instance, which its addresses are built from.
  host text,
  kind text not null,
  title text not null,
  creator text,
  published_at timestamptz,
  -- For a film or show: the TMDB number Wikidata lists (P4947, P4983), as `movie:123` or `tv:123`. Only a number; no TMDB text.
  tmdb_ref text,
  words text[] not null default '{}',
  -- The Message Batch this item is out in, if any.
  batch_id text,
  swept_at timestamptz not null default now(),
  tagged_at timestamptz
);

alter table public.web_pool_items drop constraint if exists web_pool_items_platform_values;
alter table public.web_pool_items add constraint web_pool_items_platform_values
  check (platform in ('internet_archive', 'peertube', 'openverse', 'wikidata', 'tvmaze'));
alter table public.web_pool_items drop constraint if exists web_pool_items_kind_values;
alter table public.web_pool_items add constraint web_pool_items_kind_values
  check (kind in ('audio', 'video', 'image', 'text', 'other'));
alter table public.web_pool_items drop constraint if exists web_pool_items_sizes;
alter table public.web_pool_items add constraint web_pool_items_sizes
  check (char_length(id) <= 260 and char_length(title) <= 600 and char_length(coalesce(creator, '')) <= 200 and char_length(coalesce(host, '')) <= 200 and char_length(coalesce(tmdb_ref, '')) <= 40);

create index if not exists web_pool_items_batch_idx on public.web_pool_items (batch_id) where batch_id is not null;
create index if not exists web_pool_items_swept_idx on public.web_pool_items (swept_at);
create index if not exists web_pool_items_tmdb_idx on public.web_pool_items (tmdb_ref) where tmdb_ref is not null;

alter table public.web_pool_items enable row level security;

drop policy if exists "tagged pool items readable by the signed in" on public.web_pool_items;
create policy "tagged pool items readable by the signed in" on public.web_pool_items
  for select to authenticated using (cardinality(words) > 0);

revoke all on public.web_pool_items from public, anon, authenticated;
grant select (id, platform, external_id, host, kind, title, creator, published_at, tmdb_ref, words) on public.web_pool_items to authenticated;

create table if not exists public.web_word_stats (
  word text collate "C" primary key,
  items integer not null default 0,
  partners jsonb not null default '{}'::jsonb
);

alter table public.web_word_stats drop constraint if exists web_word_stats_word_size;
alter table public.web_word_stats add constraint web_word_stats_word_size check (char_length(word) between 1 and 60);

alter table public.web_word_stats enable row level security;

drop policy if exists "word stats readable by the signed in" on public.web_word_stats;
create policy "word stats readable by the signed in" on public.web_word_stats
  for select to authenticated using (true);

revoke all on public.web_word_stats from public, anon, authenticated;
grant select (word, items, partners) on public.web_word_stats to authenticated;

create table if not exists public.web_sweep_state (
  source text collate "C" primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.web_sweep_state enable row level security;
revoke all on public.web_sweep_state from public, anon, authenticated;

-- Whether there's room: the sweep sends nothing past 300 MB, because other features need the space too.
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
  return pg_catalog.pg_database_size(pg_catalog.current_database()) < 300 * 1024 * 1024;
end;
$$;

create or replace function public.web_sweep_state_read(p_secret text)
returns table (source text, state jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  return query select s.source::text, s.state from public.web_sweep_state s limit 50;
end;
$$;

create or replace function public.web_sweep_state_write(p_secret text, p_source text, p_state jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  insert into public.web_sweep_state (source, state) values (p_source, coalesce(p_state, '{}'::jsonb))
  on conflict (source) do update set state = excluded.state, updated_at = now();
end;
$$;

-- Of these ids, the ones the site doesn't hold yet, so nothing is paid for twice.
create or replace function public.web_pool_unknown(p_secret text, p_ids text[])
returns setof text
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
    select i from unnest(p_ids) i
    where not exists (select 1 from public.web_pool_items p where p.id = i)
      and not exists (select 1 from public.web_items w where w.id = i);
end;
$$;

-- These went out in a batch: the row is what an offered item needs, with no description.
create or replace function public.web_pool_sent(p_secret text, p_batch text, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  insert into public.web_pool_items (id, platform, external_id, host, kind, title, creator, published_at, tmdb_ref, batch_id)
    select r.value ->> 'id', r.value ->> 'platform', r.value ->> 'externalId', r.value ->> 'host', r.value ->> 'kind',
           left(r.value ->> 'title', 600), left(r.value ->> 'creator', 200), (r.value ->> 'publishedAt')::timestamptz, r.value ->> 'tmdbRef', p_batch
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  on conflict (id) do nothing;
end;
$$;

create or replace function public.web_pool_pending(p_secret text)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  return query select distinct p.batch_id from public.web_pool_items p where p.batch_id is not null limit 5;
end;
$$;

create or replace function public.web_pool_out(p_secret text, p_batch text)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  return query select p.id::text from public.web_pool_items p where p.batch_id = p_batch limit 6000;
end;
$$;

-- One chunk of a finished batch, all at once or not at all, so nothing is counted twice: these items' words and the word counts together.
-- The job only sends rows still out, and a chunk is small, so it stays inside the API's short statement time.
create or replace function public.web_pool_collect(p_secret text, p_batch text, p_rows jsonb, p_stats jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  held integer;
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;

  update public.web_pool_items p
    set words = array(select jsonb_array_elements_text(r.value -> 'words')),
        batch_id = null,
        tagged_at = now()
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where p.id = r.value ->> 'id' and p.batch_id = p_batch;

  -- Existing words always count. A new word only comes in while there's room for it.
  select count(*) into held from public.web_word_stats;
  insert into public.web_word_stats as s (word, items, partners)
    select r.value ->> 'word', (r.value ->> 'items')::integer, coalesce(r.value -> 'partners', '{}'::jsonb)
    from jsonb_array_elements(coalesce(p_stats, '[]'::jsonb)) r
    where held < 50000 or r.value ->> 'word' = '#total' or exists (select 1 from public.web_word_stats e where e.word = r.value ->> 'word')
  on conflict (word) do update
    set items = s.items + excluded.items,
        partners = (
          select coalesce(jsonb_object_agg(t.k, t.v), '{}'::jsonb)
          from (
            select m.k, sum(m.v)::integer as v
            from (
              select o.key as k, o.value::integer as v from jsonb_each_text(s.partners) o
              union all
              select n.key, n.value::integer from jsonb_each_text(excluded.partners) n
            ) m
            group by m.k
            order by v desc, m.k
            limit 100
          ) t
        );
end;
$$;

-- What a finished batch left without words stops being out. Past 100,000 rows the oldest go, from this table only, and only once counted.
create or replace function public.web_pool_release(p_secret text, p_batch text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  update public.web_pool_items p set batch_id = null where p.batch_id = p_batch;
  delete from public.web_pool_items p
    where p.id in (
      select o.id from public.web_pool_items o
      where o.batch_id is null
      order by o.swept_at desc, o.id
      offset 100000
    );
end;
$$;

-- The word pass also sorts words the sweep has counted on at least 3 items. Rarer ones aren't worth paying for yet.
create or replace function public.web_word_waiting(p_secret text, p_limit integer)
returns setof text
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
    select u.word
    from (
      select distinct lower(w) as word from public.web_item_tags t, unnest(t.words) w
      union
      select distinct lower(w) from public.web_seen_items s, unnest(s.words) w
      union
      select distinct lower(w) from public.web_items i, unnest(i.tags) w where i.enabled
      union
      select distinct lower(st.word) from public.web_word_stats st where st.items >= 3 and st.word <> '#total'
    ) u
    left join public.web_word_facts f on f.word = u.word
    where char_length(u.word) between 1 and 60
      and (f.word is null or (f.facet is null and f.batch_id is null and f.tries < 3))
    order by u.word
    limit least(greatest(coalesce(p_limit, 0), 0), 1000);
end;
$$;

create or replace function public.web_word_vocabulary(p_secret text, p_limit integer)
returns setof text
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
    select u.word
    from (
      select lower(w) as word, 1 as n from public.web_item_tags t, unnest(t.words) w
      union all
      select lower(w), 1 from public.web_seen_items s, unnest(s.words) w
      union all
      select lower(w), 1 from public.web_items i, unnest(i.tags) w where i.enabled
      union all
      select lower(st.word), st.items from public.web_word_stats st where st.items >= 3 and st.word <> '#total'
    ) u
    where char_length(u.word) between 1 and 60
    group by u.word
    order by sum(u.n) desc, u.word
    limit least(greatest(coalesce(p_limit, 0), 0), 2000);
end;
$$;

revoke all on function public.web_pool_room(text) from public, anon, authenticated;
revoke all on function public.web_sweep_state_read(text) from public, anon, authenticated;
revoke all on function public.web_sweep_state_write(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.web_pool_unknown(text, text[]) from public, anon, authenticated;
revoke all on function public.web_pool_sent(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.web_pool_pending(text) from public, anon, authenticated;
revoke all on function public.web_pool_out(text, text) from public, anon, authenticated;
revoke all on function public.web_pool_collect(text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.web_pool_release(text, text) from public, anon, authenticated;

grant execute on function public.web_pool_room(text) to anon;
grant execute on function public.web_sweep_state_read(text) to anon;
grant execute on function public.web_sweep_state_write(text, text, jsonb) to anon;
grant execute on function public.web_pool_unknown(text, text[]) to anon;
grant execute on function public.web_pool_sent(text, text, jsonb) to anon;
grant execute on function public.web_pool_pending(text) to anon;
grant execute on function public.web_pool_out(text, text) to anon;
grant execute on function public.web_pool_collect(text, text, jsonb, jsonb) to anon;
grant execute on function public.web_pool_release(text, text) to anon;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'web-sweep') then
    perform cron.unschedule('web-sweep');
  end if;
end;
$$;

-- Minute 11, away from the ingest at 17 and the tagging at 41. The lock is read from Vault at call time, so it is in no file.
select cron.schedule(
  'web-sweep',
  '11 */3 * * *',
  $job$
  select net.http_post(
    url := 'https://debaser-site.vercel.app/api/web/sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-web-ingest-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'web_ingest_secret' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
