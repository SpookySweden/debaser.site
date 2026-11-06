-- The sweep's ramp (Luke, 2026-11-06: "ramp up the tagging batches massively", the whole $60, far more often, several batches out at once).
--
-- What this adds or changes, and nothing else:
--   - web_sweep_batches: one row per batch the sweep has out or has had: how many items, the worst it could cost, and how far its word counts
--     got. No item, no person, unreadable through the API. While a batch is out, its worst case counts as spent, so what's in flight can't take
--     the total past the limit.
--   - web_sweep_reserve: takes the worst case before a batch is created, all at once, and says no if it would pass the limit it's given.
--   - web_tag_committed: spent plus what the sweep has out. The tagging job and the word pass read this instead of what's spent alone.
--   - web_sweep_claim: one run at a time, so two runs can't read the same place and pay twice.
--   - web_sweep_stats_add: a batch's word counts in numbered parts, each counted once however many times a run is cut short.
--   - web_pool_pending: every batch still out, not just five. web_pool_release: also marks the batch finished, and the row limit goes from 100,000
--     to 350,000 until swept items can also be kept as files (the 300 MB stop still holds).
--   - The jobs: web-sweep every 2 minutes instead of every 3 hours, web-tag every 15 minutes.
--
-- No other table, rule or row is touched. Re-runnable.

create table if not exists public.web_sweep_batches (
  id bigint generated always as identity primary key,
  -- Null only between taking the reservation and the batch being created.
  batch_id text unique,
  items integer not null default 0,
  worst_usd numeric not null default 0,
  stats_part integer not null default 0,
  sent_at timestamptz not null default now(),
  collected_at timestamptz
);

create index if not exists web_sweep_batches_out_idx on public.web_sweep_batches (id) where collected_at is null;

alter table public.web_sweep_batches enable row level security;
revoke all on public.web_sweep_batches from public, anon, authenticated;

