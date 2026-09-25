-- ---------------------------------------------------------------------------
-- The music shelf and the track beside a picture
-- ---------------------------------------------------------------------------
-- Run this in the Supabase SQL editor (Dashboard -> SQL Editor -> New query) on a
-- project that has the site's schema but not the music tables yet. It is sections 14
-- and 15 of supabase/schema.sql as a file you can paste on its own, it only adds what
-- is missing, and it is safe to re-run.
--
-- What it creates:
--   mp3 bucket               a public bucket for tracks: the music shelf's uploads,
--                            an account's own song, and anything dropped in by hand
--   music_tracks             title, credit and kind for a file in that bucket
--   profile_song_versions    the append-only history behind an account's one track
--   profiles.current_song_version_id, profiles.show_song_comments
--   profile_comments.song_version_id, and 'song' added to its kind check
--
-- The bucket holds files under `<user id>/...`, and every write policy reads that first
-- folder, which is what keeps one account out of another account's folder - the same
-- rule the avatars bucket keeps.

-- 1. The bucket -----------------------------------------------------------------
-- 20MB and the audio types mirror MAX_TRACK_BYTES and the list in
-- app/lib/audio/catalogue.ts, so the browser refuses an oversized track with a plain
-- message and the bucket only ever sees a file the site has already accepted.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mp3', 'mp3', true, 20971520, array['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/flac'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "mp3 readable" on storage.objects;
create policy "mp3 readable" on storage.objects
  for select using (bucket_id = 'mp3');

drop policy if exists "mp3 filed by owner" on storage.objects;
create policy "mp3 filed by owner" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'mp3' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "mp3 replaced by owner" on storage.objects;
create policy "mp3 replaced by owner" on storage.objects
  for update to authenticated
  using (bucket_id = 'mp3' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'mp3' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "mp3 removed by owner or admin" on storage.objects;
create policy "mp3 removed by owner or admin" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'mp3'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );


-- 2. What the shelf has been told about those files -----------------------------
-- The bucket is what the player reads, so a file dropped in by hand plays without a
-- row here; this table is what gives a file its title and its credit, and it is what
-- the music page's upload writes.

create table if not exists public.music_tracks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  credit text not null default '',
  kind text not null default 'UPLOADED TO THE SHELF',
  -- The public URL, which is what a row and a bucket listing are matched on.
  src text not null unique,
  length text not null default '',
  uploaded_by uuid references auth.users (id) on delete set null,
  uploaded_by_label text not null default 'Unknown',
  created_at timestamptz not null default now()
);

create index if not exists music_tracks_created_idx on public.music_tracks (created_at desc);

alter table public.music_tracks enable row level security;

drop policy if exists "music tracks readable" on public.music_tracks;
create policy "music tracks readable" on public.music_tracks for select using (true);

drop policy if exists "music tracks filed by uploader" on public.music_tracks;
create policy "music tracks filed by uploader" on public.music_tracks
  for insert with check (
    not public.is_banned()
    and (uploaded_by is null or uploaded_by = auth.uid())
  );

drop policy if exists "music tracks removed by uploader or admin" on public.music_tracks;
create policy "music tracks removed by uploader or admin" on public.music_tracks
  for delete using (uploaded_by = auth.uid() or public.is_admin());

-- 3. The track beside a picture -------------------------------------------------
-- One track per account, with the same append-only history the drawings keep: filing
-- a new one adds a version, and restoring an old one files a version that copies it -
-- so a comment about a mix always keeps pointing at that mix.

alter table public.profiles add column if not exists show_song_comments boolean not null default true;
-- Deliberately not a foreign key, for the same reason `current_version_id` is not: the
-- versions table already points at the profile, and a circular pair would make deletes
-- awkward.
alter table public.profiles add column if not exists current_song_version_id uuid;

create table if not exists public.profile_song_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  version integer not null,
  src text not null,
  title text not null default '',
  credit text not null default '',
  note text not null default '',
  restored_from_version integer,
  created_at timestamptz not null default now(),
  unique (user_id, version)
);

alter table public.profile_song_versions enable row level security;

drop policy if exists "song versions readable" on public.profile_song_versions;
create policy "song versions readable" on public.profile_song_versions for select using (true);

drop policy if exists "song versions insert own" on public.profile_song_versions;
create policy "song versions insert own" on public.profile_song_versions
  for insert with check (not public.is_banned() and auth.uid() = user_id);

-- No update policy: a filed track is never rewritten, which is the point of the
-- history. Deleting the account takes the rows with it.


-- 4. Comments, the third kind ---------------------------------------------------
-- One comments table for all three surfaces (the profile, the picture, the track), so
-- the reading rules stay in one place. `song_version_id` is the track's answer to
-- `avatar_version_id`.

alter table public.profile_comments
  add column if not exists song_version_id uuid references public.profile_song_versions (id) on delete set null;

alter table public.profile_comments drop constraint if exists profile_comments_kind_check;
alter table public.profile_comments add constraint profile_comments_kind_check
  check (kind in ('profile', 'avatar', 'song'));

drop policy if exists "profile comments readable" on public.profile_comments;
create policy "profile comments readable" on public.profile_comments
  for select using (
    user_id = auth.uid()
    or author_id = auth.uid()
    or (kind = 'profile' and exists (
      select 1 from public.profiles p where p.id = user_id and p.show_profile_comments
    ))
    or (kind = 'avatar' and exists (
      select 1 from public.profiles p where p.id = user_id and p.show_avatar_comments
    ))
    or (kind = 'song' and exists (
      select 1 from public.profiles p where p.id = user_id and p.show_song_comments
    ))
  );

-- 5. Check it landed ------------------------------------------------------------
--
--   select id, public, file_size_limit from storage.buckets where id = 'mp3';
--
--   select column_name, data_type from information_schema.columns
--     where table_schema = 'public' and table_name = 'profile_song_versions'
--     order by ordinal_position;
--
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'public.profile_comments'::regclass and contype = 'c';
--
-- Note: nothing subscribes to `music_tracks` or `profile_song_versions` over realtime -
-- filing a song also updates `profiles`, which the profile channel already watches, and
-- that is what makes the track appear on an open page. Bind a table to a channel only
-- after adding it to the `supabase_realtime` publication: a channel bound to an
-- unpublished table hears nothing at all (see supabase/README.md, Realtime).
