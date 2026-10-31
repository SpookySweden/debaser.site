-- BARR (SPEC-vanity.md step 2): a personal mark on a song. Nobody else sees it.
--
-- One row per (account, file). The file is its address (`src`), not the shelf id a like uses: a barred
-- song has to be caught on every way music reaches the player - the archive, a playlist, a post's MP3,
-- someone's profile song, a broadcast being followed, a stream room - and the address is the one key
-- the same file keeps on all of them (`music_tracks.src` is unique for the same reason).
--
-- Re-runnable: `if not exists` on the table and index, policies dropped and recreated by name.

create table if not exists public.music_barrs (
  user_id uuid not null references auth.users (id) on delete cascade,
  track_src text not null,
  barred_at timestamptz not null default now(),
  primary key (user_id, track_src),
  constraint music_barrs_src_length check (char_length(track_src) between 1 and 2048)
);

alter table public.music_barrs enable row level security;

-- Readable, addable and removable by its owner only: a bar is never shown to anybody else.
drop policy if exists "barrs readable by owner" on public.music_barrs;
create policy "barrs readable by owner" on public.music_barrs
  for select using (auth.uid() = user_id);

drop policy if exists "barrs writable by owner" on public.music_barrs;
create policy "barrs writable by owner" on public.music_barrs
  for insert with check (auth.uid() = user_id);

drop policy if exists "barrs removable by owner" on public.music_barrs;
create policy "barrs removable by owner" on public.music_barrs
  for delete using (auth.uid() = user_id);

create index if not exists music_barrs_user_idx on public.music_barrs (user_id, barred_at desc);
