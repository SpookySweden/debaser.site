-- WEB media servers: film series (TMDB collections) as one row (Luke's OK 2026-11-01).
--
-- What this adds, and nothing else:
--   - web_media_titles.collection_id: the TMDB collection a film belongs to, copied by the database out of the
--     details the hourly update saves (`details.collection.id`), so the site can read a collection's films together;
--     and an index for that read.
--   - web_media_save_details now also writes collection_id (same lock check, same 40-row cap as before).
--   - Films already holding TMDB details are marked to be asked again on the next update (details_checked_at
--     cleared), so their collection arrives at once rather than within 30 days. The same kind of write the hourly
--     update makes; nothing is deleted.
-- Row Level Security, policies and grants are unchanged (signed-in people read, nobody writes through the API).
-- Re-runnable: `if not exists`, constraint dropped and re-added by name, `create or replace`.

alter table public.web_media_titles add column if not exists collection_id integer;

alter table public.web_media_titles drop constraint if exists web_media_titles_collection;
alter table public.web_media_titles add constraint web_media_titles_collection check (collection_id is null or collection_id between 1 and 999999999);

create index if not exists web_media_titles_collection_idx on public.web_media_titles (collection_id) where collection_id is not null;

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
      collection_id = case
        when jsonb_typeof(r.details) = 'object' and jsonb_typeof(r.details -> 'collection' -> 'id') = 'number'
          and (r.details -> 'collection' ->> 'id') ~ '^[1-9][0-9]{0,8}$'
          then (r.details -> 'collection' ->> 'id')::integer
        when jsonb_typeof(r.details) = 'object' then null
        else t.collection_id
      end,
      details_checked_at = now()
  from jsonb_to_recordset(p_rows) as r(id text, details jsonb)
  where t.id = r.id;
  get diagnostics saved = row_count;
  return saved;
end;
$$;

revoke all on function public.web_media_save_details(text, jsonb) from public, anon, authenticated;
grant execute on function public.web_media_save_details(text, jsonb) to anon;

-- Ask TMDB again, once, for films that already have details but no collection yet.
update public.web_media_titles
set details_checked_at = null
where media_type = 'movie' and tmdb_id is not null and details is not null and collection_id is null;
