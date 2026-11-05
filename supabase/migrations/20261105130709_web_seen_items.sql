-- Tagging what anyone sees in MEDIA (SPEC-tag-station.md; Luke's OK 2026-11-05, "tables and live", naming these three tables and
-- a $60 limit). Search results that are never saved get Claude's words too, kept apart from the MEDIA stream.
--
-- What this adds, and nothing else. No existing table, rule or function is altered and no row is changed or deleted:
--   - web_seen_items: one row per result anyone's search returned: which platform and id, then its type, title, creator and date
--     once the job has read them from the platform's own API, and Claude's words. No search words, and no record of who saw it.
--     Signed-in people can read the names and words; nobody can write through the API.
--   - web_seen_caps: how many results one person's searches named today, and nothing about which. Unreadable through the API.
--   - web_tag_spend: tokens and dollars per batch, which is what stops the job at $60. Unreadable through the API; the job reads
--     the total through its lock, and signed-in people can ask only whether the limit has been reached.
--   - web_seen_add: the one way in. Signed-in people only; names only, so no one can feed text into a paid batch; at most 500
--     a person a day and 5,000 new results for the whole site a day.
--   - web_seen_* and web_tag_spend_*: what /api/web/tag needs, callable with the public key but useless without the lock, like
--     the web_tag_* functions (20261104120000_web_item_tags.sql). Wrong lock: SQLSTATE 28000.
--
-- Re-runnable: `if not exists`, `create or replace`, policy dropped and recreated by name, grants revoked before given.

create table if not exists public.web_seen_items (
  -- `${platform}:${external_id}`, the same id a WEB item has.
  id text collate "C" primary key,
  platform text not null,
  external_id text not null,
  -- Read from the platform by the job, just before the batch goes out. The description goes to Claude and is never kept.
  kind text,
  title text,
  creator text,
  published_at timestamptz,
  words text[] not null default '{}',
  -- Times the platform had nothing to say about it; stops at 3.
  read_tries integer not null default 0,
  -- The Message Batch this item is out in, if any.
  batch_id text,
  -- Batches that came back without usable words; stops at 3.
  tries integer not null default 0,
  seen_at timestamptz not null default now(),
  tagged_at timestamptz
);

create index if not exists web_seen_items_batch_idx on public.web_seen_items (batch_id) where batch_id is not null;
create index if not exists web_seen_items_seen_idx on public.web_seen_items (seen_at);
create index if not exists web_seen_items_waiting_idx on public.web_seen_items (seen_at) where batch_id is null and cardinality(words) = 0;

alter table public.web_seen_items enable row level security;

drop policy if exists "seen items readable by the signed in" on public.web_seen_items;
create policy "seen items readable by the signed in" on public.web_seen_items
  for select to authenticated using (true);

revoke all on public.web_seen_items from public, anon, authenticated;
grant select (id, platform, kind, title, creator, published_at, words) on public.web_seen_items to authenticated;

create table if not exists public.web_seen_caps (
  person uuid not null references auth.users (id) on delete cascade,
  day date not null,
  named integer not null default 0,
  primary key (person, day)
);

alter table public.web_seen_caps enable row level security;
revoke all on public.web_seen_caps from public, anon, authenticated;

create table if not exists public.web_tag_spend (
  batch_id text primary key,
  input_tokens bigint not null,
  output_tokens bigint not null,
  usd numeric(12, 6) not null,
  recorded_at timestamptz not null default now()
);

alter table public.web_tag_spend enable row level security;
revoke all on public.web_tag_spend from public, anon, authenticated;

