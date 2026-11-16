-- -----------------------------------------------------------------------------
-- The perpetual room (SPEC-rooms-perpetual.md; Luke's OK 2026-11-16, typed OK for this file asked again before push)
-- -----------------------------------------------------------------------------
-- One kind of room in two states. `origin = 'music'` keeps meaning "somebody's main room", but a main room may now be
-- announced (GO LIVE: `is_public` on), made private again, ended by its host, and handed on, at which moment it becomes
-- an ordinary stream room (`origin = 'stream'`) that follows today's stream rules: it passes on when its host leaves,
-- and ends 3 minutes after it is left empty.
--
-- Run with `npm run db:push`. Re-runnable: the index and constraint are dropped and made again by name, policies are
-- dropped and recreated by name, functions are `create or replace`. No row is changed or deleted; no table or column
-- is added. Each function below is its latest version (named beside it) with the change said in its comment.

-- 1. One OPEN main room per person (was: one main room per person, ever) -------------------------------------------
--    So a person whose room was handed on, or who ended theirs, gets a new one with their next play.
drop index if exists public.watch_rooms_one_music_room;
create unique index if not exists watch_rooms_one_music_room
  on public.watch_rooms (original_host_id) where origin = 'music' and ended_at is null;

-- 2. A main room may be announced (was: never public; 20261114145645_own_rooms_and_pictures.sql) --------------------
--    Off, it is private: joinable only by its link, exactly as today.
alter table public.watch_rooms drop constraint if exists watch_rooms_own_room_private;
alter table public.watch_rooms add constraint watch_rooms_own_room_private
  check (origin <> 'music' or is_public or privacy = 'private');

-- 3. The room guard (latest: 20261106013759_room_thread_pointer.sql) ----------------------------------------------
--    For a main room: its host may END it (was: never ended); its announced switch and privacy change only inside
--    watch_room_announce (was: privacy derived from the switch); its host and kind change only inside
--    watch_room_pass_on / watch_take_over, and only from main room to stream room, never back. Stream rooms: as before.
create or replace function public.watch_rooms_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  passing boolean := coalesce(current_setting('debaser.room_pass', true), '') = 'on';
  announcing boolean := coalesce(current_setting('debaser.room_privacy', true), '') = 'on';
begin
  new.id := old.id;
  new.original_host_id := old.original_host_id;
  new.original_host_label := old.original_host_label;
  new.started_at := old.started_at;
  if not (passing and old.origin = 'music' and new.origin = 'stream') then new.origin := old.origin; end if;
  -- A foreign key's set-null is a trigger inside the delete, deeper than 1, and gets through.
  if old.forum_thread_id is not null and pg_trigger_depth() = 1 then new.forum_thread_id := old.forum_thread_id; end if;
  if old.ended_at is not null then new.ended_at := old.ended_at; end if;
  if new.origin = 'music' then
    new.host_id := old.host_id;
    -- Set only by watch_room_announce, for the length of its own update. A person's request can't reach set_config.
    if not announcing then
      new.is_public := old.is_public;
      new.privacy := old.privacy;
    end if;
  else
    new.is_public := true;
    if not announcing then new.privacy := old.privacy; end if;
    -- Removed means out: nobody hands the room back to them.
    if new.host_id is distinct from old.host_id
      and exists (select 1 from public.watch_members m where m.room_id = old.id and m.user_id = new.host_id and m.removed_at is not null) then
      new.host_id := old.host_id;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- 4. GO LIVE and GO PRIVATE on a main room (new) -------------------------------------------------------------------
--    turn_on: announced with WHO CAN JOIN ('private' = listed as a private stream, joinable by its link only;
--    'password'; 'open'). Off: back to private and off every list; members stay until REMOVED. The password body is
--    watch_room_set_privacy's (20261105145655_private_streams.sql), which keeps serving stream rooms.
create or replace function public.watch_room_announce(room uuid, turn_on boolean, new_privacy text default 'private', new_password text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.is_banned() or public.is_guest() or turn_on is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.watch_rooms r where r.id = room and r.host_id = auth.uid() and r.ended_at is null and r.origin = 'music') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not turn_on then new_privacy := 'private'; end if;
  if new_privacy is null or new_privacy not in ('private', 'password', 'open') then
    raise exception 'not allowed' using errcode = '22023';
  end if;

  if new_privacy = 'password' then
    if new_password is not null then
      if char_length(new_password) not between 1 and 72 then
        raise exception 'bad password' using errcode = '22023';
      end if;
      insert into public.watch_room_passwords (room_id, password_hash)
      values (room, extensions.crypt(new_password, extensions.gen_salt('bf', 10)))
      on conflict (room_id) do update set password_hash = excluded.password_hash, set_at = now();
      delete from public.watch_join_attempts a where a.room_id = room;
    elsif not exists (select 1 from public.watch_room_passwords s where s.room_id = room) then
      raise exception 'bad password' using errcode = '22023';
    end if;
  else
    delete from public.watch_room_passwords s where s.room_id = room;
    delete from public.watch_join_attempts a where a.room_id = room;
  end if;

  perform set_config('debaser.room_privacy', 'on', true);
  update public.watch_rooms r set is_public = turn_on, privacy = new_privacy where r.id = room;
  perform set_config('debaser.room_privacy', '', true);
end;
$$;
revoke all on function public.watch_room_announce(uuid, boolean, text, text) from public, anon;
grant execute on function public.watch_room_announce(uuid, boolean, text, text) to authenticated, service_role;

-- 5. Handing a room on (new): its host leaves a live room with people in it. ----------------------------------------
--    The heir must be a member who is not removed. A main room becomes a stream room as it changes hands (so it is
--    nobody's main room and ends when left empty); the leaver's next play makes them a new main room (change 1). The
--    crown and member triggers give the heir a crown, as a take-over does. A private (unannounced) main room is never
--    handed on.
create or replace function public.watch_room_pass_on(room uuid, heir uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  passed integer;
begin
  if auth.uid() is null or heir is null or heir = auth.uid() then return false; end if;
  if not exists (select 1 from public.watch_members m where m.room_id = room and m.user_id = heir and m.removed_at is null) then
    return false;
  end if;
  perform set_config('debaser.room_pass', 'on', true);
  update public.watch_rooms r
     set host_id = heir, origin = 'stream'
   where r.id = room and r.host_id = auth.uid() and r.ended_at is null
     and (r.origin = 'stream' or (r.origin = 'music' and r.is_public));
  get diagnostics passed = row_count;
  perform set_config('debaser.room_pass', '', true);
  return passed = 1;
end;
$$;
revoke all on function public.watch_room_pass_on(uuid, uuid) from public, anon;
grant execute on function public.watch_room_pass_on(uuid, uuid) to authenticated, service_role;

-- 6. Take-over when the host's tab is gone (latest: 20261105145655_private_streams.sql) ----------------------------
--    Stream rooms: as before (8 quiet seconds). A live main room: after 45 quiet seconds, so a reload or a dropped
--    connection never costs anybody their room (Luke, Q3 A); it then becomes a stream room like a handed-on one.
create or replace function public.watch_take_over(room uuid, gone_host uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  taken integer;
begin
  if not public.room_may_talk(room) then return false; end if;
  perform set_config('debaser.room_pass', 'on', true);
  update public.watch_rooms
    set host_id = auth.uid(), origin = 'stream'
    where id = room and ended_at is null and host_id = gone_host and host_id <> auth.uid()
      and ((origin = 'stream' and updated_at < now() - interval '8 seconds')
        or (origin = 'music' and is_public and updated_at < now() - interval '45 seconds'));
  get diagnostics taken = row_count;
  perform set_config('debaser.room_pass', '', true);
  return taken = 1;
end;
$$;

-- 7. Chat before GO LIVE (latest: 20261105145655_private_streams.sql) ----------------------------------------------
--    Was: author, may talk, room on, and (is_public or host). A main room's link joiners may now chat too.
drop policy if exists "watch messages said by an account" on public.watch_messages;
create policy "watch messages said by an account" on public.watch_messages
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.room_may_talk(room_id)
    and exists (select 1 from public.watch_rooms r where r.id = watch_messages.room_id and r.ended_at is null and (r.is_public or r.host_id = auth.uid() or r.origin = 'music'))
  );

-- 8. COPY LINK / REFRESH LINK (latest: 20261114152339_own_room_links.sql) -------------------------------------------
--    The caller's OPEN main room only (there may now be ended ones too). Otherwise as before.
create or replace function public.watch_own_link(refresh boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  own uuid;
  held text;
begin
  if auth.uid() is null or public.is_banned() or public.is_guest() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select r.id into own from public.watch_rooms r where r.origin = 'music' and r.host_id = auth.uid() and r.ended_at is null;
  if own is null then return null; end if;

  select l.token into held from public.watch_room_links l where l.room_id = own;
  if held is not null and not refresh then return held; end if;

  -- 64 characters from two random ids: far too long to guess.
  held := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  -- A refresh only changes the secret: whoever is already a member stays one until the owner uses REMOVE.
  insert into public.watch_room_links (room_id, token) values (own, held)
  on conflict (room_id) do update set token = excluded.token, made_at = now();

  return held;
end;
$$;
revoke all on function public.watch_own_link(boolean) from public, anon;
grant execute on function public.watch_own_link(boolean) to authenticated, service_role;

-- 9. The door (latest: 20261114152339_own_room_links.sql) ------------------------------------------------------------
--    A main room is found by its owner and members, as before, and now also by anybody once it is live with OPEN or
--    PASSWORD. A live main room with PRIVATE stays link-only: for anybody else it is an address that is no room.
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
  left join public.watch_rooms r on r.id = q.asked
    and (r.origin <> 'music' or (r.is_public and r.privacy <> 'private') or r.host_id = auth.uid()
      or exists (select 1 from public.watch_members m where m.room_id = r.id and m.user_id = auth.uid()));
$$;
revoke all on function public.watch_room_door(uuid) from public;
grant execute on function public.watch_room_door(uuid) to anon, authenticated, service_role;

-- 10. The way in (latest: 20261114152339_own_room_links.sql) ---------------------------------------------------------
--     The same one condition on its first read as the door: a live OPEN or PASSWORD main room is joined as a stream
--     room is. A private one is still entered by its link (watch_join_link) only.
create or replace function public.watch_join(room uuid, password text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  guest boolean := public.is_guest();
  setting text;
  ended timestamptz;
  switched_on boolean;
  stored text;
  attempt public.watch_join_attempts%rowtype;
  room_tries public.watch_guest_tries%rowtype;
  caller_label text;
begin
  if caller is null or public.is_banned() then return 'refused'; end if;

  select r.privacy, r.ended_at, r.is_public into setting, ended, switched_on from public.watch_rooms r
    where r.id = room
      and (r.origin <> 'music' or (r.is_public and r.privacy <> 'private') or r.host_id = caller
        or exists (select 1 from public.watch_members m where m.room_id = r.id and m.user_id = caller));
  if setting is null then return 'refused'; end if;

  if exists (select 1 from public.watch_members m where m.room_id = room and m.user_id = caller and m.removed_at is not null) then
    return 'removed';
  end if;
  if public.is_room_member(room) then return 'joined'; end if;
  if ended is not null or not switched_on then return 'ended'; end if;

  if setting = 'password' then
    if guest then
      insert into public.watch_guest_tries (room_id) values (room) on conflict (room_id) do nothing;
      select * into room_tries from public.watch_guest_tries g where g.room_id = room for update;
      if room_tries.locked_until is not null and room_tries.locked_until > now() then return 'locked'; end if;
    end if;

    insert into public.watch_join_attempts (room_id, user_id) values (room, caller) on conflict (room_id, user_id) do nothing;
    -- Held until this answer is written, so tries sent at once are counted one by one.
    select * into attempt from public.watch_join_attempts a where a.room_id = room and a.user_id = caller for update;
    if attempt.locked_until is not null and attempt.locked_until > now() then return 'locked'; end if;

    select s.password_hash into stored from public.watch_room_passwords s where s.room_id = room;
    if stored is null or password is null or extensions.crypt(password, stored) <> stored then
      if guest then
        if room_tries.window_started_at < now() - interval '10 minutes' then
          room_tries.tries := 0;
          room_tries.window_started_at := now();
        end if;
        if room_tries.tries + 1 >= 20 then
          update public.watch_guest_tries g set tries = 0, window_started_at = now(), locked_until = now() + interval '10 minutes' where g.room_id = room;
          return 'locked';
        end if;
        update public.watch_guest_tries g set tries = room_tries.tries + 1, window_started_at = room_tries.window_started_at, locked_until = null where g.room_id = room;
      end if;
      if attempt.tries + 1 >= 5 then
        update public.watch_join_attempts a set tries = 0, locked_until = now() + interval '10 minutes' where a.room_id = room and a.user_id = caller;
        return 'locked';
      end if;
      update public.watch_join_attempts a set tries = attempt.tries + 1, locked_until = null where a.room_id = room and a.user_id = caller;
      return 'wrong';
    end if;
    delete from public.watch_join_attempts a where a.room_id = room and a.user_id = caller;
  end if;

  select coalesce(nullif(p.display_name, ''), 'Unknown') into caller_label from public.profiles p where p.id = caller;
  insert into public.watch_members (room_id, user_id, label) values (room, caller, coalesce(caller_label, 'Unknown'))
  on conflict (room_id, user_id) do nothing;
  return 'joined';
end;
$$;
revoke all on function public.watch_join(uuid, text) from public, anon;
grant execute on function public.watch_join(uuid, text) to authenticated, service_role;

-- 11. A private room's outline for those outside it (latest: 20261114145645_own_rooms_and_pictures.sql) -------------
--     Was: stream rooms only. Now also a live main room (a private one still answers nothing).
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
  where r.id = room and r.privacy <> 'open' and (r.origin <> 'music' or r.is_public);
$$;

-- 12. Private streams folded under a file (latest: 20261114145645_own_rooms_and_pictures.sql) ------------------------
--     Was: stream rooms only. Now also live main rooms.
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
        where m.media_item_id = q.media_item_id and m.privacy_at_write = 'private' and (r.origin = 'stream' or r.is_public) and not public.is_room_member(r.id)
        order by m.created_at
        limit 100
      ) l
    )
  from public.watch_queue q join public.watch_rooms r on r.id = q.room_id
  where q.media_item_id = any (media_ids[1:100])
    and q.played_at is not null and q.privacy_at_write = 'private' and (r.origin = 'stream' or r.is_public)
    and not public.is_room_member(r.id)
  group by q.media_item_id;
$$;

-- Not changed, on purpose: watch_close_stale (ends only stream rooms, so a main room never ends by itself and a
-- handed-on room ends 3 minutes after it is left quiet), the queue's insert rule (a main room's members already add as
-- in a stream room: to their own list, straight in with a crown), crowns, members, passwords, canvases, the board.

-- Afterwards, to see it landed:
--   select indexdef from pg_indexes where indexname = 'watch_rooms_one_music_room';
--   select proname from pg_proc where proname in ('watch_room_announce', 'watch_room_pass_on');
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'watch_rooms_own_room_private';
