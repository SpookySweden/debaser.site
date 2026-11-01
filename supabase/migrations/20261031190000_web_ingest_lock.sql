-- WEB ingest lock (SPEC-web.md; replaces the service-role key on Vercel, Luke's OK 2026-10-31).
--
-- The ingest route on Vercel no longer holds any server key. It uses the public key and these three
-- functions, which run as their owner (SECURITY DEFINER) and each refuse to do anything unless the caller
-- passes the lock: a random secret the database makes for itself, below, and keeps in Supabase Vault.
-- Nobody ever sees it - not Luke, not Claude, not a file, not the migration history. The hourly pg_cron job
-- reads it from Vault and sends it in the request header; the route hands it straight back here.
--
-- What this adds, and nothing else:
--   - pg_net (the scheduler's HTTP client; the schedule itself is a later migration);
--   - the Vault secret `web_ingest_secret`, made only if it is not there yet;
--   - web_ingest_lock_ok(): the comparison, callable by no API role;
--   - web_ingest_sources / web_ingest_save / web_ingest_record: what the route needs, callable with the
--     public key but useless without the lock.
-- Row Level Security, policies and the select-only grants on web_sources / web_items are unchanged.
-- Re-runnable: `if not exists`, `create or replace`, grants revoked before they are given.

create extension if not exists pg_net with schema extensions;
-- Supabase's setup hands the API roles pg_net's HTTP functions when the extension is created. Only the
-- scheduler (running as postgres) needs them, so we try to take them back. On hosted Supabase those grants
-- belong to supabase_admin, so these two lines change nothing there (checked live 2026-10-31); what keeps
-- visitors away is that `net` is not an API schema (PostgREST answers PGRST106: only public and
-- graphql_public are exposed). Never add `net` to the exposed schemas.
revoke execute on all functions in schema net from anon, authenticated;
revoke usage on schema net from anon, authenticated;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'web_ingest_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'web_ingest_secret', 'WEB ingest lock');
  end if;
end;
$$;

-- Digests of equal length, so neither the lock's length nor its content shows in timing. A missing Vault
-- secret or a short guess is simply false.
create or replace function public.web_ingest_lock_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(length(p_secret) >= 32, false)
    and exists (
      select 1
      from vault.decrypted_secrets s
      where s.name = 'web_ingest_secret'
        and extensions.digest(s.decrypted_secret, 'sha256') = extensions.digest(p_secret, 'sha256')
    );
$$;

revoke all on function public.web_ingest_lock_ok(text) from public, anon, authenticated;

-- Wrong lock: SQLSTATE 28000 (invalid authorization), which the route turns into a plain 401.
create or replace function public.web_ingest_sources(p_secret text, p_limit integer)
returns table (id uuid, platform text, ref text, label text, enabled boolean, last_checked_at timestamptz, last_error text)
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
    select s.id, s.platform, s.ref, s.label, s.enabled, s.last_checked_at, s.last_error
    from public.web_sources s
    where s.enabled
    order by s.last_checked_at asc nulls first
    limit least(greatest(coalesce(p_limit, 0), 0), 5);
end;
$$;

-- Insert or update on (platform, external_id). Never writes `enabled`, so an item taken down stays down.
-- The table's own CHECK constraints still judge every value; a batch is at most 100 rows.
create or replace function public.web_ingest_save(p_secret text, p_rows jsonb)
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
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 100 then
    raise exception 'bad batch' using errcode = '22023';
  end if;

  insert into public.web_items as w (
    id, platform, external_id, kind, url, canonical_url, title, creator, description, thumbnail_url,
    embed_url, license_url, duration_seconds, tags, published_at, fetched_at, dedupe_key
  )
  select
    r.id, r.platform, r.external_id, r.kind, r.url, r.canonical_url, r.title, r.creator, r.description,
    r.thumbnail_url, r.embed_url, r.license_url, r.duration_seconds, r.tags, r.published_at, r.fetched_at,
    r.dedupe_key
  from jsonb_populate_recordset(null::public.web_items, p_rows) r
  on conflict (platform, external_id) do update set
    kind = excluded.kind,
    url = excluded.url,
    canonical_url = excluded.canonical_url,
    title = excluded.title,
    creator = excluded.creator,
    description = excluded.description,
    thumbnail_url = excluded.thumbnail_url,
    embed_url = excluded.embed_url,
    license_url = excluded.license_url,
    duration_seconds = excluded.duration_seconds,
    tags = excluded.tags,
    published_at = excluded.published_at,
    fetched_at = excluded.fetched_at,
    dedupe_key = excluded.dedupe_key;

  get diagnostics saved = row_count;
  return saved;
end;
$$;

create or replace function public.web_ingest_record(p_secret text, p_source_id uuid, p_checked_at timestamptz, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  update public.web_sources
  set last_checked_at = p_checked_at, last_error = left(p_error, 300)
  where id = p_source_id;
end;
$$;

revoke all on function public.web_ingest_sources(text, integer) from public, anon, authenticated;
revoke all on function public.web_ingest_save(text, jsonb) from public, anon, authenticated;
revoke all on function public.web_ingest_record(text, uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.web_ingest_sources(text, integer) to anon;
grant execute on function public.web_ingest_save(text, jsonb) to anon;
grant execute on function public.web_ingest_record(text, uuid, timestamptz, text) to anon;
