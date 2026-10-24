-- -----------------------------------------------------------------------------
-- The media catalogue (SPEC-media-catalogue.md, 2026-10-24)
-- -----------------------------------------------------------------------------
-- Run with `npm run db:push`. Idempotent: `if not exists` throughout, buckets upserted, every policy
-- dropped and re-created by name. It changes no existing row and touches no existing table.
--
-- One record per file the site holds - pictures, music, video - with a fingerprint of the file's bytes
-- (`sha256`, unique: the same file uploaded twice is the same row) and, for a picture, a fingerprint of
-- how it looks (`phash`, so a resized copy can be spotted and the original recommended). `media_uses`
-- says where each file appears on the site, one row per place, so the catalogue page can list them.
--
-- The `mp3` and `avatars` buckets stay as they are; two more hold what had nowhere to go: pictures
-- attached to posts (`images`) and video (`video`). Limits mirror the constants in
-- app/lib/media/rules.ts, so the browser refuses an oversized file with a plain sentence first.

-- 1. The buckets ---------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('images', 'images', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('video', 'video', true, 26214400, array['video/mp4', 'video/webm'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The same four policies the avatars bucket has: anybody reads, an account files into its own
-- folder, and only the owner or the admin takes a file down.
drop policy if exists "images readable" on storage.objects;
create policy "images readable" on storage.objects
  for select using (bucket_id = 'images');

drop policy if exists "images filed by owner" on storage.objects;
create policy "images filed by owner" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "images removed by owner or admin" on storage.objects;
create policy "images removed by owner or admin" on storage.objects
  for delete to authenticated
  using (bucket_id = 'images' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

drop policy if exists "video readable" on storage.objects;
create policy "video readable" on storage.objects
  for select using (bucket_id = 'video');

drop policy if exists "video filed by owner" on storage.objects;
create policy "video filed by owner" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'video' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "video removed by owner or admin" on storage.objects;
create policy "video removed by owner or admin" on storage.objects
  for delete to authenticated
  using (bucket_id = 'video' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- 2. The catalogue ---------------------------------------------------------------

create table if not exists public.media_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('image', 'audio', 'video')),
  -- Where the bytes are: a bucket and a path in it, or '' / the site path for a file that ships
  -- with the project (a concept sheet).
  bucket text not null default '',
  path text not null default '',
  -- The public address, which is what every reader of the file points at.
  src text not null unique,
  -- The fingerprint of the bytes. Unique: the same file is the same row, however many times it is sent.
  sha256 text not null unique,
  -- How a picture looks, as a 64-bit difference hash in hex; null for sound and video.
  phash text,
  bytes bigint not null default 0,
  mime text not null default '',
  width integer,
  height integer,
  -- Running time as it reads in a list (`5:12`), sound and video only.
  length text not null default '',
  title text not null,
  credit text not null default '',
  tags jsonb not null default '[]'::jsonb,
  -- The archive folder a track is filed in (`HEXHAM/GRIDLOCK`), audio only.
  folder_path text,
  -- How it got here: uploaded through the site, a concept sheet from the manifest, or brought in
  -- by the one-off migration of what existed before the catalogue.
  source text not null default 'upload' check (source in ('upload', 'sheet', 'migrated')),
  uploaded_by uuid references auth.users (id) on delete set null,
  uploaded_by_label text not null default 'Unknown',
  created_at timestamptz not null default now(),
  -- A file is only ever one of the site's own: a path under assets/, or a public object in this
  -- project's storage. A row pointing anywhere else is refused, so nobody can file a foreign address
  -- that "ALREADY IN THE CATALOGUE" would then hand to whoever uploads the same bytes.
  constraint media_items_src_is_ours check (src like '/assets/%' or src like 'https://%.supabase.co/storage/v1/object/public/%'),
  constraint media_items_title_length check (char_length(title) between 1 and 200),
  constraint media_items_credit_length check (char_length(credit) <= 120)
);

create index if not exists media_items_kind_created_idx on public.media_items (kind, created_at desc);
create index if not exists media_items_phash_idx on public.media_items (phash) where phash is not null;

alter table public.media_items enable row level security;

drop policy if exists "media items readable" on public.media_items;
create policy "media items readable" on public.media_items for select using (true);

-- From the site, only an upload: the sheet and migrated sources are the migration's to write.
drop policy if exists "media items filed by uploader" on public.media_items;
create policy "media items filed by uploader" on public.media_items
  for insert to authenticated
  with check (not public.is_banned() and uploaded_by = auth.uid() and source = 'upload');

drop policy if exists "media items edited by uploader or admin" on public.media_items;
create policy "media items edited by uploader or admin" on public.media_items
  for update to authenticated
  using (uploaded_by = auth.uid() or public.is_admin())
  with check (uploaded_by = auth.uid() or public.is_admin());

drop policy if exists "media items removed by uploader or admin" on public.media_items;
create policy "media items removed by uploader or admin" on public.media_items
  for delete to authenticated
  using (uploaded_by = auth.uid() or public.is_admin());

-- 3. Where each file is used ------------------------------------------------------

create table if not exists public.media_uses (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null references public.media_items (id) on delete cascade,
  -- What kind of place: a post, a reply, a profile's picture or song, a concept sheet's frame, a lore page.
  use_kind text not null check (use_kind in ('post', 'reply', 'profile_picture', 'profile_song', 'sheet', 'lore_page')),
  -- The id of that place in its own table, so the same place is never listed twice.
  use_id text not null,
  -- Where a reader goes to see it, and what the link is called.
  href text not null,
  label text not null,
  added_by uuid references auth.users (id) on delete set null,
  used_at timestamptz not null default now(),
  unique (media_id, use_kind, use_id),
  -- A use links somewhere on this site, by a relative path, and its words are short: the catalogue
  -- page draws every one as a link, so a row is never allowed to carry an outside address.
  constraint media_uses_href_is_a_site_path check (href ~ '^/[^/]' and char_length(href) <= 300),
  constraint media_uses_label_length check (char_length(label) between 1 and 200),
  constraint media_uses_use_id_length check (char_length(use_id) between 1 and 200)
);

create index if not exists media_uses_media_idx on public.media_uses (media_id, used_at desc);

alter table public.media_uses enable row level security;

drop policy if exists "media uses readable" on public.media_uses;
create policy "media uses readable" on public.media_uses for select using (true);

-- Signed-in accounts only, in their own name: a guest's post with a catalogued picture records
-- no use from the site (the migration script rebuilds every use from the posts themselves), which
-- is the price of not letting an anonymous visitor write links under every file on the page.
drop policy if exists "media uses filed by anybody not banned" on public.media_uses;
drop policy if exists "media uses filed by an account" on public.media_uses;
create policy "media uses filed by an account" on public.media_uses
  for insert to authenticated
  with check (not public.is_banned() and added_by = auth.uid());

drop policy if exists "media uses removed by their filer or admin" on public.media_uses;
create policy "media uses removed by their filer or admin" on public.media_uses
  for delete to authenticated
  using (added_by = auth.uid() or public.is_admin());

-- 4. Live changes ------------------------------------------------------------------
-- The browser keeps its list fresh through realtime (app/lib/media/catalogue.ts subscribes to both
-- tables), and a table is only broadcast once it is in the publication. Added by name, only if it is
-- not there yet, so the file can be run again.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'media_items') then
    alter publication supabase_realtime add table public.media_items;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'media_uses') then
    alter publication supabase_realtime add table public.media_uses;
  end if;
end $$;

-- Afterwards, to see it landed:
--   select id, public, file_size_limit from storage.buckets where id in ('images', 'video');
--   select count(*) from public.media_items;
--   select tablename, policyname from pg_policies where tablename in ('media_items', 'media_uses') order by 1, 2;
