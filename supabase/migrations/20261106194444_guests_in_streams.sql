-- Guests in streams (SPEC-guests.md, Luke's OK 2026-11-06). A guest is Supabase's anonymous sign-in: a real session with no email, marked
-- `is_anonymous` in its token. Signed-in as far as Postgres roles go, so every guest rule here is written to keep them out of what accounts have, and
-- what isn't named stays shut. Safe to run again. Undo for the gate alone:
--   alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';

-- 1. Who is a guest ----------------------------------------------------------------------------------------------------
create or replace function public.is_guest()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'is_anonymous' = 'true', false);
$$;

-- 2. Rooms and tries ---------------------------------------------------------------------------------------------------
alter table public.watch_rooms add column if not exists guests_can_talk boolean not null default true;

-- Wrong passwords from guests, room by room. Each person's own five tries are cheap for a guest to start over, so guests share this count too.
create table if not exists public.watch_guest_tries (
  room_id uuid primary key references public.watch_rooms (id) on delete cascade,
  tries integer not null default 0,
  window_started_at timestamptz not null default now(),
  locked_until timestamptz
);
alter table public.watch_guest_tries enable row level security;
revoke all on public.watch_guest_tries from public, anon, authenticated;

-- 3. What guests can read and hear -------------------------------------------------------------------------------------
-- Everything but the room's own tables is shut to a guest, table by table, because live changes and embedded reads don't pass through the gate below.
do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
      and c.relname not in ('watch_rooms', 'watch_messages', 'watch_queue', 'watch_crowns', 'watch_members', 'room_canvases', 'room_canvas_inputs', 'room_canvas_snapshots')
  loop
    execute format('drop policy if exists "guests stay out" on public.%I', t.relname);
    execute format('create policy "guests stay out" on public.%I as restrictive for select to authenticated using (not (select public.is_guest()))', t.relname);
  end loop;
end $$;

drop policy if exists "guests hear only rooms" on realtime.messages;
create policy "guests hear only rooms" on realtime.messages
  as restrictive for select to authenticated
  using (not (select public.is_guest()) or realtime.topic() like 'watch:%' or realtime.topic() like 'canvas:%');

drop policy if exists "guests say only room presence" on realtime.messages;
create policy "guests say only room presence" on realtime.messages
  as restrictive for insert to authenticated
  with check (not (select public.is_guest()) or (extension = 'presence' and realtime.topic() like 'watch:%'));

drop policy if exists "guests upload nothing" on storage.objects;
create policy "guests upload nothing" on storage.objects
  as restrictive for insert to authenticated
  with check (not (select public.is_guest()));

drop policy if exists "guests change no files" on storage.objects;
create policy "guests change no files" on storage.objects
  as restrictive for update to authenticated
  using (not (select public.is_guest()))
  with check (not (select public.is_guest()));

drop policy if exists "guests delete no files" on storage.objects;
create policy "guests delete no files" on storage.objects
  as restrictive for delete to authenticated
  using (not (select public.is_guest()));

drop policy if exists "guests read only stream art files" on storage.objects;
create policy "guests read only stream art files" on storage.objects
  as restrictive for select to authenticated
  using (not (select public.is_guest()) or bucket_id = 'stream-art');

-- 4. A guest's record --------------------------------------------------------------------------------------------------
-- As before for accounts. A guest gets a hidden profile, which room membership points at, no welcome tag, and no name from the browser.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  chosen_name text;
  is_house boolean;
