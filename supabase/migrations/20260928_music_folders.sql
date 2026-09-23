-- -----------------------------------------------------------------------------
-- 21. The archive's folders: /music as a file browser anybody signed in can file into.
-- -----------------------------------------------------------------------------
-- Run this whole file in the Supabase SQL Editor on a project that has already had
-- `supabase/schema.sql` run against it. Re-running it is safe: the table is `if not exists`, the
-- column is `if not exists`, the index is guarded by name, and every policy is dropped and
-- re-created by name.
--
-- A folder's whole path is its key - `HEXHAM`, `HEXHAM/GRIDLOCK` - rather than a name with a
-- parent to look up, because a path is what the browser prints, what a file is filed under, and
-- what the archive's own catalogue already implies for the releases it ships. Two people filing
-- into `HEXHAM` are asking for the same folder, which is why the path is the primary key and the
-- store's insert ignores a duplicate instead of failing.
--
-- A file's place is `music_tracks.folder_path`, a plain string with **no foreign key on
-- purpose**: a directory is real while something is in it, so a path may exist because a file
-- mentions it, and removing a folder row never takes anybody's files with it - they simply show
-- up in a folder that its own contents imply.
--
-- Until this is run, /music still works: the browser lists the catalogue's own releases (their
-- folders are read off the files, not off this table) and the folder table is reported as
-- unreadable in the console, so nobody can make a new folder or file into one they made.

-- 1. The folders, and who may make them.

create table if not exists public.music_folders (
  path text primary key,
  created_by uuid references auth.users (id) on delete set null,
  created_by_label text not null default 'Unknown',
  created_at timestamptz not null default now()
);

alter table public.music_folders enable row level security;

drop policy if exists "music folders readable" on public.music_folders;
create policy "music folders readable" on public.music_folders for select using (true);

drop policy if exists "music folders made by any account" on public.music_folders;
create policy "music folders made by any account" on public.music_folders
  for insert to authenticated with check (not public.is_banned() and auth.uid() = created_by);

drop policy if exists "music folders removed by their maker or admin" on public.music_folders;
create policy "music folders removed by their maker or admin" on public.music_folders
  for delete to authenticated using (auth.uid() = created_by or public.is_admin());

-- 2. Where a file is filed.

alter table public.music_tracks add column if not exists folder_path text;

create index if not exists music_tracks_folder_idx on public.music_tracks (folder_path);

-- 3. Check it landed.

--   select column_name, data_type from information_schema.columns
--     where table_schema = 'public' and table_name = 'music_tracks' and column_name = 'folder_path';
--   select policyname, cmd, roles from pg_policies where tablename = 'music_folders' order by policyname;
--   select path, created_by_label, created_at from public.music_folders order by path;
