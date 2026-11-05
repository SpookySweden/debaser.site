-- Privacy plan, phase 2 (SPEC-privacy-phase-2.md): private streams.
--
--   1. Each room says who can join; each thing said, queued or drawn remembers the room's setting when it was made.
--   2. Members, and two tables no reader can reach: scrambled passwords and wrong-password counts.
--   3. The way in, the setting, and removing someone are functions; a room's setting can't be changed by writing to the room.
--   4. Read and write rules: open items to anyone, private items to members, no special path for any account (decision 8).
--
-- Nothing is deleted. Rooms and rows that exist today are marked open and stay as readable as they were.
-- Re-runnable: `if not exists`, constraints and policies dropped and recreated by name, functions replaced.

-- 1. The setting -------------------------------------------------------------------------------------------------------
-- A new column takes the first default on the rows already there; new rows get the second.
alter table public.watch_rooms add column if not exists privacy text not null default 'open';
alter table public.watch_rooms alter column privacy set default 'private';
alter table public.watch_rooms drop constraint if exists watch_rooms_privacy;
alter table public.watch_rooms add constraint watch_rooms_privacy check (privacy in ('private', 'password', 'open'));

alter table public.watch_messages add column if not exists privacy_at_write text not null default 'open';
alter table public.watch_messages alter column privacy_at_write set default 'private';
alter table public.watch_messages drop constraint if exists watch_messages_privacy_at_write;
alter table public.watch_messages add constraint watch_messages_privacy_at_write check (privacy_at_write in ('private', 'open'));

alter table public.watch_queue add column if not exists privacy_at_write text not null default 'open';
alter table public.watch_queue alter column privacy_at_write set default 'private';
alter table public.watch_queue drop constraint if exists watch_queue_privacy_at_write;
alter table public.watch_queue add constraint watch_queue_privacy_at_write check (privacy_at_write in ('private', 'open'));

alter table public.room_canvases add column if not exists privacy_at_write text not null default 'open';
alter table public.room_canvases alter column privacy_at_write set default 'private';
alter table public.room_canvases drop constraint if exists room_canvases_privacy_at_write;
alter table public.room_canvases add constraint room_canvases_privacy_at_write check (privacy_at_write in ('private', 'open'));

alter table public.room_canvas_inputs add column if not exists privacy_at_write text not null default 'open';
alter table public.room_canvas_inputs alter column privacy_at_write set default 'private';
alter table public.room_canvas_inputs drop constraint if exists room_canvas_inputs_privacy_at_write;
alter table public.room_canvas_inputs add constraint room_canvas_inputs_privacy_at_write check (privacy_at_write in ('private', 'open'));

alter table public.room_canvas_snapshots add column if not exists privacy_at_write text not null default 'open';
alter table public.room_canvas_snapshots alter column privacy_at_write set default 'private';
alter table public.room_canvas_snapshots drop constraint if exists room_canvas_snapshots_privacy_at_write;
alter table public.room_canvas_snapshots add constraint room_canvas_snapshots_privacy_at_write check (privacy_at_write in ('private', 'open'));

-- Stamped by the database, whatever a browser sends.
create or replace function public.watch_stamp_privacy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  setting text;
begin
  select r.privacy into setting from public.watch_rooms r where r.id = new.room_id;
  new.privacy_at_write := case when setting = 'open' then 'open' else 'private' end;
  return new;
end;
$$;

create or replace function public.room_canvas_stamp_privacy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  setting text;
begin
  select r.privacy into setting
  from public.room_canvases c join public.watch_rooms r on r.id = c.room_id
  where c.id = new.canvas_id;
  new.privacy_at_write := case when setting = 'open' then 'open' else 'private' end;
  return new;
end;
$$;

revoke all on function public.watch_stamp_privacy() from public, anon, authenticated;
revoke all on function public.room_canvas_stamp_privacy() from public, anon, authenticated;

