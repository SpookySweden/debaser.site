-- -----------------------------------------------------------------------------
-- Own rooms and pictures: queues become rooms (SPEC-rooms-queues.md section 3, Luke's OK 2026-11-14)
-- -----------------------------------------------------------------------------
-- Run with `npm run db:push`. Re-runnable: every constraint, policy, trigger and function is dropped and re-created
-- by name. No new table and no new column. Nothing is deleted and no existing row is changed or read: every room in
-- the database is a stream room (origin 'stream'), and none is a person's own room (origin 'music').
--
-- A person's own room is the room kind the database already has for "one kept room per person" (origin 'music',
-- 20261103171458_music_rooms.sql). GO PUBLIC, which could open one, goes away with this: going live always makes a
-- new stream room.
--
-- 1. An own room can never be switched public: the database refuses.
-- 2. A queue row may be a picture (source_kind 'picture').
-- 3. A picture's address is https or one of the site's own paths, as a song's already may be.
-- 4. The queue's delete rule, with everything it allowed before, plus: (a) the owner of an own room may delete any
--    row in it, played or not; (b) a picture not yet shown may also be taken out by the room's host and by its adder.
-- 5. At most 500 rows in one person's own room.
-- 6. `watch_room_door` and `watch_room_outline` answer "no such room" for somebody else's own room.
-- 7. `watch_picture_next`: the host or a crown of a live room takes the showing picture off the screen.
-- (What was change 8, a scheduled delete of own-room queues, is NOT built: Luke, 2026-11-14, "No, keep it".)
--
-- One addition found while writing it, asked of Luke by itself (2026-11-14, "A: Stream rooms only"):
-- 8. `private_stream_folds` counts stream rooms only, so a file played in an own room is never counted under that
--    file as `1 PRIVATE STREAM`.
-- Joining an own room by its link (Luke's other answer the same day) is its own migration, 20261114152339_own_room_links.sql.

-- 1. An own room is never public -------------------------------------------------------------------------------------
-- The room's guard already derives a music room's privacy from its switch (on is 'open'), so a write that switches
-- one on now fails this check instead of opening the room.
alter table public.watch_rooms drop constraint if exists watch_rooms_own_room_private;
alter table public.watch_rooms add constraint watch_rooms_own_room_private
  check (origin <> 'music' or (not is_public and privacy = 'private'));

-- 2 and 3. Pictures in the queue -------------------------------------------------------------------------------------
alter table public.watch_queue drop constraint if exists watch_queue_link_kind;
alter table public.watch_queue add constraint watch_queue_link_kind
  check (source_kind is null or source_kind in ('file', 'hls', 'dash', 'youtube', 'vimeo', 'dailymotion', 'twitch', 'embed', 'audio', 'picture'));

-- https as before; a song or a picture may also be one of the site's own paths (never `//`, which is another host).
alter table public.watch_queue drop constraint if exists watch_queue_link_url;
alter table public.watch_queue add constraint watch_queue_link_url
  check (
    source_url is null
    or (
      char_length(source_url) <= 2048
      and (source_url like 'https://%' or (source_kind in ('audio', 'picture') and source_url like '/%' and source_url not like '//%'))
    )
  );

-- 4. Taking rows out -------------------------------------------------------------------------------------------------
-- As 20261102192043_watch_queue_additions.sql wrote it (what has not played: a crown, or your own addition never
-- pulled in), plus the two new ways.
drop policy if exists "watch queue trimmed by a crown or taken back" on public.watch_queue;
create policy "watch queue trimmed by a crown or taken back" on public.watch_queue
  for delete to authenticated
  using (
    exists (select 1 from public.watch_rooms r where r.id = watch_queue.room_id and r.ended_at is null)
    and (
      (
        played_at is null
        and (
          exists (select 1 from public.watch_crowns c where c.room_id = watch_queue.room_id and c.user_id = auth.uid())
          or (not in_queue and added_by = auth.uid())
          -- (b) A picture not yet shown: its adder, and the room's host.
          or (
            source_kind = 'picture'
            and (added_by = auth.uid() or exists (select 1 from public.watch_rooms r where r.id = watch_queue.room_id and r.host_id = auth.uid()))
          )
        )
      )
      -- (a) Your own room: any row, played or not, so finished things are cleared and rows never pile up.
      or exists (select 1 from public.watch_rooms r where r.id = watch_queue.room_id and r.origin = 'music' and r.host_id = auth.uid())
    )
  );

-- 5. An own room holds at most 500 rows ------------------------------------------------------------------------------
-- Its own trigger, so the queue's guard stays as it was. Definer, so the count is not slowed by the read rules; it
-- looks only at the caller's own room, and nobody can call it (a trigger function is not on the database's web route).
-- The site itself stops at 220.
create or replace function public.watch_queue_own_room_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The SQL editor and the service role have no user, as in the queue's guard.
  if auth.uid() is not null
    and exists (select 1 from public.watch_rooms r where r.id = new.room_id and r.origin = 'music' and r.host_id = auth.uid())
    and (select count(*) from public.watch_queue q where q.room_id = new.room_id) >= 500 then
    raise exception 'own room queue is full' using errcode = '53400';
  end if;
  return new;
end;
$$;
revoke all on function public.watch_queue_own_room_cap() from public, anon, authenticated;

drop trigger if exists watch_queue_own_room_cap on public.watch_queue;
create trigger watch_queue_own_room_cap
  before insert on public.watch_queue
  for each row execute function public.watch_queue_own_room_cap();

