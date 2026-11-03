-- -----------------------------------------------------------------------------
-- The language a saved /web item is in, as its platform said it (Luke, 2026-11-03)
-- -----------------------------------------------------------------------------
-- Idempotent: running it twice changes nothing the second time, and nothing here drops a row.
--
-- Why: a /web row wears a flag for its language (app/lib/web/language.ts). Search results carry the
-- platform's own word (the Internet Archive's `language`, PeerTube's `language.id`), but a row saved into
-- the stream kept only its title, so the same video could wear a flag in search and none in the stream.
-- Luke asked for the saved rows to keep it ("go ahead and fix that", 2026-11-03).
--
-- What is stored is a short code (`es`, `pt-BR`) the site worked out from the platform's metadata: never
-- words a person typed, never anything about engagement. Empty (null) means the platform did not say,
-- and the row reads its title instead, exactly as every row does today.

alter table public.web_items
  add column if not exists language text;

-- The shape of every tag `normaliseLanguage` makes: two or three lowercase letters, maybe a region.
alter table public.web_items drop constraint if exists web_items_language_shape;
alter table public.web_items add constraint web_items_language_shape
  check (language is null or language ~ '^[a-z]{2,3}(-[A-Z]{2})?$');

-- The ingest's one writer, as in 20261031190000_web_ingest_lock.sql, with `language` saved too. A batch
-- from code that does not send it yet saves null, so the order the migration and the code land in does
-- not matter for writing.
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
    embed_url, license_url, duration_seconds, tags, published_at, fetched_at, dedupe_key, language
  )
  select
    r.id, r.platform, r.external_id, r.kind, r.url, r.canonical_url, r.title, r.creator, r.description,
    r.thumbnail_url, r.embed_url, r.license_url, r.duration_seconds, r.tags, r.published_at, r.fetched_at,
    r.dedupe_key, r.language
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
    dedupe_key = excluded.dedupe_key,
    language = excluded.language;

  get diagnostics saved = row_count;
  return saved;
end;
$$;

-- `create or replace` keeps the function's grants (20261031190000: execute for anon only, behind the
-- secret), so none are touched here: a revoke without the matching grant would stop the ingest.

-- No new policy: the column sits on a table whose read policy already says who sees a row (signed-in
-- people, SPEC-web.md), and only the ingest's locked functions write it.
