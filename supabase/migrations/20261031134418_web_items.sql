-- WEB (SPEC-web.md, Phase 2): the stream's two tables. `web_sources` is what WEB reads from (a query, a
-- channel or a feed on one platform); `web_items` is what it found there, one row per remote item.
--
-- Metadata only: there is no column for likes, views, downloads, ratings, followers or comments, and
-- nothing here holds media - an item is links, a hotlinked thumbnail and plain-text words.
--
-- Who may do what:
--   - anyone (signed in or not) may read enabled rows, so /web works for visitors;
--   - nobody may write through the public API. Rows are written only by the ingest route
--     (app/api/web/ingest/route.ts) with the service-role key, which bypasses Row Level Security;
--   - so: RLS on both tables, one select policy each, and select is the only grant anon and
--     authenticated keep (Supabase grants them everything on new public tables by default).
--
-- `media_items`, `forum_threads` and `watch_queue` are not touched: WEB has its own tables.
--
-- Re-runnable: `if not exists`, constraints and policies dropped and recreated by name.

create table if not exists public.web_sources (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  ref text not null,
  label text not null,
  enabled boolean not null default true,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  constraint web_sources_platform_ref_key unique (platform, ref)
);

alter table public.web_sources drop constraint if exists web_sources_platform_format;
alter table public.web_sources add constraint web_sources_platform_format
  check (platform ~ '^[a-z][a-z0-9_]{0,40}$');
alter table public.web_sources drop constraint if exists web_sources_ref_length;
alter table public.web_sources add constraint web_sources_ref_length
  check (char_length(ref) between 1 and 500);
alter table public.web_sources drop constraint if exists web_sources_label_length;
alter table public.web_sources add constraint web_sources_label_length
  check (char_length(label) between 1 and 120);
alter table public.web_sources drop constraint if exists web_sources_last_error_length;
alter table public.web_sources add constraint web_sources_last_error_length
  check (last_error is null or char_length(last_error) <= 300);

create table if not exists public.web_items (
  -- `${platform}:${external_id}`. Collation "C" so ties in the stream order sort byte by byte, exactly
  -- like the JavaScript string comparison the keyset cursor uses (app/lib/web/paging.ts).
  id text collate "C" primary key,
  platform text not null,
  external_id text not null,
  kind text not null,
  url text not null,
  canonical_url text not null,
  title text not null,
  creator text,
  description text,
  thumbnail_url text,
  embed_url text,
  license_url text,
  duration_seconds integer,
  tags text[],
  published_at timestamptz not null,
  fetched_at timestamptz not null,
  -- Off = hidden from /web (a takedown). The ingest never writes this column, so a re-read keeps it off.
  enabled boolean not null default true,
  constraint web_items_platform_external_id_key unique (platform, external_id)
);

alter table public.web_items drop constraint if exists web_items_id_shape;
alter table public.web_items add constraint web_items_id_shape
  check (id = platform || ':' || external_id);
alter table public.web_items drop constraint if exists web_items_platform_format;
alter table public.web_items add constraint web_items_platform_format
  check (platform ~ '^[a-z][a-z0-9_]{0,40}$');
alter table public.web_items drop constraint if exists web_items_external_id_format;
alter table public.web_items add constraint web_items_external_id_format
  check (external_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$');
alter table public.web_items drop constraint if exists web_items_kind_values;
alter table public.web_items add constraint web_items_kind_values
  check (kind in ('audio', 'video', 'image', 'text', 'other'));
alter table public.web_items drop constraint if exists web_items_https_urls;
alter table public.web_items add constraint web_items_https_urls
  check (
    url ~ '^https://'
    and canonical_url ~ '^https://'
    and (thumbnail_url is null or thumbnail_url ~ '^https://')
    and (embed_url is null or embed_url ~ '^https://')
    and (license_url is null or license_url ~ '^https://')
  );
alter table public.web_items drop constraint if exists web_items_url_lengths;
alter table public.web_items add constraint web_items_url_lengths
  check (
    char_length(url) <= 2048
    and char_length(canonical_url) <= 2048
    and (thumbnail_url is null or char_length(thumbnail_url) <= 2048)
    and (embed_url is null or char_length(embed_url) <= 2048)
    and (license_url is null or char_length(license_url) <= 2048)
  );
alter table public.web_items drop constraint if exists web_items_text_lengths;
alter table public.web_items add constraint web_items_text_lengths
  check (
    char_length(title) between 1 and 500
    and (creator is null or char_length(creator) <= 300)
    and (description is null or char_length(description) <= 1000)
  );
alter table public.web_items drop constraint if exists web_items_tags_size;
alter table public.web_items add constraint web_items_tags_size
  check (tags is null or (cardinality(tags) <= 30 and char_length(array_to_string(tags, ' ')) <= 1000));
alter table public.web_items drop constraint if exists web_items_duration_range;
alter table public.web_items add constraint web_items_duration_range
  check (duration_seconds is null or duration_seconds between 0 and 864000);

-- The stream's order: newest first, ties by id. Each page is a range on this index, never an OFFSET.
create index if not exists web_items_stream_idx on public.web_items (published_at desc, id desc);

alter table public.web_sources enable row level security;
alter table public.web_items enable row level security;

drop policy if exists "web sources readable when enabled" on public.web_sources;
create policy "web sources readable when enabled" on public.web_sources
  for select using (enabled);

drop policy if exists "web items readable when enabled" on public.web_items;
create policy "web items readable when enabled" on public.web_items
  for select using (enabled);

-- No insert, update or delete policy exists, so RLS refuses them; the grants say the same thing twice.
revoke all on public.web_sources from anon, authenticated;
revoke all on public.web_items from anon, authenticated;
grant select on public.web_sources to anon, authenticated;
grant select on public.web_items to anon, authenticated;
