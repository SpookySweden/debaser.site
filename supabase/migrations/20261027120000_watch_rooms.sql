-- -----------------------------------------------------------------------------
-- Watch together: stream rooms, their queue and their chat (SPEC-watch-together.md, 2026-10-27)
-- -----------------------------------------------------------------------------
-- Run with `npm run db:push`. Idempotent: `if not exists` throughout, every policy, trigger and function
-- dropped and re-created by name. It changes no existing row and touches no existing table.
--
-- A room is a *pointer*, like a music broadcast (app/lib/audio/broadcast.ts): which play of which file,
-- where in it, and when that was true. No video passes through here; every viewer's browser fetches the
-- same file from the `video` bucket and seeks to the same place.
--
-- Who is in a room is not stored: it is the room's Realtime Presence channel (`watch:<room id>`). The
-- database only knows the host's heartbeat (`updated_at`, written every few seconds while live), which is
-- what the two functions at the end use to decide whether a host has gone.

-- 1. The rooms --------------------------------------------------------------------

create table if not exists public.watch_rooms (
  id uuid primary key default gen_random_uuid(),
  -- Who pressed GO LIVE. Never changes: the forum record and the file folds name this account.
  original_host_id uuid not null references auth.users (id) on delete cascade,
  original_host_label text not null default 'Unknown',
  -- Who runs the transport now. Changes on a handover.
  host_id uuid not null references auth.users (id) on delete cascade,
  -- The board thread filed when it went live (a board anchor `watch:<id>`). Set once.
  forum_thread_id uuid references public.forum_threads (id) on delete set null,
  -- Playback: which queue entry, where in it, playing or not. Written by the host on every change and on
  -- a heartbeat, so `updated_at` is also how fresh the host is.
  current_entry_id uuid,
  position_seconds numeric not null default 0,
  is_playing boolean not null default false,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Null while live.
  ended_at timestamptz,
  constraint watch_rooms_label_length check (char_length(original_host_label) between 1 and 80),
  constraint watch_rooms_position check (position_seconds >= 0)
);

create index if not exists watch_rooms_live_idx on public.watch_rooms (started_at desc) where ended_at is null;

alter table public.watch_rooms enable row level security;

drop policy if exists "watch rooms readable" on public.watch_rooms;
create policy "watch rooms readable" on public.watch_rooms for select using (true);

-- Only a room you host and started, and only live.
drop policy if exists "watch rooms opened by their host" on public.watch_rooms;
create policy "watch rooms opened by their host" on public.watch_rooms
  for insert to authenticated
  with check (
    not public.is_banned()
    and host_id = auth.uid()
    and original_host_id = auth.uid()
    and ended_at is null
  );

-- Only the current host writes the room (playback, handing over, ending). The new row may name another
-- host - that is a handover - so the check is on who is writing, and the trigger below keeps the fields
-- nobody may change.
drop policy if exists "watch rooms run by their host" on public.watch_rooms;
create policy "watch rooms run by their host" on public.watch_rooms
  for update to authenticated
  using (host_id = auth.uid() and ended_at is null)
  with check (true);

-- No delete from the site: a room is a record. The admin cleans up through SQL.

-- The fields a host may not rewrite, and an ended room stays ended.
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
  if old.forum_thread_id is not null then
    new.forum_thread_id := old.forum_thread_id;
  end if;
  if old.ended_at is not null then
    new.ended_at := old.ended_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists watch_rooms_guard on public.watch_rooms;
create trigger watch_rooms_guard
  before update on public.watch_rooms
  for each row execute function public.watch_rooms_guard();

-- 2. The queue: every file added, and the order it actually played --------------------

create table if not exists public.watch_queue (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.watch_rooms (id) on delete cascade,
  -- The order of what is still to play. The host reorders by rewriting these.
  position integer not null default 0,
  -- Null once the file has left the catalogue: the record then says so.
  media_item_id uuid references public.media_items (id) on delete set null,
  added_by uuid references auth.users (id) on delete set null,
  added_at timestamptz not null default now(),
  -- Set when it starts playing: the forum record lists plays in `play_index` order. A file added again
  -- is a new row; the last file looping is the same play.
  played_at timestamptz,
  play_index integer
);

create index if not exists watch_queue_room_idx on public.watch_queue (room_id, position);
create index if not exists watch_queue_media_idx on public.watch_queue (media_item_id) where played_at is not null;