drop trigger if exists watch_messages_stamp_privacy on public.watch_messages;
create trigger watch_messages_stamp_privacy before insert on public.watch_messages for each row execute function public.watch_stamp_privacy();
drop trigger if exists watch_queue_stamp_privacy on public.watch_queue;
create trigger watch_queue_stamp_privacy before insert on public.watch_queue for each row execute function public.watch_stamp_privacy();
drop trigger if exists room_canvases_stamp_privacy on public.room_canvases;
create trigger room_canvases_stamp_privacy before insert on public.room_canvases for each row execute function public.watch_stamp_privacy();
drop trigger if exists room_canvas_inputs_stamp_privacy on public.room_canvas_inputs;
create trigger room_canvas_inputs_stamp_privacy before insert on public.room_canvas_inputs for each row execute function public.room_canvas_stamp_privacy();
drop trigger if exists room_canvas_snapshots_stamp_privacy on public.room_canvas_snapshots;
create trigger room_canvas_snapshots_stamp_privacy before insert on public.room_canvas_snapshots for each row execute function public.room_canvas_stamp_privacy();

-- 2. Members and the locked tables -------------------------------------------------------------------------------------
create table if not exists public.watch_members (
  room_id uuid not null references public.watch_rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  label text not null default '',
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles (id) on delete set null,
  primary key (room_id, user_id)
);
create index if not exists watch_members_user on public.watch_members (user_id);
alter table public.watch_members enable row level security;
revoke all on public.watch_members from public, anon, authenticated;
grant select on public.watch_members to authenticated;

create table if not exists public.watch_room_passwords (
  room_id uuid primary key references public.watch_rooms (id) on delete cascade,
  password_hash text not null,
  set_at timestamptz not null default now()
);
alter table public.watch_room_passwords enable row level security;
revoke all on public.watch_room_passwords from public, anon, authenticated;

create table if not exists public.watch_join_attempts (
  room_id uuid not null references public.watch_rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  tries integer not null default 0,
  locked_until timestamptz,
  primary key (room_id, user_id)
);
alter table public.watch_join_attempts enable row level security;
revoke all on public.watch_join_attempts from public, anon, authenticated;

-- Definer functions, so the rules that call them don't call themselves.
create or replace function public.is_room_member(room uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.watch_members m
    where m.room_id = room and m.user_id = auth.uid() and m.removed_at is null
  );
$$;
revoke all on function public.is_room_member(uuid) from public;
grant execute on function public.is_room_member(uuid) to anon, authenticated, service_role;

-- Whether this person may say, add or draw anything in this room: signed in, not banned, not removed, and it is open or they belong.
create or replace function public.room_may_talk(room uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and not public.is_banned()
    and not exists (select 1 from public.watch_members m where m.room_id = room and m.user_id = auth.uid() and m.removed_at is not null)
    and exists (select 1 from public.watch_rooms r where r.id = room and (r.privacy = 'open' or public.is_room_member(room)));
$$;
revoke all on function public.room_may_talk(uuid) from public;
grant execute on function public.room_may_talk(uuid) to authenticated, service_role;

drop policy if exists "room members seen by members" on public.watch_members;
create policy "room members seen by members" on public.watch_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_room_member(room_id));

-- The host always belongs, including a new host after a handover.
create or replace function public.watch_rooms_member_host()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.host_id is distinct from old.host_id then
    insert into public.watch_members (room_id, user_id, label)
    values (new.id, new.host_id, coalesce((select nullif(p.display_name, '') from public.profiles p where p.id = new.host_id), 'Unknown'))
    on conflict (room_id, user_id) do update set removed_at = null, removed_by = null;
  end if;
  return null;
end;
$$;
revoke all on function public.watch_rooms_member_host() from public, anon, authenticated;
drop trigger if exists watch_rooms_member_host on public.watch_rooms;
create trigger watch_rooms_member_host after insert or update of host_id on public.watch_rooms for each row execute function public.watch_rooms_member_host();

-- The hosts of rooms that exist today belong too. Nothing else is written for them.
insert into public.watch_members (room_id, user_id, label)
  select r.id, r.host_id, coalesce(nullif(p.display_name, ''), 'Unknown')
  from public.watch_rooms r join public.profiles p on p.id = r.host_id
  on conflict (room_id, user_id) do nothing;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'watch_members') then
    alter publication supabase_realtime add table public.watch_members;
  end if;