-- 6. Somebody else's own room is "no such room" ----------------------------------------------------------------------
-- The door of 20261106194444_guests_in_streams.sql, with one condition on the join: the room is found only when it is
-- a stream room or the caller's own.
create or replace function public.watch_room_door(room uuid)
returns table (found boolean, live boolean, privacy text, title text, member boolean, removed boolean, locked_until timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.id is not null,
    r.id is not null and r.ended_at is null and r.is_public,
    r.privacy,
    case when r.id is null or auth.uid() is null or public.is_guest() then null else coalesce(r.name, 'THIS ROOM') end,
    public.is_room_member(room),
    exists (select 1 from public.watch_members m where m.room_id = room and m.user_id = auth.uid() and m.removed_at is not null),
    (
      select max(until) from (
        select a.locked_until as until from public.watch_join_attempts a where a.room_id = room and a.user_id = auth.uid() and a.locked_until > now()
        union all
        select g.locked_until from public.watch_guest_tries g where g.room_id = room and g.locked_until > now() and (auth.uid() is null or public.is_guest())
      ) locks
    )
  from (select room as asked) q
  left join public.watch_rooms r on r.id = q.asked and (r.origin <> 'music' or r.host_id = auth.uid());
$$;
revoke all on function public.watch_room_door(uuid) from public;
grant execute on function public.watch_room_door(uuid) to anon, authenticated, service_role;

-- The outline of 20261105154636_private_stream_outlines.sql, for stream rooms only: an own room has no outsiders to
-- draw one for.
create or replace function public.watch_room_outline(room uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'live', r.ended_at is null,
    'people', coalesce((select jsonb_agg('ANON-' || m.anon_number order by m.anon_number) from public.watch_members m where m.room_id = r.id and m.removed_at is null), '[]'::jsonb),
    'messages', public.watch_outline_lines(r.id, 200),
    'queue', (select count(*) from public.watch_queue q where q.room_id = r.id and q.in_queue and q.played_at is null),
    'strokes', (select count(*) from public.room_canvas_inputs i join public.room_canvases c on c.id = i.canvas_id where c.room_id = r.id),
    'strokePeople', (select count(distinct i.author_id) from public.room_canvas_inputs i join public.room_canvases c on c.id = i.canvas_id where c.room_id = r.id)
  )
  from public.watch_rooms r
  where r.id = room and r.privacy <> 'open' and r.origin <> 'music';
$$;
revoke all on function public.watch_room_outline(uuid) from public;
grant execute on function public.watch_room_outline(uuid) to anon, authenticated, service_role;

-- 7. NEXT on a picture -----------------------------------------------------------------------------------------------
-- A picture stays on the screen until somebody presses NEXT (Luke's answer 5B), and a host who has stepped away must
-- not freeze the room: the host or a crown of a live stream room clears the room's pointer, and the host's tab then
-- starts whatever is next. True when it did. Anything on screen that is not a picture, and anybody else, gets false.
create or replace function public.watch_picture_next(room uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  moved integer;
begin
  if auth.uid() is null or public.is_banned() then
    return false;
  end if;

  update public.watch_rooms r
     set current_entry_id = null, position_seconds = 0, is_playing = false
   where r.id = room
     and r.origin = 'stream'
     and r.ended_at is null
     and (r.host_id = auth.uid() or exists (select 1 from public.watch_crowns c where c.room_id = r.id and c.user_id = auth.uid()))
     and exists (select 1 from public.watch_queue q where q.id = r.current_entry_id and q.room_id = r.id and q.source_kind = 'picture');
  get diagnostics moved = row_count;

  return moved = 1;
end;
$$;
revoke all on function public.watch_picture_next(uuid) from public, anon;
grant execute on function public.watch_picture_next(uuid) to authenticated, service_role;

-- 8. STREAM CHAT's private bars count stream rooms only (Luke, 2026-11-14: "A: Stream rooms only") ----------------------
-- The function of 20261105154636_private_stream_outlines.sql with `r.origin = 'stream'` added in its two reads.
create or replace function public.private_stream_folds(media_ids uuid[])
returns table (media_item_id uuid, rooms bigint, sizes text[])
language sql
stable
security definer
set search_path = ''
as $$
  select
    q.media_item_id,
    count(distinct q.room_id),
    (
      select coalesce(array_agg(l.size), '{}')
      from (
        select public.watch_size_of(m.body) as size
        from public.watch_messages m join public.watch_rooms r on r.id = m.room_id
        where m.media_item_id = q.media_item_id and m.privacy_at_write = 'private' and r.origin = 'stream' and not public.is_room_member(r.id)
        order by m.created_at
        limit 100
      ) l
    )
  from public.watch_queue q join public.watch_rooms r on r.id = q.room_id
  where q.media_item_id = any (media_ids[1:100])
    and q.played_at is not null and q.privacy_at_write = 'private' and r.origin = 'stream'
    and not public.is_room_member(r.id)
  group by q.media_item_id;
$$;
revoke all on function public.private_stream_folds(uuid[]) from public;
grant execute on function public.private_stream_folds(uuid[]) to anon, authenticated, service_role;

-- Afterwards, to see it landed:
--   select conname from pg_constraint where conname in ('watch_rooms_own_room_private', 'watch_queue_link_kind', 'watch_queue_link_url');
--   select tgname from pg_trigger where tgrelid = 'public.watch_queue'::regclass and not tgisinternal;
--   select proname from pg_proc where proname in ('watch_picture_next', 'watch_queue_own_room_cap');
