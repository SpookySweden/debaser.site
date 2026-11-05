-- Room settings (SPEC-room-settings.md; Luke's OK in chat 2026-11-05). A room gets a name, a topic and who may add to it,
-- changed from the settings cog by its host or anybody holding a crown there.
--
--   - watch_rooms: three new columns. Every room starts unnamed and open to anyone, which is how rooms behave today.
--   - watch_room_settings: the one way a crown holder writes to a room, and it writes those three fields only. Playback
--     stays with the host, under the existing update policy.
--   - The insert rule on watch_queue gains one condition: in a crowns-only room, only a crown or the host adds.
--
-- Nothing is deleted. Re-runnable: `if not exists`, and constraints, policies and functions are dropped or replaced by name.

alter table public.watch_rooms
  add column if not exists name text,
  add column if not exists topic text,
  add column if not exists add_mode text not null default 'anyone';

alter table public.watch_rooms drop constraint if exists watch_rooms_name_length;
alter table public.watch_rooms add constraint watch_rooms_name_length check (name is null or char_length(name) between 1 and 60);
alter table public.watch_rooms drop constraint if exists watch_rooms_topic_length;
alter table public.watch_rooms add constraint watch_rooms_topic_length check (topic is null or char_length(topic) between 1 and 120);
alter table public.watch_rooms drop constraint if exists watch_rooms_add_mode;
alter table public.watch_rooms add constraint watch_rooms_add_mode check (add_mode in ('anyone', 'crowns'));

-- Security definer because a crown holder has no update right on the room, and must not get one: the policy could not stop
-- them touching playback. `search_path` is empty, so everything is named in full.
--
-- The room's guard stamps updated_at on every write, and viewers work out where the video is from position_seconds at
-- updated_at. So a save while playing also walks the position forward by the time since the last stamp, or everybody's
-- picture would jump back.
create or replace function public.watch_room_settings(room uuid, new_name text, new_topic text, new_add_mode text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_name text := nullif(left(btrim(regexp_replace(coalesce(new_name, ''), '\s+', ' ', 'g')), 60), '');
  clean_topic text := nullif(left(btrim(regexp_replace(coalesce(new_topic, ''), '\s+', ' ', 'g')), 120), '');
begin
  if auth.uid() is null or public.is_banned() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if new_add_mode is null or new_add_mode not in ('anyone', 'crowns') then
    raise exception 'not allowed' using errcode = '22023';
  end if;
  update public.watch_rooms r
     set name = clean_name,
         topic = clean_topic,
         add_mode = new_add_mode,
         position_seconds = case
           when r.is_playing then r.position_seconds + greatest(extract(epoch from now() - r.updated_at), 0)::numeric
           else r.position_seconds
         end
   where r.id = room
     and r.ended_at is null
     and (
       r.host_id = auth.uid()
       or exists (select 1 from public.watch_crowns c where c.room_id = r.id and c.user_id = auth.uid())
     );
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.watch_room_settings(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.watch_room_settings(uuid, text, text, text) to authenticated;

-- The rule of 20261103171458_music_rooms.sql, with the crowns-only condition added.
drop policy if exists "watch queue added to by an account" on public.watch_queue;
create policy "watch queue added to by an account" on public.watch_queue
  for insert to authenticated
  with check (
    not public.is_banned()
    and added_by = auth.uid()
    and exists (
      select 1 from public.watch_rooms r
       where r.id = watch_queue.room_id and r.ended_at is null and (r.is_public or r.host_id = auth.uid())
         and (
           r.add_mode = 'anyone'
           or r.host_id = auth.uid()
           or exists (select 1 from public.watch_crowns c where c.room_id = watch_queue.room_id and c.user_id = auth.uid())
         )
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
