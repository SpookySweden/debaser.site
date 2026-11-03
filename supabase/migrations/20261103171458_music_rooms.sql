-- -----------------------------------------------------------------------------
-- Music rooms: a music broadcast is a stream room whose queue takes songs (SPEC-music-queues.md, 2026-11-03)
-- -----------------------------------------------------------------------------
-- Pushed 2026-11-03 with Luke's typed OK (applied through the Supabase connector: the CLI refused a history it
-- could not match locally). Re-runnable: columns and the table are added if missing, every constraint,
-- policy, trigger and function is dropped and re-created by name. Nothing is deleted and no existing row
-- changes meaning: every room there now reads origin = 'stream', public, never cleared.
--
-- 1. A room has an origin: 'stream' (GO LIVE on a video, as before) or 'music' (somebody's music, opened
--    by GO PUBLIC). One music room per person, kept for good: it is never ended, its host never changes,
--    and nobody closes it for being quiet. `is_public` is its GO PUBLIC switch; a stream room is always
--    public. `cleared_at` is STORE AND START BLANK: plays from before it are hidden from the queue window.
-- 2. A queue row can be a song: source_kind 'audio', its address (the music bar's own: a site path
--    such as /assets/audio/... or /api/web/audio/..., or the mp3 bucket's https address) and its title.
-- 3. Nobody but the host adds to, or chats in, a music room while it is not public.
-- 4. `music_song_notes`: the cover card's picture and words for a site song, one row per song, written
--    by the song's uploader (the first folder of its mp3 bucket path is their account), read by anybody.
--    The picture itself goes in the existing `images` bucket under the uploader's own folder, whose
--    rules already allow exactly that.
--
-- The old broadcast table, `music_queues`, is left as it is: the site stops writing and reading it.

-- 1. Rooms ---------------------------------------------------------------------------------

alter table public.watch_rooms add column if not exists origin text not null default 'stream';
alter table public.watch_rooms add column if not exists is_public boolean not null default true;
alter table public.watch_rooms add column if not exists cleared_at timestamptz;

alter table public.watch_rooms drop constraint if exists watch_rooms_origin;
alter table public.watch_rooms add constraint watch_rooms_origin check (origin in ('stream', 'music'));

-- A stream room is public; only a music room switches.
alter table public.watch_rooms drop constraint if exists watch_rooms_stream_public;
alter table public.watch_rooms add constraint watch_rooms_stream_public check (origin = 'music' or is_public);

create unique index if not exists watch_rooms_one_music_room on public.watch_rooms (original_host_id) where origin = 'music';
create index if not exists watch_rooms_public_music_idx on public.watch_rooms (updated_at desc) where origin = 'music' and is_public;

-- The fields a host may not rewrite. A music room keeps its origin, its host and is never ended.
create or replace function public.watch_rooms_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.id := old.id;
  new.original_host_id := old.original_host_id;
  new.original_host_label := old.original_host_label;
  new.started_at := old.started_at;
  new.origin := old.origin;
  if old.forum_thread_id is not null then
    new.forum_thread_id := old.forum_thread_id;
  end if;
  if old.ended_at is not null then
    new.ended_at := old.ended_at;
  end if;
  if old.origin = 'music' then
    new.host_id := old.host_id;
    new.ended_at := null;
  else
    new.is_public := true;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- A take-over never happens in a music room: it is its owner's.
create or replace function public.watch_take_over(room uuid, gone_host uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  taken integer;
begin
  if auth.uid() is null or public.is_banned() then
    return false;
  end if;

  update public.watch_rooms
     set host_id = auth.uid()
   where id = room
     and origin = 'stream'
     and ended_at is null
     and host_id = gone_host
     and host_id <> auth.uid()
     and updated_at < now() - interval '8 seconds';
  get diagnostics taken = row_count;

  return taken = 1;
end;
$$;

-- A quiet music room is kept, not closed.
create or replace function public.watch_close_stale(room uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  closed integer;
begin
  update public.watch_rooms
     set ended_at = updated_at
   where id = room
     and origin = 'stream'
     and ended_at is null
     and updated_at < now() - interval '3 minutes';
  get diagnostics closed = row_count;

  return closed = 1;
end;
$$;

revoke all on function public.watch_take_over(uuid, uuid) from public;
grant execute on function public.watch_take_over(uuid, uuid) to authenticated;
revoke all on function public.watch_close_stale(uuid) from public;
grant execute on function public.watch_close_stale(uuid) to anon, authenticated;

-- 2. Songs in the queue ------------------------------------------------------------------------

alter table public.watch_queue drop constraint if exists watch_queue_link_kind;
alter table public.watch_queue add constraint watch_queue_link_kind
  check (source_kind is null or source_kind in ('file', 'hls', 'dash', 'youtube', 'vimeo', 'dailymotion', 'twitch', 'embed', 'audio'));

-- https as before; a song may also be one of the site's own paths (never `//`, which is another host).
alter table public.watch_queue drop constraint if exists watch_queue_link_url;
alter table public.watch_queue add constraint watch_queue_link_url
  check (
    source_url is null
    or (
      char_length(source_url) <= 2048
      and (source_url like 'https://%' or (source_kind = 'audio' and source_url like '/%' and source_url not like '//%'))
    )
  );

-- 3. Adding and chatting: a music room that is not public is its host's alone -----------------------

drop policy if exists "watch queue added to by an account" on public.watch_queue;
create policy "watch queue added to by an account" on public.watch_queue
  for insert to authenticated
  with check (
    not public.is_banned()
    and added_by = auth.uid()
    and exists (
      select 1 from public.watch_rooms r
       where r.id = watch_queue.room_id and r.ended_at is null and (r.is_public or r.host_id = auth.uid())
    )
    and (
      (not in_queue and played_at is null and play_index is null)
      or (
        in_queue and played_at is null and play_index is null
        and exists (select 1 from public.watch_crowns c where c.room_id = watch_queue.room_id and c.user_id = auth.uid())
      )
      or (played_at is not null and exists (select 1 from public.watch_rooms r where r.id = watch_queue.room_id and r.host_id = auth.uid()))
    )
  );

drop policy if exists "watch messages said by an account" on public.watch_messages;
create policy "watch messages said by an account" on public.watch_messages
  for insert to authenticated
  with check (
    not public.is_banned()
    and author_id = auth.uid()
    and exists (
      select 1 from public.watch_rooms r
       where r.id = room_id and r.ended_at is null and (r.is_public or r.host_id = auth.uid())
    )
  );

-- 4. The cover card's notes ----------------------------------------------------------------------

create table if not exists public.music_song_notes (
  -- The song's mp3 bucket path (`<uploader id>/...`), the key the music shelf gives a bucket track.
  track_id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- An `images` bucket path under the owner's folder, or null for none.
  picture_path text,
  description text,
  updated_at timestamptz not null default now(),
  constraint music_song_notes_track_owner check (split_part(track_id, '/', 1) = owner_id::text),
  constraint music_song_notes_picture check (
    picture_path is null or (split_part(picture_path, '/', 1) = owner_id::text and char_length(picture_path) <= 512)
  ),
  constraint music_song_notes_description check (description is null or char_length(description) between 1 and 600)
);

alter table public.music_song_notes enable row level security;

drop policy if exists "song notes readable" on public.music_song_notes;
create policy "song notes readable" on public.music_song_notes for select using (true);

drop policy if exists "song notes written by the uploader" on public.music_song_notes;
create policy "song notes written by the uploader" on public.music_song_notes
  for insert to authenticated
  with check (not public.is_banned() and owner_id = auth.uid());

drop policy if exists "song notes changed by the uploader" on public.music_song_notes;
create policy "song notes changed by the uploader" on public.music_song_notes
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "song notes removed by the uploader" on public.music_song_notes;
create policy "song notes removed by the uploader" on public.music_song_notes
  for delete to authenticated
  using (owner_id = auth.uid());

create or replace function public.touch_music_song_notes()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists music_song_notes_touch on public.music_song_notes;
create trigger music_song_notes_touch
  before update on public.music_song_notes
  for each row execute function public.touch_music_song_notes();

-- Afterwards, to see it landed:
--   select column_name from information_schema.columns where table_name = 'watch_rooms' and column_name in ('origin', 'is_public', 'cleared_at');
--   select tablename, policyname, cmd from pg_policies where tablename in ('watch_queue', 'watch_messages', 'music_song_notes') order by 1, 2;
