-- -----------------------------------------------------------------------------
-- Own rooms: joining by link, and refreshing the link (Luke, 2026-11-14)
-- -----------------------------------------------------------------------------
-- Luke's words: "make it so that if you have someones link you can still join, with the ability to refresh the link
-- in the room settings next to where you copy it."
--
-- Run with `npm run db:push`, after 20261114145645_own_rooms_and_pictures.sql. Re-runnable: the table is made if
-- missing, every policy, trigger and function is dropped and re-created by name. No existing row is changed.
--
-- An own room stays what the first migration made it: never public, on no list, with no board record. What changes
-- is that it can have ONE link. The link holds a long random secret, not the room's address. Whoever opens the
-- current link while signed in becomes a member of the room, and a member may read it (the read rules already say
-- "its members"). REFRESH LINK makes a new secret: the old link lets nobody new in. Whoever already joined stays a
-- member until the owner REMOVEs them (Luke's answers, 2026-11-14: joiners listen, see the queue and add, "1A"; a
-- refresh "only stops new people", "2B"; "Yes, add it"). A room whose owner never pressed COPY LINK has no link at
-- all and nobody can join it.
--
-- 1. `watch_room_links`: one row per room that has a link, holding its secret. Nobody can read or write it from
--    the site; only the two functions below touch it.
-- 2. `watch_own_link`: the caller's own room's link secret, made on the first ask; with `refresh` a new one. It
--    deletes nothing: people already in are taken out with REMOVE (`watch_remove_member`, which already exists).
-- 3. `watch_join_link`: an account holding the current secret becomes a member; answers the room, or nothing.
-- 4. The door and the way in (`watch_room_door`, `watch_join`) find an own room for its owner AND for anybody who
--    joined it (somebody REMOVED is told so); for anybody else they answer as for an address that is no room.
-- 5. A member of somebody's own room may add to its queue. Their additions wait on their own list until the owner
--    pulls them in, as in a live room. They cannot chat there: that rule is unchanged, and chat comes with GO LIVE.
--    They MAY open a canvas and draw: the existing canvas rule already lets a member of a room do so, and Luke chose
--    to leave it ("Let them draw", 2026-11-15), so no canvas rule is touched here.
-- 6. The 500-row cap of an own room counts members' additions too.

-- 1. The link's secret -----------------------------------------------------------------------------------------------
create table if not exists public.watch_room_links (
  room_id uuid primary key references public.watch_rooms (id) on delete cascade,
  token text not null unique,
  made_at timestamptz not null default now(),
  constraint watch_room_links_token check (char_length(token) between 32 and 64)
);
alter table public.watch_room_links enable row level security;
-- No policy on purpose: with Row Level Security on and no rule, no request from the site reads or writes a row.
revoke all on public.watch_room_links from public, anon, authenticated;

-- 2. COPY LINK and REFRESH LINK --------------------------------------------------------------------------------------
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

  select r.id into own from public.watch_rooms r where r.origin = 'music' and r.host_id = auth.uid();
  if own is null then return null; end if;

  select l.token into held from public.watch_room_links l where l.room_id = own;
  if held is not null and not refresh then return held; end if;

  -- 64 characters from two random ids: far too long to guess.
  held := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  -- A refresh only changes the secret (Luke, 2026-11-14: "B: Only stops new people"): the old link lets nobody new in,
  -- and whoever is already a member stays one until the owner uses REMOVE. Nothing is deleted here.
  insert into public.watch_room_links (room_id, token) values (own, held)
  on conflict (room_id) do update set token = excluded.token, made_at = now();

  return held;
end;
$$;
revoke all on function public.watch_own_link(boolean) from public, anon;
grant execute on function public.watch_own_link(boolean) to authenticated, service_role;

