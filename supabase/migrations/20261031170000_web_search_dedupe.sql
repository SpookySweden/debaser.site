-- WEB (SPEC-web.md, Phase 4): search and cross-platform dedupe on `web_items`. Runs AFTER
-- 20261031134418_web_items.sql (it alters that table).
--
-- Adds two columns, two indexes, one constraint and one small helper function. Nothing is deleted,
-- no row is changed by hand, and Row Level Security, the select policy and the select-only grants on
-- `web_items` stay exactly as they are (new columns are covered by the same table grant).
--
--   - `search_tsv`: the words of the title, creator, tags and description, kept up to date by Postgres
--     itself (a generated column). 'simple' configuration: no stemming, no stop words, any language.
--     /web's search is a plainto_tsquery against it (app/lib/web/search.ts), passed as a parameter.
--   - `dedupe_key`: a fingerprint of the title and creator (app/lib/web/dedupe.ts), written by the
--     ingest, so a page can fetch the other copies of the same work. It never hides or removes a row:
--     /web shows one row per work and lists the other copies on it as ALSO ON.
--
-- Re-runnable: `if not exists`, `create or replace`, and the constraint dropped and recreated by name.

-- `array_to_string` is only "stable" in Postgres, which a generated column refuses; this wrapper is
-- immutable in fact (it reads nothing but its argument). Empty search_path: it can call nothing else.
create or replace function public.web_tags_text(tags text[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$ select coalesce(pg_catalog.array_to_string(tags, ' '), '') $$;

-- Not callable through the public API (it is plumbing). The table owner and the service role, which
-- write rows and so compute the generated column, keep it.
revoke all on function public.web_tags_text(text[]) from public, anon, authenticated;
grant execute on function public.web_tags_text(text[]) to service_role;

alter table public.web_items add column if not exists search_tsv tsvector
  generated always as (
    to_tsvector('simple'::regconfig, coalesce(title, ''))
    || to_tsvector('simple'::regconfig, coalesce(creator, ''))
    || to_tsvector('simple'::regconfig, public.web_tags_text(tags))
    || to_tsvector('simple'::regconfig, coalesce(description, ''))
  ) stored;

create index if not exists web_items_search_idx on public.web_items using gin (search_tsv);

alter table public.web_items add column if not exists dedupe_key text;

-- Exactly what dedupe.ts writes (`DEDUPE_KEY_SHAPE`), or nothing.
alter table public.web_items drop constraint if exists web_items_dedupe_key_shape;
alter table public.web_items add constraint web_items_dedupe_key_shape
  check (dedupe_key is null or dedupe_key ~ '^tc1:[0-9a-f]{14}$');

create index if not exists web_items_dedupe_idx on public.web_items (dedupe_key) where dedupe_key is not null;
