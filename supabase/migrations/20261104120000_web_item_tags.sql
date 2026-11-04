-- MEDIA's picks (SPEC-media-picks.md; Luke's OK 2026-11-04): Claude's words for each saved item, which only ever order a
-- list (app/lib/web/recommend.ts). Nothing existing is altered or deleted.
--
-- What this adds, and nothing else:
--   - web_item_tags: one row per item. Signed-in people may read an item's words; nobody can write through the API.
--   - web_tag_*: what /api/web/tag needs, callable with the public key but useless without the lock, like web_ingest_*
--     (20261031190000_web_ingest_lock.sql). Wrong lock: SQLSTATE 28000, which the route turns into a plain 401.
--   - the job: every three hours pg_cron asks pg_net to POST to the route. It costs nothing while there is nothing new,
--     and until ANTHROPIC_API_KEY is set in Vercel the route does nothing.
--
-- Re-runnable: `if not exists`, `create or replace`, policy dropped and recreated by name, grants revoked before given,
-- and the job unscheduled by name before it is scheduled.

create table if not exists public.web_item_tags (
  item_id text collate "C" primary key references public.web_items (id) on delete cascade,
  words text[] not null default '{}',
  -- The Message Batch this item is out in, if any.
  batch_id text,
  -- Batches that came back without usable words; stops at 3, so one item cannot be paid for for ever.
  tries integer not null default 0,
  tagged_at timestamptz
);

create index if not exists web_item_tags_batch_idx on public.web_item_tags (batch_id) where batch_id is not null;

alter table public.web_item_tags enable row level security;

drop policy if exists "item words readable by the signed in" on public.web_item_tags;
create policy "item words readable by the signed in" on public.web_item_tags
  for select to authenticated using (true);

revoke all on public.web_item_tags from public, anon, authenticated;
grant select (item_id, words) on public.web_item_tags to authenticated;

create or replace function public.web_tag_untagged(p_secret text, p_limit integer)
returns table (id text, kind text, title text, creator text, description text, tags text[])
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
    select i.id::text, i.kind, i.title, i.creator, i.description, i.tags
    from public.web_items i
    left join public.web_item_tags t on t.item_id = i.id
    where i.enabled
      and (t.item_id is null or (t.batch_id is null and cardinality(t.words) = 0 and t.tries < 3))
    order by i.published_at desc nulls last, i.id
    limit least(greatest(coalesce(p_limit, 0), 0), 500);
end;
$$;

create or replace function public.web_tag_pending(p_secret text)
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
  return query select distinct t.batch_id from public.web_item_tags t where t.batch_id is not null limit 5;
end;
$$;

create or replace function public.web_tag_sent(p_secret text, p_batch text, p_ids text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  insert into public.web_item_tags (item_id, batch_id)
    select i.id, p_batch from public.web_items i where i.id = any (p_ids)
  on conflict (item_id) do update set batch_id = excluded.batch_id;
end;
$$;

create or replace function public.web_tag_save(p_secret text, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  update public.web_item_tags t
    set words = array(select jsonb_array_elements_text(r.value -> 'words')),
        batch_id = null,
        tagged_at = now()
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where t.item_id = r.value ->> 'id';
end;
$$;

-- What a finished batch left without words goes back in the queue, one try down.
create or replace function public.web_tag_release(p_secret text, p_batch text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  update public.web_item_tags t set batch_id = null, tries = t.tries + 1 where t.batch_id = p_batch;
end;
$$;

revoke all on function public.web_tag_untagged(text, integer) from public, anon, authenticated;
revoke all on function public.web_tag_pending(text) from public, anon, authenticated;
revoke all on function public.web_tag_sent(text, text, text[]) from public, anon, authenticated;
revoke all on function public.web_tag_save(text, jsonb) from public, anon, authenticated;
revoke all on function public.web_tag_release(text, text) from public, anon, authenticated;
grant execute on function public.web_tag_untagged(text, integer) to anon;
grant execute on function public.web_tag_pending(text) to anon;
grant execute on function public.web_tag_sent(text, text, text[]) to anon;
grant execute on function public.web_tag_save(text, jsonb) to anon;
grant execute on function public.web_tag_release(text, text) to anon;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'web-tag') then
    perform cron.unschedule('web-tag');
  end if;
end;
$$;

-- Minute 41, away from the ingest at minute 17. The lock is read from Vault at call time, so it is in no file.
select cron.schedule(
  'web-tag',
  '41 */3 * * *',
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