-- 3. Joining by the link ---------------------------------------------------------------------------------------------
-- Accounts only (a guest and a signed-out visitor are told to log in). Null for a secret that is not current.
create or replace function public.watch_join_link(link text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  joined_room uuid;
  caller_label text;
begin
  if caller is null or public.is_banned() or public.is_guest() then return null; end if;
  if link is null or char_length(link) not between 32 and 64 then return null; end if;

  select l.room_id into joined_room
    from public.watch_room_links l join public.watch_rooms r on r.id = l.room_id
   where l.token = link and r.origin = 'music' and r.ended_at is null;
  if joined_room is null then return null; end if;

  if exists (select 1 from public.watch_members m where m.room_id = joined_room and m.user_id = caller and m.removed_at is not null) then
    return null;
  end if;

  select coalesce(nullif(p.display_name, ''), 'Unknown') into caller_label from public.profiles p where p.id = caller;
  insert into public.watch_members (room_id, user_id, label) values (joined_room, caller, coalesce(caller_label, 'Unknown'))
  on conflict (room_id, user_id) do nothing;
  return joined_room;
end;
$$;
revoke all on function public.watch_join_link(text) from public, anon;
grant execute on function public.watch_join_link(text) to authenticated, service_role;

-- 4. The door and the way in -----------------------------------------------------------------------------------------
-- The door of 20261114145645_own_rooms_and_pictures.sql, which found an own room for its owner only: its members too.
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
    and (r.origin <> 'music' or r.host_id = auth.uid() or exists (select 1 from public.watch_members m where m.room_id = r.id and m.user_id = auth.uid()));
$$;
revoke all on function public.watch_room_door(uuid) from public;
grant execute on function public.watch_room_door(uuid) to anon, authenticated, service_role;

-- The way in of 20261106194444_guests_in_streams.sql with one condition on its first read: an own room is found only
-- by its owner and its members, so anybody else gets `refused`, the answer for an address that is no room (it said
-- `ended`, which told them a room was there). An own room is entered by its link (`watch_join_link`), never here.
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
      and (r.origin <> 'music' or r.host_id = caller or exists (select 1 from public.watch_members m where m.room_id = r.id and m.user_id = caller));
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

-- 5. A member adds to an own room's queue ----------------------------------------------------------------------------
-- The rule of 20261105145655_private_streams.sql with one more way past its "is the room on" line: an own room is
-- never public, so its members (`room_may_talk` has already checked they belong and were not removed) are let
-- through by its kind. The rest is as it was: without a crown a row waits on its adder's own list.
drop policy if exists "watch queue added to by an account" on public.watch_queue;
create policy "watch queue added to by an account" on public.watch_queue
  for insert to authenticated
  with check (
    added_by = auth.uid()
    and public.room_may_talk(room_id)
    and exists (
      select 1 from public.watch_rooms r
      where r.id = watch_queue.room_id and r.ended_at is null and (r.is_public or r.host_id = auth.uid() or r.origin = 'music')
        and (r.add_mode = 'anyone' or r.host_id = auth.uid() or exists (select 1 from public.watch_crowns c where c.room_id = watch_queue.room_id and c.user_id = auth.uid()))
    )
    and (
      (not in_queue and played_at is null and play_index is null)
      or (in_queue and played_at is null and play_index is null and exists (select 1 from public.watch_crowns c where c.room_id = watch_queue.room_id and c.user_id = auth.uid()))
      or (played_at is not null and exists (select 1 from public.watch_rooms r where r.id = watch_queue.room_id and r.host_id = auth.uid()))
    )
  );

-- 6. The cap counts members' additions too ---------------------------------------------------------------------------
create or replace function public.watch_queue_own_room_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The SQL editor and the service role have no user, as in the queue's guard.
  if auth.uid() is not null
    and exists (select 1 from public.watch_rooms r where r.id = new.room_id and r.origin = 'music' and (r.host_id = auth.uid() or public.is_room_member(r.id)))
    and (select count(*) from public.watch_queue q where q.room_id = new.room_id) >= 500 then
    raise exception 'own room queue is full' using errcode = '53400';
  end if;
  return new;
end;
$$;
revoke all on function public.watch_queue_own_room_cap() from public, anon, authenticated;

-- Afterwards, to see it landed:
--   select count(*) from public.watch_room_links;
--   select proname from pg_proc where proname in ('watch_own_link', 'watch_join_link');