-- The search route's one call, with the reader's session. Raises only for someone not signed in. A person over the day's cap, the
-- site over its cap, a malformed name or a repeat is skipped quietly: being seen is never worth a visible error.
create or replace function public.web_seen_add(p_platform text, p_external_ids text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  used integer;
  room integer;
  site_room integer;
  wanted text[];
begin
  if me is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  if p_platform is null or p_platform not in ('internet_archive', 'youtube', 'peertube', 'wikimedia_commons', 'openverse', 'vimeo', 'kino') then
    return;
  end if;
  select coalesce(array_agg(distinct e), '{}') into wanted
    from unnest(coalesce(p_external_ids, '{}')) e
    where e ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$';
  if cardinality(wanted) = 0 then
    return;
  end if;

  select coalesce((select c.named from public.web_seen_caps c where c.person = me and c.day = current_date), 0) into used;
  select count(*) into site_room from public.web_seen_items s where s.seen_at >= current_date;
  room := least(500 - used, 5000 - site_room, cardinality(wanted), 100);
  if room <= 0 then
    return;
  end if;

  insert into public.web_seen_items (id, platform, external_id)
    select p_platform || ':' || e, p_platform, e
    from unnest(wanted[1:room]) e
    where not exists (select 1 from public.web_items w where w.platform = p_platform and w.external_id = e)
  on conflict (id) do nothing;

  insert into public.web_seen_caps (person, day, named) values (me, current_date, room)
    on conflict (person, day) do update set named = public.web_seen_caps.named + excluded.named;
  -- Only today's count is ever needed.
  delete from public.web_seen_caps c where c.person = me and c.day < current_date;
end;
$$;

-- The job's list of what to read next, oldest first. An item saved into the stream since is left to the stream's own tagging.
create or replace function public.web_seen_waiting(p_secret text, p_limit integer)
returns table (id text, platform text, external_id text)
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
    select s.id::text, s.platform, s.external_id
    from public.web_seen_items s
    where s.batch_id is null
      and cardinality(s.words) = 0
      and s.tries < 3
      and s.read_tries < 3
      and not exists (select 1 from public.web_items w where w.platform = s.platform and w.external_id = s.external_id)
    order by s.seen_at, s.id
    limit least(greatest(coalesce(p_limit, 0), 0), 500);
end;
$$;

-- The platform had nothing to say about these.
create or replace function public.web_seen_unreadable(p_secret text, p_ids text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  update public.web_seen_items s set read_tries = s.read_tries + 1 where s.id = any (p_ids);
end;
$$;

-- These went out in a batch, with what the platform said about them.
create or replace function public.web_seen_sent(p_secret text, p_batch text, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  update public.web_seen_items s
    set batch_id = p_batch,
        kind = r.value ->> 'kind',
        title = left(r.value ->> 'title', 600),
        creator = left(r.value ->> 'creator', 200),
        published_at = (r.value ->> 'publishedAt')::timestamptz
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where s.id = r.value ->> 'id';
end;
$$;

create or replace function public.web_seen_pending(p_secret text)
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
  return query select distinct s.batch_id from public.web_seen_items s where s.batch_id is not null limit 5;
end;
$$;

create or replace function public.web_seen_out(p_secret text, p_batch text)
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
  return query select s.id::text from public.web_seen_items s where s.batch_id = p_batch limit 1000;
end;
$$;

create or replace function public.web_seen_save(p_secret text, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  update public.web_seen_items s
    set words = array(select jsonb_array_elements_text(r.value -> 'words')),
        batch_id = null,
        tagged_at = now()
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where s.id = r.value ->> 'id';
end;
$$;

-- What a finished batch left without words goes back in the queue, one try down.
create or replace function public.web_seen_release(p_secret text, p_batch text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  update public.web_seen_items s set batch_id = null, tries = s.tries + 1 where s.batch_id = p_batch;
end;
$$;

-- What a batch cost. A batch is only ever counted once.
create or replace function public.web_tag_spend_add(p_secret text, p_batch text, p_input bigint, p_output bigint, p_usd numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  insert into public.web_tag_spend (batch_id, input_tokens, output_tokens, usd)
    values (p_batch, p_input, p_output, p_usd)
  on conflict (batch_id) do nothing;
end;
$$;

create or replace function public.web_tag_spent(p_secret text)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  return (select coalesce(sum(t.usd), 0) from public.web_tag_spend t);
end;
$$;

-- All a signed-in reader can learn about the spending: whether the limit has stopped the tagging.
create or replace function public.web_tag_limit_reached()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(t.usd), 0) >= 60 from public.web_tag_spend t;
$$;

revoke all on function public.web_seen_add(text, text[]) from public, anon, authenticated;
revoke all on function public.web_seen_waiting(text, integer) from public, anon, authenticated;
revoke all on function public.web_seen_unreadable(text, text[]) from public, anon, authenticated;
revoke all on function public.web_seen_sent(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.web_seen_pending(text) from public, anon, authenticated;
revoke all on function public.web_seen_out(text, text) from public, anon, authenticated;
revoke all on function public.web_seen_save(text, jsonb) from public, anon, authenticated;
revoke all on function public.web_seen_release(text, text) from public, anon, authenticated;
revoke all on function public.web_tag_spend_add(text, text, bigint, bigint, numeric) from public, anon, authenticated;
revoke all on function public.web_tag_spent(text) from public, anon, authenticated;
revoke all on function public.web_tag_limit_reached() from public, anon, authenticated;

grant execute on function public.web_seen_add(text, text[]) to authenticated;
grant execute on function public.web_tag_limit_reached() to authenticated;
grant execute on function public.web_seen_waiting(text, integer) to anon;
grant execute on function public.web_seen_unreadable(text, text[]) to anon;
grant execute on function public.web_seen_sent(text, text, jsonb) to anon;
grant execute on function public.web_seen_pending(text) to anon;
grant execute on function public.web_seen_out(text, text) to anon;
grant execute on function public.web_seen_save(text, jsonb) to anon;
grant execute on function public.web_seen_release(text, text) to anon;
grant execute on function public.web_tag_spend_add(text, text, bigint, bigint, numeric) to anon;
grant execute on function public.web_tag_spent(text) to anon;