end $$;

-- 3. The functions -----------------------------------------------------------------------------------------------------
-- What a person with the link may know before they are in. An unnamed room is THIS ROOM, and a visitor with no session is told no name.
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
    case when r.id is null or auth.uid() is null then null else coalesce(r.name, 'THIS ROOM') end,
    public.is_room_member(room),
    exists (select 1 from public.watch_members m where m.room_id = room and m.user_id = auth.uid() and m.removed_at is not null),
    (select a.locked_until from public.watch_join_attempts a where a.room_id = room and a.user_id = auth.uid() and a.locked_until > now())
  from (select room as asked) q
  left join public.watch_rooms r on r.id = q.asked;
$$;
revoke all on function public.watch_room_door(uuid) from public;
grant execute on function public.watch_room_door(uuid) to anon, authenticated, service_role;

-- The way in: `joined`, `wrong`, `locked`, `removed`, `ended` or `refused`. Five wrong tries lock that person out of that room for ten minutes.
create or replace function public.watch_join(room uuid, password text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  setting text;
  ended timestamptz;
  switched_on boolean;
  stored text;
  attempt public.watch_join_attempts%rowtype;
  caller_label text;
begin
  if caller is null or public.is_banned() then return 'refused'; end if;

  select r.privacy, r.ended_at, r.is_public into setting, ended, switched_on from public.watch_rooms r where r.id = room;
  if setting is null then return 'refused'; end if;

  if exists (select 1 from public.watch_members m where m.room_id = room and m.user_id = caller and m.removed_at is not null) then
    return 'removed';
  end if;
  if public.is_room_member(room) then return 'joined'; end if;
  if ended is not null or not switched_on then return 'ended'; end if;

  if setting = 'password' then
    insert into public.watch_join_attempts (room_id, user_id) values (room, caller) on conflict (room_id, user_id) do nothing;
    -- Held until this answer is written, so tries sent at once are counted one by one.
    select * into attempt from public.watch_join_attempts a where a.room_id = room and a.user_id = caller for update;
    if attempt.locked_until is not null and attempt.locked_until > now() then return 'locked'; end if;

    select s.password_hash into stored from public.watch_room_passwords s where s.room_id = room;
    if stored is null or password is null or extensions.crypt(password, stored) <> stored then
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

-- REMOVE: the host's and a crown's, on a live room. Never the host.
create or replace function public.watch_remove_member(room uuid, person uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_label text;
begin
  if auth.uid() is null or public.is_banned() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.watch_rooms r
    where r.id = room and r.ended_at is null and r.host_id <> person
      and (r.host_id = auth.uid() or exists (select 1 from public.watch_crowns c where c.room_id = room and c.user_id = auth.uid()))
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select coalesce(nullif(p.display_name, ''), 'Unknown') into caller_label from public.profiles p where p.id = person;
  insert into public.watch_members (room_id, user_id, label, removed_at, removed_by)
  values (room, person, coalesce(caller_label, 'Unknown'), now(), auth.uid())
  on conflict (room_id, user_id) do update set removed_at = now(), removed_by = auth.uid();
  delete from public.watch_crowns c where c.room_id = room and c.user_id = person;
end;
$$;
revoke all on function public.watch_remove_member(uuid, uuid) from public, anon;
grant execute on function public.watch_remove_member(uuid, uuid) to authenticated, service_role;

-- A stream room's setting moves only through the function above. A music room's follows its GO PUBLIC switch.
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
  if old.forum_thread_id is not null then new.forum_thread_id := old.forum_thread_id; end if;
  if old.ended_at is not null then new.ended_at := old.ended_at; end if;
  if old.origin = 'music' then
    new.host_id := old.host_id;
    new.ended_at := null;
    new.privacy := case when new.is_public then 'open' else 'private' end;
  else
    new.is_public := true;
    -- Set only by watch_room_set_privacy, below, for the length of its own update. A person's request can't reach set_config.
    if coalesce(current_setting('debaser.room_privacy', true), '') <> 'on' then new.privacy := old.privacy; end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- WHO CAN JOIN and CHANGE PASSWORD: the host's, on a live stream room. A null password keeps the one already set.
create or replace function public.watch_room_set_privacy(room uuid, new_privacy text, new_password text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.is_banned() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if new_privacy is null or new_privacy not in ('private', 'password', 'open') then
    raise exception 'not allowed' using errcode = '22023';
  end if;
  if not exists (select 1 from public.watch_rooms r where r.id = room and r.host_id = auth.uid() and r.ended_at is null and r.origin = 'stream') then
    raise exception 'not allowed' using errcode = '42501';
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
  update public.watch_rooms r set privacy = new_privacy where r.id = room;
  perform set_config('debaser.room_privacy', '', true);
end;
$$;
revoke all on function public.watch_room_set_privacy(uuid, text, text) from public, anon;
grant execute on function public.watch_room_set_privacy(uuid, text, text) to authenticated, service_role;

-- Take over only a room you may be in.
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
  update public.watch_rooms
    set host_id = auth.uid()
    where id = room and origin = 'stream' and ended_at is null and host_id = gone_host and host_id <> auth.uid()
      and updated_at < now() - interval '8 seconds';
  get diagnostics taken = row_count;
  return taken = 1;
end;
$$;

-- A canvas is readable when it was made open, or by a member. The house account's look at hidden ones stops at those (decision 8).
create or replace function public.room_canvas_readable(canvas uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.room_canvases c
    where c.id = canvas
      and (c.privacy_at_write = 'open' or public.is_room_member(c.room_id))
      and (c.hidden = false or public.is_admin())
  );
$$;

create or replace function public.room_canvas_is_member(canvas uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.room_canvases c where c.id = canvas and public.is_room_member(c.room_id));
$$;
revoke all on function public.room_canvas_is_member(uuid) from public, anon;
grant execute on function public.room_canvas_is_member(uuid) to authenticated, service_role;

create or replace function public.room_canvas_people(canvas uuid)
returns table (user_id uuid, crowned boolean)
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    select rc.id, rc.room_id, rc.host_id, rc.saved_by, rc.opened_at
    from public.room_canvases rc
    where rc.id = canvas and public.room_canvas_readable(rc.id)
  ),
  people as (
    select c.host_id as user_id from c
    union select c.saved_by from c where c.saved_by is not null
    union select i.author_id from public.room_canvas_inputs i join c on i.canvas_id = c.id
    union select m.author_id from public.watch_messages m join c on m.room_id = c.room_id where m.created_at >= c.opened_at
    union select m.author_id from public.watch_messages m join c on m.room_id = c.room_id
      where exists (
        select 1 from public.room_canvas_inputs i
        where i.canvas_id = c.id and i.kind = 'place' and i.data -> 'place' ->> 'type' = 'text' and i.data -> 'place' ->> 'writerId' = m.author_id::text
      )
    union select w.user_id from public.watch_crowns w join c on w.room_id = c.room_id
  )
  select p.user_id, exists (select 1 from public.watch_crowns w join c on w.room_id = c.room_id where w.user_id = p.user_id)
  from people p;
$$;

-- 4. The rules ---------------------------------------------------------------------------------------------------------
drop policy if exists "watch rooms readable" on public.watch_rooms;
create policy "watch rooms readable" on public.watch_rooms
  for select
  using (privacy = 'open' or host_id = auth.uid() or public.is_room_member(id));

drop policy if exists "watch messages readable" on public.watch_messages;
create policy "watch messages readable" on public.watch_messages
  for select
  using (privacy_at_write = 'open' or public.is_room_member(room_id));

drop policy if exists "watch queue readable" on public.watch_queue;
create policy "watch queue readable" on public.watch_queue
  for select
  using (privacy_at_write = 'open' or public.is_room_member(room_id));

drop policy if exists "watch crowns readable" on public.watch_crowns;
create policy "watch crowns readable" on public.watch_crowns
  for select
  using (exists (select 1 from public.watch_rooms r where r.id = watch_crowns.room_id));

drop policy if exists "watch messages said by an account" on public.watch_messages;
create policy "watch messages said by an account" on public.watch_messages
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.room_may_talk(room_id)
    and exists (select 1 from public.watch_rooms r where r.id = watch_messages.room_id and r.ended_at is null and (r.is_public or r.host_id = auth.uid()))
  );

-- The house account's delete stops at what was said in the open (decision 8).
drop policy if exists "watch messages removed by their author or admin" on public.watch_messages;
create policy "watch messages removed by their author or admin" on public.watch_messages
  for delete to authenticated
  using (author_id = auth.uid() or (public.is_admin() and privacy_at_write = 'open'));

drop policy if exists "watch queue added to by an account" on public.watch_queue;
create policy "watch queue added to by an account" on public.watch_queue
  for insert to authenticated
  with check (
    added_by = auth.uid()
    and public.room_may_talk(room_id)
    and exists (
      select 1 from public.watch_rooms r
      where r.id = watch_queue.room_id and r.ended_at is null and (r.is_public or r.host_id = auth.uid())
        and (r.add_mode = 'anyone' or r.host_id = auth.uid() or exists (select 1 from public.watch_crowns c where c.room_id = watch_queue.room_id and c.user_id = auth.uid()))
    )
    and (
      (not in_queue and played_at is null and play_index is null)
      or (in_queue and played_at is null and play_index is null and exists (select 1 from public.watch_crowns c where c.room_id = watch_queue.room_id and c.user_id = auth.uid()))
      or (played_at is not null and exists (select 1 from public.watch_rooms r where r.id = watch_queue.room_id and r.host_id = auth.uid()))
    )
  );

drop policy if exists "room canvases readable by accounts" on public.room_canvases;
create policy "room canvases readable by accounts" on public.room_canvases
  for select to authenticated
  using (public.room_canvas_readable(id));

drop policy if exists "room canvases opened in a live room" on public.room_canvases;
create policy "room canvases opened in a live room" on public.room_canvases
  for insert to authenticated
  with check (
    not public.is_banned()
    and opened_by = auth.uid()
    and closed_at is null and saved_at is null and saved_by is null and hidden = false and hidden_at is null
    and public.room_may_talk(room_id)
    and exists (select 1 from public.watch_rooms r where r.id = room_canvases.room_id and r.ended_at is null and r.original_host_id = r.host_id)
  );

drop policy if exists "room canvas inputs readable by accounts" on public.room_canvas_inputs;
create policy "room canvas inputs readable by accounts" on public.room_canvas_inputs
  for select to authenticated
  using (public.room_canvas_readable(canvas_id) and (privacy_at_write = 'open' or public.room_canvas_is_member(canvas_id)));

drop policy if exists "room canvas inputs added in your own name" on public.room_canvas_inputs;
create policy "room canvas inputs added in your own name" on public.room_canvas_inputs
  for insert to authenticated
  with check (
    not public.is_banned()
    and author_id = auth.uid()
    and exists (
      select 1 from public.room_canvases c join public.watch_rooms r on r.id = c.room_id
      where c.id = room_canvas_inputs.canvas_id and c.closed_at is null and r.ended_at is null and public.room_may_talk(c.room_id)
    )
  );

drop policy if exists "room canvas snapshots readable by accounts" on public.room_canvas_snapshots;
create policy "room canvas snapshots readable by accounts" on public.room_canvas_snapshots
  for select to authenticated
  using (public.room_canvas_readable(canvas_id) and (privacy_at_write = 'open' or public.room_canvas_is_member(canvas_id)));

-- The saved pictures themselves.
drop policy if exists "stream art readable by accounts" on storage.objects;
create policy "stream art readable by accounts" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'stream-art'
    and exists (select 1 from public.room_canvases c where c.id::text = (storage.foldername(objects.name))[1] and public.room_canvas_readable(c.id))
  );
