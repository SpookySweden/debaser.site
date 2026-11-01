-- WEB: saving opened items (SPEC-web-search.md, "save opened items", Luke's choice 2026-10-31).
--
-- When someone signed in PLAYs, DISCUSSes or WATCHes a result of a search everywhere, the page asks for that
-- item to be saved into the stream. It sends no item data - only which platform and which id - through
-- web_request_add. The hourly ingest (which already holds the Vault lock) reads the pending requests with
-- web_ingest_requests, fetches each item from the platform's own API, saves it through web_ingest_save,
-- and marks the request with web_ingest_request_done.
--
-- What this adds, and nothing else:
--   - the table web_requests: platform + external id, who asked, pending/done/failed, tries, when;
--     Row Level Security on and no policies, so nobody can read it or write it directly;
--   - web_request_add(platform, external_id): signed-in people only; checks both values; at most 50
--     requests per person per day; an item already in the stream or already pending is skipped quietly;
--   - web_ingest_requests / web_ingest_request_done: what the ingest needs, callable with the public key but
--     useless without the lock (the same check as web_ingest_sources).
-- web_items, web_sources, their policies and grants, and the existing ingest functions are unchanged.
-- Re-runnable: `if not exists`, `create or replace`, constraints dropped and re-added by name, grants revoked first.

create table if not exists public.web_requests (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  external_id text not null,
  requested_by uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending',
  tries integer not null default 0,
  created_at timestamptz not null default now(),
  done_at timestamptz
);

alter table public.web_requests drop constraint if exists web_requests_platform_values;
alter table public.web_requests add constraint web_requests_platform_values
  check (platform in ('internet_archive', 'youtube', 'peertube', 'wikimedia_commons', 'openverse', 'vimeo'));
alter table public.web_requests drop constraint if exists web_requests_external_id_format;
alter table public.web_requests add constraint web_requests_external_id_format
  check (external_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$');
alter table public.web_requests drop constraint if exists web_requests_status_values;
alter table public.web_requests add constraint web_requests_status_values
  check (status in ('pending', 'done', 'failed'));
alter table public.web_requests drop constraint if exists web_requests_tries_range;
alter table public.web_requests add constraint web_requests_tries_range
  check (tries between 0 and 10);

-- One pending request per item; the per-person cap reads the second index.
create unique index if not exists web_requests_one_pending on public.web_requests (platform, external_id) where status = 'pending';
create index if not exists web_requests_by_person on public.web_requests (requested_by, created_at);
create index if not exists web_requests_pending_oldest on public.web_requests (created_at) where status = 'pending';

-- Read none, write none: the two functions below are the only way in.
alter table public.web_requests enable row level security;
revoke all on table public.web_requests from public, anon, authenticated;

-- The page's one call. Raises (plainly) only for someone not signed in or a malformed value; a repeat, an item
-- already saved, or a person over the day's cap is skipped without an error the page would have to show.
create or replace function public.web_request_add(p_platform text, p_external_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  if p_platform is null
    or p_platform not in ('internet_archive', 'youtube', 'peertube', 'wikimedia_commons', 'openverse', 'vimeo')
    or p_external_id is null
    or p_external_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$' then
    raise exception 'not an item' using errcode = '22023';
  end if;
  if exists (select 1 from public.web_items w where w.platform = p_platform and w.external_id = p_external_id) then
    return;
  end if;
  if (select count(*) from public.web_requests r where r.requested_by = me and r.created_at > now() - interval '1 day') >= 50 then
    return;
  end if;
  insert into public.web_requests (platform, external_id, requested_by)
  values (p_platform, p_external_id, me)
  on conflict (platform, external_id) where status = 'pending' do nothing;
end;
$$;

revoke all on function public.web_request_add(text, text) from public, anon, authenticated;
grant execute on function public.web_request_add(text, text) to authenticated;

-- The ingest's read: pending requests, oldest first, at most 10. Wrong lock: SQLSTATE 28000, as the others.
create or replace function public.web_ingest_requests(p_secret text, p_limit integer)
returns table (id uuid, platform text, external_id text, tries integer)
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
    select r.id, r.platform, r.external_id, r.tries
    from public.web_requests r
    where r.status = 'pending'
    order by r.created_at asc
    limit least(greatest(coalesce(p_limit, 0), 0), 10);
end;
$$;

-- The ingest's mark: 'done' (saved), 'failed' (the platform has nothing to save), or 'retry' (no answer this
-- time: one more try counted, and failed after the fifth).
create or replace function public.web_ingest_request_done(p_secret text, p_id uuid, p_outcome text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  if p_outcome = 'retry' then
    update public.web_requests
    set tries = tries + 1,
        status = case when tries + 1 >= 5 then 'failed' else 'pending' end,
        done_at = case when tries + 1 >= 5 then now() else null end
    where id = p_id and status = 'pending';
  elsif p_outcome in ('done', 'failed') then
    update public.web_requests
    set status = p_outcome, done_at = now()
    where id = p_id and status = 'pending';
  else
    raise exception 'bad outcome' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.web_ingest_requests(text, integer) from public, anon, authenticated;
revoke all on function public.web_ingest_request_done(text, uuid, text) from public, anon, authenticated;
grant execute on function public.web_ingest_requests(text, integer) to anon;
grant execute on function public.web_ingest_request_done(text, uuid, text) to anon;