begin
  if new.is_anonymous then
    insert into public.profiles (id, display_name, is_hidden)
    values (new.id, 'GUEST-' || upper(substr(md5(new.id::text), 1, 3)), true)
    on conflict (id) do nothing;
    return new;
  end if;

  is_house := lower(coalesce(new.email, '')) = 'admin1212@debaser.site';

  chosen_name := case
    when is_house then 'debaser.site'
    else coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Anonymous'
    )
  end;

  insert into public.profiles (id, display_name, name_colour)
  values (new.id, chosen_name, case when is_house then '#1d3ca6' else null end)
  on conflict (id) do nothing;

  -- The welcome tag. Its id is derived from the profile it belongs to, which is what
  -- makes the insert idempotent: running this again cannot file a second welcome.
  --
  -- The giver is looked up rather than assumed, because this trigger also fires for
  -- the house account itself and the two accounts can be created in either order.
  -- `given_by` is nullable, so a missing house account leaves a null giver - which
  -- the app still reads as an approved tag, because what makes a tag pending is the
  -- *owner* having given it to themselves.
  insert into public.profile_tags (id, user_id, label, colour, given_by, given_by_label, hidden)
  values (
    md5('tag-default-new-here:' || new.id::text)::uuid,
    new.id,
    'NEW HERE',
    '#1d3ca6',
    (select id from auth.users where lower(email) = 'admin1212@debaser.site' limit 1),
    'debaser.site',
    false
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- What two names are compared by: no capitals, spaces or punctuation, and lookalike characters made one.
create or replace function public.guest_name_key(name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(translate(lower(coalesce(name, '')), '01i35', 'olles'), '[^a-z0-9]', '', 'g');
$$;
revoke all on function public.guest_name_key(text) from public, anon, authenticated;

create or replace function public.guest_self()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'label', p.display_name, 'named', p.display_name like '% [GUEST]')
  from public.profiles p
  where public.is_guest() and p.id = auth.uid();
$$;
revoke all on function public.guest_self() from public, anon;
grant execute on function public.guest_self() to authenticated, service_role;

-- Picks the guest's name, once: `named`, `bad` (its shape or a house word), `taken` or `refused`. The database adds [GUEST] and the guest can't take it off.
create or replace function public.guest_set_name(wanted text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  clean text := btrim(regexp_replace(coalesce(wanted, ''), '\s+', ' ', 'g'));
  key text;
  shown text;
begin
  if caller is null or not public.is_guest() or public.is_banned() then return 'refused'; end if;
  if exists (select 1 from public.profiles p where p.id = caller and p.display_name like '% [GUEST]') then return 'refused'; end if;

  if clean !~ '^[A-Za-z0-9_-][A-Za-z0-9 _-]{0,18}[A-Za-z0-9_-]$' then return 'bad'; end if;
  key := public.guest_name_key(clean);
  -- `key` has its lookalikes made one already, so admin reads admln here.
  if length(key) < 2 or key ~ '^(guest|anon)' or key ~ '(admln|debaser)' or key in ('formerguest', 'host', 'mod', 'moderator', 'staff', 'owner', 'system', 'unknown') then
    return 'bad';
  end if;

  -- Two guests asking for one name at once take turns.
  perform pg_advisory_xact_lock(hashtextextended('guest-name:' || key, 0));
  if exists (
    select 1 from public.profiles p
    where public.guest_name_key(p.display_name) in (key, key || 'guest')
  ) then
    return 'taken';
  end if;

  shown := clean || ' [GUEST]';
  update public.profiles p set display_name = shown where p.id = caller;
  update public.watch_members m set label = shown where m.user_id = caller;
  return 'named';
end;
$$;
revoke all on function public.guest_set_name(text) from public, anon;
grant execute on function public.guest_set_name(text) to authenticated, service_role;

-- 5. Talking -----------------------------------------------------------------------------------------------------------
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
    and exists (
      select 1 from public.watch_rooms r
      where r.id = room
        and (r.privacy = 'open' or public.is_room_member(room))
        and (r.guests_can_talk or not public.is_guest())
    );
$$;

-- A guest's line carries the name the database holds, needs one, and is slowed: 5 in 10 seconds, 20 in a minute, 60 a minute for all a room's guests.
create or replace function public.watch_messages_guest()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  label text;
begin
  if not public.is_guest() then return new; end if;

  select p.display_name into label from public.profiles p where p.id = caller;
  if label is null or label not like '% [GUEST]' then
    raise exception 'a guest needs a name' using errcode = 'GT401';
  end if;
  -- A line that is one link can draw as a picture, and pictures are for accounts.
  if btrim(new.body) ~ '^[a-zA-Z][a-zA-Z0-9+.-]*://\S+$' then
    raise exception 'no pictures' using errcode = 'GT415';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('guest-line:' || caller::text, 0));
  if (select count(*) from public.watch_messages m where m.author_id = caller and m.created_at > now() - interval '10 seconds') >= 5
    or (select count(*) from public.watch_messages m where m.author_id = caller and m.created_at > now() - interval '1 minute') >= 20
    or (select count(*) from public.watch_messages m where m.room_id = new.room_id and m.created_at > now() - interval '1 minute' and m.author_label like '% [GUEST]') >= 60
  then
    raise exception 'slow down' using errcode = 'GT429';
  end if;

  new.author_label := label;
  return new;
end;
$$;
revoke all on function public.watch_messages_guest() from public, anon, authenticated;
drop trigger if exists watch_messages_guest on public.watch_messages;
create trigger watch_messages_guest before insert on public.watch_messages for each row execute function public.watch_messages_guest();

-- GUESTS CAN TALK: the host's and a crown's, on a live room.
create or replace function public.watch_room_guests_talk(room uuid, allowed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.is_banned() or public.is_guest() or allowed is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.watch_rooms r
     set guests_can_talk = allowed,
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
revoke all on function public.watch_room_guests_talk(uuid, boolean) from public, anon;
grant execute on function public.watch_room_guests_talk(uuid, boolean) to authenticated, service_role;

-- 6. The door ----------------------------------------------------------------------------------------------------------
-- A visitor and a guest learn no room name until they are in, and see when a room has shut its door to guests.
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
  left join public.watch_rooms r on r.id = q.asked;
$$;

-- The way in, as before, plus a guest's wrong tries counting for the room: 20 in 10 minutes shuts guests out for 10 minutes.
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

  select r.privacy, r.ended_at, r.is_public into setting, ended, switched_on from public.watch_rooms r where r.id = room;
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

-- 7. The gate ----------------------------------------------------------------------------------------------------------
-- Runs before every request to the database's web route. Anybody who isn't a guest goes straight through on the first line.
-- A guest gets only what is named here. New tables and functions stay shut to guests without anybody remembering them.
create or replace function public.guest_request_gate()
returns void
language plpgsql
set search_path = ''
as $$
declare
  place text;
  method text;
begin
  if not public.is_guest() then return; end if;

  place := coalesce(current_setting('request.path', true), '');
  method := upper(coalesce(current_setting('request.method', true), ''));

  if place in (
    '/rpc/watch_room_door', '/rpc/watch_join', '/rpc/watch_room_outline', '/rpc/watch_private_rooms', '/rpc/stream_record_outline',
    '/rpc/private_stream_folds', '/rpc/watch_now', '/rpc/watch_close_stale', '/rpc/guest_self', '/rpc/guest_set_name'
  ) then
    return;
  end if;
  if method in ('GET', 'HEAD') and place in (
    '/watch_rooms', '/watch_messages', '/watch_queue', '/watch_crowns', '/watch_members', '/room_canvases', '/room_canvas_inputs', '/room_canvas_snapshots'
  ) then
    return;
  end if;
  if method = 'POST' and place = '/watch_messages' then return; end if;

  raise exception 'guests cannot do that' using errcode = '42501';
end;
$$;

alter role authenticator set pgrst.db_pre_request = 'public.guest_request_gate';
notify pgrst, 'reload config';
