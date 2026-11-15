-- Three small tightenings after the rooms work (SPEC-rooms-queues.md). Luke's OK in chat, 2026-11-15, relayed by the
-- main session ("Yes, build it"): exactly these three, and nothing else.
--
-- (a) The address rule for a queue row refuses a backslash, a tab and a line break. A browser reads a backslash as a
--     slash and drops tabs and line breaks, so `/\host/x` begins with one slash, passed the old rule, and would load
--     from another site. The site already decides this in each viewer's browser; now the database refuses it too.
-- (b) A stale heartbeat cannot put a picture back after NEXT took it off. The host's tab says "this is on" every few
--     seconds; one sent just before a crown's NEXT could land just after it and put the picture back. NEXT now notes
--     which picture it took off and when, and for 15 seconds a write that would put that very picture back leaves the
--     room's pointer as it is. Nothing else about hosting changes.
-- (c) The room-link table gets the "guests stay out" rule every other table has. Nobody could read it before either
--     (it has no read rule at all and no read right); this makes it say so in the same words as the rest.
--
-- NO ROWS ARE CHANGED OR DELETED. Two empty columns are added to `watch_rooms` for (b). Re-runnable: constraints and
-- rules are dropped by name and made again, functions are replaced, columns are added only if missing.
-- Checked first, read-only (2026-11-15): 0 of 212 queue rows have a backslash, tab or line break in their address.

-- (a) The address rule --------------------------------------------------------------------------------------------------
-- As 20261114145645_own_rooms_and_pictures.sql wrote it (https; or, for a song or a picture, one of the site's own
-- paths, never `//`), plus: no backslash (92), tab (9), line feed (10) or carriage return (13) anywhere in it.
alter table public.watch_queue drop constraint if exists watch_queue_link_url;
alter table public.watch_queue add constraint watch_queue_link_url
  check (
    source_url is null
    or (
      char_length(source_url) <= 2048
      and position(chr(92) in source_url) = 0
      and position(chr(9) in source_url) = 0
      and position(chr(10) in source_url) = 0
      and position(chr(13) in source_url) = 0
      and (source_url like 'https://%' or (source_kind in ('audio', 'picture') and source_url like '/%' and source_url not like '//%'))
    )
  );

-- (b) A picture NEXT took off stays off -----------------------------------------------------------------------------------
-- Which picture NEXT last took off in this room, and when. Empty for every room until a NEXT.
alter table public.watch_rooms add column if not exists picture_off_entry_id uuid;
alter table public.watch_rooms add column if not exists picture_off_at timestamptz;

-- `watch_picture_next` as 20261114145645 wrote it (the host or a crown of a live stream room, and only with a picture
-- on), now also noting what it took off.
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
     set picture_off_entry_id = r.current_entry_id, picture_off_at = now(),
         current_entry_id = null, position_seconds = 0, is_playing = false
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

-- Its own trigger, so the room's guard stays as it was. For 15 seconds after a NEXT, a write that would move the
-- room's pointer back onto that very picture is a heartbeat that had not heard yet: what is on, where and whether it
-- plays stay as they are. Any other write, and the same picture put on again later on purpose, goes through.
create or replace function public.watch_rooms_picture_stays_off()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.current_entry_id is not null
     and new.current_entry_id is distinct from old.current_entry_id
     and old.picture_off_entry_id is not null
     and new.current_entry_id = old.picture_off_entry_id
     and old.picture_off_at is not null
     and old.picture_off_at > now() - interval '15 seconds' then
    new.current_entry_id := old.current_entry_id;
    new.position_seconds := old.position_seconds;
    new.is_playing := old.is_playing;
  end if;
  return new;
end;
$$;
revoke all on function public.watch_rooms_picture_stays_off() from public, anon, authenticated;

drop trigger if exists watch_rooms_picture_stays_off on public.watch_rooms;
create trigger watch_rooms_picture_stays_off
  before update on public.watch_rooms
  for each row execute function public.watch_rooms_picture_stays_off();

-- (c) Guests stay out of the room-link table --------------------------------------------------------------------------------
-- The same rule, in the same words, as 20261106194444_guests_in_streams.sql gave every table but the room's own.
drop policy if exists "guests stay out" on public.watch_room_links;
create policy "guests stay out" on public.watch_room_links
  as restrictive for select to authenticated
  using (not (select public.is_guest()));

-- Afterwards, to see it landed:
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'watch_queue_link_url';
--   select tgname from pg_trigger where tgrelid = 'public.watch_rooms'::regclass and not tgisinternal;
--   select polname from pg_policy where polrelid = 'public.watch_room_links'::regclass;