-- One run at a time. The claim runs out by itself, so a run the host cuts off can't stop the job for good.
create or replace function public.web_sweep_claim(p_secret text, p_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_s bigint := extract(epoch from now())::bigint;
  taken text;
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  insert into public.web_sweep_state as s (source, state)
    values ('#run', jsonb_build_object('until', now_s + p_seconds))
  on conflict (source) do update
    set state = excluded.state, updated_at = now()
    where coalesce((s.state ->> 'until')::bigint, 0) <= now_s
  returning s.source into taken;
  return taken is not null;
end;
$$;

create or replace function public.web_sweep_unclaim(p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  update public.web_sweep_state set state = jsonb_build_object('until', 0), updated_at = now() where source = '#run';
end;
$$;

-- Spent, plus the worst that everything the sweep has out could still cost.
create or replace function public.web_tag_committed(p_secret text)
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
  return (select coalesce(sum(s.usd), 0) from public.web_tag_spend s)
       + (select coalesce(sum(b.worst_usd), 0) from public.web_sweep_batches b where b.collected_at is null);
end;
$$;

-- Takes the worst case before a batch exists. Null: it would pass the limit, and nothing is taken.
create or replace function public.web_sweep_reserve(p_secret text, p_items integer, p_worst numeric, p_limit numeric)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  made bigint;
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('web_sweep_reserve'));
  if public.web_tag_committed(p_secret) + p_worst > p_limit then
    return null;
  end if;
  insert into public.web_sweep_batches (items, worst_usd) values (p_items, p_worst) returning id into made;
  return made;
end;
$$;

create or replace function public.web_sweep_reserved(p_secret text, p_id bigint, p_batch text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  update public.web_sweep_batches set batch_id = p_batch, sent_at = now() where id = p_id;
end;
$$;

-- Only for a batch Claude's API refused outright, so nothing can have been paid for.
create or replace function public.web_sweep_unreserve(p_secret text, p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  delete from public.web_sweep_batches where id = p_id and batch_id is null;
end;
$$;

-- Every batch still out, oldest first, and any sent before this table existed.
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
  return query
    select b.batch_id from public.web_sweep_batches b where b.collected_at is null and b.batch_id is not null order by b.id;
  return query
    select distinct p.batch_id from public.web_pool_items p
    where p.batch_id is not null
      and not exists (select 1 from public.web_sweep_batches b where b.batch_id = p.batch_id)
    limit 5;
end;
$$;

create or replace function public.web_sweep_stats_place(p_secret text, p_batch text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  return coalesce((select b.stats_part from public.web_sweep_batches b where b.batch_id = p_batch), 0);
end;
$$;

-- One numbered part of a batch's word counts. A part that isn't the next one does nothing, so nothing is counted twice.
create or replace function public.web_sweep_stats_add(p_secret text, p_batch text, p_part integer, p_stats jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  place integer;
  held integer;
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  insert into public.web_sweep_batches (batch_id) values (p_batch) on conflict (batch_id) do nothing;
  select b.stats_part into place from public.web_sweep_batches b where b.batch_id = p_batch for update;
  if place <> p_part then
    return;
  end if;

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

  update public.web_sweep_batches set stats_part = p_part + 1 where batch_id = p_batch;
end;
$$;

-- What a finished batch left without words stops being out, its worst case stops counting (what it really cost is in web_tag_spend by now), and
-- past 350,000 rows the oldest go, from this table only, and only once counted.
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
  select o.swept_at into cutoff from public.web_pool_items o order by o.swept_at desc offset 350000 limit 1;
  if cutoff is not null then
    delete from public.web_pool_items p where p.swept_at < cutoff and p.batch_id is null;
  end if;
end;
$$;

revoke all on function public.web_sweep_claim(text, integer) from public, anon, authenticated;
revoke all on function public.web_sweep_unclaim(text) from public, anon, authenticated;
revoke all on function public.web_tag_committed(text) from public, anon, authenticated;
revoke all on function public.web_sweep_reserve(text, integer, numeric, numeric) from public, anon, authenticated;
revoke all on function public.web_sweep_reserved(text, bigint, text) from public, anon, authenticated;
revoke all on function public.web_sweep_unreserve(text, bigint) from public, anon, authenticated;
revoke all on function public.web_sweep_stats_place(text, text) from public, anon, authenticated;
revoke all on function public.web_sweep_stats_add(text, text, integer, jsonb) from public, anon, authenticated;

grant execute on function public.web_sweep_claim(text, integer) to anon;
grant execute on function public.web_sweep_unclaim(text) to anon;
grant execute on function public.web_tag_committed(text) to anon;
grant execute on function public.web_sweep_reserve(text, integer, numeric, numeric) to anon;
grant execute on function public.web_sweep_reserved(text, bigint, text) to anon;
grant execute on function public.web_sweep_unreserve(text, bigint) to anon;
grant execute on function public.web_sweep_stats_place(text, text) to anon;
grant execute on function public.web_sweep_stats_add(text, text, integer, jsonb) to anon;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'web-sweep') then
    perform cron.unschedule('web-sweep');
  end if;
  if exists (select 1 from cron.job where jobname = 'web-tag') then
    perform cron.unschedule('web-tag');
  end if;
end;
$$;

-- Every 2 minutes. A run still going when the next is due just says so and stops (web_sweep_claim). The lock is read from Vault at call time.
select cron.schedule(
  'web-sweep',
  '*/2 * * * *',
  $job$
  select net.http_post(
    url := 'https://debaser-site.vercel.app/api/web/sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-web-ingest-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'web_ingest_secret' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 235000
  );
  $job$
);

-- Every 15 minutes, so the word pass keeps up with the words the sweep brings. Each of its jobs still has one batch out at a time.
select cron.schedule(
  'web-tag',
  '11,26,41,56 * * * *',
  $job$
  select net.http_post(
    url := 'https://debaser-site.vercel.app/api/web/tag',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-web-ingest-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'web_ingest_secret' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