alter table public.watch_queue enable row level security;

drop policy if exists "watch queue readable" on public.watch_queue;
create policy "watch queue readable" on public.watch_queue for select using (true);

-- Any signed-in account adds to a live room, in its own name.
drop policy if exists "watch queue added to by an account" on public.watch_queue;
create policy "watch queue added to by an account" on public.watch_queue
  for insert to authenticated
  with check (
    not public.is_banned()
    and added_by = auth.uid()
    and exists (select 1 from public.watch_rooms r where r.id = room_id and r.ended_at is null)
  );

-- The host reorders and marks plays.
drop policy if exists "watch queue run by the host" on public.watch_queue;
create policy "watch queue run by the host" on public.watch_queue
  for update to authenticated
  using (exists (select 1 from public.watch_rooms r where r.id = room_id and r.host_id = auth.uid() and r.ended_at is null))
  with check (exists (select 1 from public.watch_rooms r where r.id = room_id and r.host_id = auth.uid()));

-- The host takes out what has not played yet; what played is the record.
drop policy if exists "watch queue trimmed by the host" on public.watch_queue;
create policy "watch queue trimmed by the host" on public.watch_queue
  for delete to authenticated
  using (
    played_at is null
    and exists (select 1 from public.watch_rooms r where r.id = room_id and r.host_id = auth.uid() and r.ended_at is null)
  );

-- 3. The chat, with where in the video each line was said ------------------------------

create table if not exists public.watch_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.watch_rooms (id) on delete cascade,
  -- Which play of which file it was said over.
  queue_entry_id uuid references public.watch_queue (id) on delete cascade,
  media_item_id uuid references public.media_items (id) on delete set null,
  author_id uuid not null references auth.users (id) on delete cascade,
  author_label text not null default 'Unknown',
  body text not null,
  media_seconds numeric not null default 0,
  created_at timestamptz not null default now(),
  constraint watch_messages_body_length check (char_length(body) between 1 and 500),
  constraint watch_messages_label_length check (char_length(author_label) between 1 and 80),
  constraint watch_messages_seconds check (media_seconds >= 0)
);

create index if not exists watch_messages_room_idx on public.watch_messages (room_id, created_at);
create index if not exists watch_messages_media_idx on public.watch_messages (media_item_id, created_at);

alter table public.watch_messages enable row level security;

drop policy if exists "watch messages readable" on public.watch_messages;
create policy "watch messages readable" on public.watch_messages for select using (true);

-- Signed-in, in your own name, while the room is live. No edits.
drop policy if exists "watch messages said by an account" on public.watch_messages;
create policy "watch messages said by an account" on public.watch_messages
  for insert to authenticated
  with check (
    not public.is_banned()
    and author_id = auth.uid()
    and exists (select 1 from public.watch_rooms r where r.id = room_id and r.ended_at is null)
  );

drop policy if exists "watch messages removed by their author or admin" on public.watch_messages;
create policy "watch messages removed by their author or admin" on public.watch_messages
  for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

-- 4. A host who vanished -------------------------------------------------------------
-- A host who leaves properly hands over themselves (an ordinary update). One whose tab died stops
-- writing; the watcher who has been in the room longest then calls this. It wins only if the room is
-- live, the host is still the one the caller saw, and the host's heartbeat has been quiet for 8 seconds,
-- in one guarded update: two tabs calling at once, one gets the row and the other gets false.

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
     and ended_at is null
     and host_id = gone_host
     and host_id <> auth.uid()
     and updated_at < now() - interval '8 seconds';
  get diagnostics taken = row_count;

  return taken = 1;
end;
$$;

-- A room everybody left without saying so (every tab closed at once): nobody is writing, so nobody
-- ends it. Anybody who finds it quiet for three minutes closes it, dated to its last heartbeat.
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

-- 5. Live changes ------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'watch_rooms') then
    alter publication supabase_realtime add table public.watch_rooms;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'watch_queue') then
    alter publication supabase_realtime add table public.watch_queue;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'watch_messages') then
    alter publication supabase_realtime add table public.watch_messages;
  end if;
end $$;

-- Afterwards, to see it landed:
--   select tablename, policyname from pg_policies where tablename like 'watch_%' order by 1, 2;
--   select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'watch_%';
