-- Privacy plan, phase 3 (SPEC-privacy-phase-3.md): what outsiders see, built by the database. Tags, times, three sizes and counts come out of
-- these functions; words, names, titles and a room's link never do.
--
--   1. Each member gets a random tag for that room.
--   2. A stream's forum thread knows its room, and threads and replies remember whether they were made in private.
--   3. Those are their room's members', the house account included (decision 8). Nobody outside replies, or is told about a reply.
--   4. Five functions hand out the outsider's version.
--
-- Nothing is deleted. What is on the board today stays as readable as it was: existing threads and replies are marked open.
-- Re-runnable: `if not exists`, constraints and policies dropped and recreated by name, functions replaced.

-- 1. ANON tags ---------------------------------------------------------------------------------------------------------
alter table public.watch_members add column if not exists anon_number integer;

-- Random rather than in joining order, so the host isn't the same number in every room and a tag can't be followed from room to room.
create or replace function public.watch_member_anon_number(room uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  picked integer;
begin
  for attempt in 1..50 loop
    picked := 1 + floor(random() * 999)::integer;
    if not exists (select 1 from public.watch_members m where m.room_id = room and m.anon_number = picked) then
      return picked;
    end if;
  end loop;
  return picked;
end;
$$;
revoke all on function public.watch_member_anon_number(uuid) from public, anon, authenticated;

create or replace function public.watch_members_tag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.anon_number is null then new.anon_number := public.watch_member_anon_number(new.room_id); end if;
  return new;
end;
$$;
revoke all on function public.watch_members_tag() from public, anon, authenticated;
drop trigger if exists watch_members_tag on public.watch_members;
create trigger watch_members_tag before insert on public.watch_members for each row execute function public.watch_members_tag();

do $$
declare
  member record;
begin
  for member in select room_id, user_id from public.watch_members where anon_number is null loop
    update public.watch_members m
      set anon_number = public.watch_member_anon_number(member.room_id)
      where m.room_id = member.room_id and m.user_id = member.user_id;
  end loop;
end $$;

-- 2. The board's stream threads -----------------------------------------------------------------------------------------
alter table public.forum_threads add column if not exists watch_room_id uuid references public.watch_rooms (id) on delete set null;
alter table public.forum_threads add column if not exists privacy_at_write text not null default 'open';
alter table public.forum_threads drop constraint if exists forum_threads_privacy_at_write;
alter table public.forum_threads add constraint forum_threads_privacy_at_write check (privacy_at_write in ('private', 'open'));
create index if not exists forum_threads_watch_room on public.forum_threads (watch_room_id) where watch_room_id is not null;

alter table public.forum_comments add column if not exists privacy_at_write text not null default 'open';
alter table public.forum_comments drop constraint if exists forum_comments_privacy_at_write;
alter table public.forum_comments add constraint forum_comments_privacy_at_write check (privacy_at_write in ('private', 'open'));

-- Threads that exist today are tied to their rooms, and stay open.
update public.forum_threads t set watch_room_id = r.id
  from public.watch_rooms r
  where t.watch_room_id is null and t.anchor_kind = 'board' and t.anchor_id = 'watch:' || r.id::text and t.author_id = r.original_host_id;

-- Stamped by the database, whatever a browser sends. Only the room's own host can tie a thread to it.
create or replace function public.forum_threads_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  setting text;
  room uuid;
begin
  if tg_op = 'UPDATE' then
    -- A person's own edit keeps both. A room deleted sets the link null from a trigger inside that delete, deeper than 1, and gets through.
    if pg_trigger_depth() = 1 then new.watch_room_id := old.watch_room_id; end if;
    new.privacy_at_write := old.privacy_at_write;
    return new;
  end if;

  new.watch_room_id := null;
  new.privacy_at_write := 'open';
  if new.anchor_kind = 'board' and new.anchor_id ~ '^watch:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select r.id, r.privacy into room, setting
    from public.watch_rooms r
    where r.id = substr(new.anchor_id, 7)::uuid and r.original_host_id = new.author_id;
    if room is not null then
      new.watch_room_id := room;
      new.privacy_at_write := case when setting = 'open' then 'open' else 'private' end;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.forum_threads_stamp() from public, anon, authenticated;
drop trigger if exists forum_threads_stamp on public.forum_threads;
create trigger forum_threads_stamp before insert or update on public.forum_threads for each row execute function public.forum_threads_stamp();

create or replace function public.forum_comments_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stamped text;
  setting text;
begin
  if tg_op = 'UPDATE' then
    new.privacy_at_write := old.privacy_at_write;
    return new;
  end if;
  select t.privacy_at_write, r.privacy into stamped, setting
  from public.forum_threads t left join public.watch_rooms r on r.id = t.watch_room_id
  where t.id = new.thread_id;
  new.privacy_at_write := case when stamped = 'private' or setting in ('private', 'password') then 'private' else 'open' end;
  return new;
end;
$$;
revoke all on function public.forum_comments_stamp() from public, anon, authenticated;
drop trigger if exists forum_comments_stamp on public.forum_comments;
create trigger forum_comments_stamp before insert or update on public.forum_comments for each row execute function public.forum_comments_stamp();

-- 3. The rules ---------------------------------------------------------------------------------------------------------
create or replace function public.forum_thread_is_member(thread uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.forum_threads t where t.id = thread and t.watch_room_id is not null and public.is_room_member(t.watch_room_id));
$$;
revoke all on function public.forum_thread_is_member(uuid) from public;
grant execute on function public.forum_thread_is_member(uuid) to anon, authenticated, service_role;

-- Anybody on an ordinary thread. On a stream's record while its room or the record is private: its members.
create or replace function public.forum_thread_may_reply(thread uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.forum_threads t left join public.watch_rooms r on r.id = t.watch_room_id
    where t.id = thread
      and ((t.privacy_at_write = 'open' and coalesce(r.privacy, 'open') = 'open') or public.is_room_member(t.watch_room_id))
  );
$$;
revoke all on function public.forum_thread_may_reply(uuid) from public;
grant execute on function public.forum_thread_may_reply(uuid) to anon, authenticated, service_role;

-- Whether this account may be told about something on this thread.
create or replace function public.forum_thread_may_tell(thread uuid, person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.forum_threads t left join public.watch_rooms r on r.id = t.watch_room_id
    where t.id = thread
      and (t.privacy_at_write = 'private' or coalesce(r.privacy, 'open') <> 'open')
      and not exists (select 1 from public.watch_members m where m.room_id = t.watch_room_id and m.user_id = person and m.removed_at is null)
  );
$$;
revoke all on function public.forum_thread_may_tell(uuid, uuid) from public;
grant execute on function public.forum_thread_may_tell(uuid, uuid) to authenticated, service_role;

drop policy if exists "forum_threads readable" on public.forum_threads;
create policy "forum_threads readable" on public.forum_threads
  for select
  using (
    (author_id is null or not public.is_banned(author_id) or public.is_admin())
    and (privacy_at_write = 'open' or public.is_room_member(watch_room_id))
  );

drop policy if exists "forum_comments readable" on public.forum_comments;
create policy "forum_comments readable" on public.forum_comments
  for select
  using (
    (author_id is null or not public.is_banned(author_id) or public.is_admin())
    and exists (select 1 from public.forum_threads t where t.id = forum_comments.thread_id)
    and (privacy_at_write = 'open' or public.forum_thread_is_member(thread_id))
  );

drop policy if exists "forum_comments insert own" on public.forum_comments;
create policy "forum_comments insert own" on public.forum_comments
  for insert
  with check (author_id = auth.uid() and not public.is_banned() and public.forum_thread_may_reply(thread_id));

drop policy if exists "forum_notifications inserted by actor" on public.forum_notifications;
create policy "forum_notifications inserted by actor" on public.forum_notifications
  for insert
  with check (
    not public.is_banned() and actor_id = auth.uid() and user_id <> auth.uid()
    and (thread_id is null or public.forum_thread_may_tell(thread_id, user_id))
  );

-- 4. The outsider's version --------------------------------------------------------------------------------------------
create or replace function public.watch_size_of(words text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when char_length(words) <= 20 then 'short' when char_length(words) <= 80 then 'medium' else 'long' end;
$$;
revoke all on function public.watch_size_of(text) from public, anon, authenticated;

-- One room's lines: its tag, how long into the stream, how big. No words.
create or replace function public.watch_outline_lines(room uuid, how_many integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('tag', l.tag, 'seconds', l.seconds, 'size', l.size) order by l.created_at), '[]'::jsonb)
  from (
    select
      'ANON-' || coalesce(mem.anon_number::text, '0') as tag,
      greatest(extract(epoch from m.created_at - r.started_at), 0)::integer as seconds,
      public.watch_size_of(m.body) as size,
      m.created_at
    from public.watch_messages m
    join public.watch_rooms r on r.id = m.room_id
    left join public.watch_members mem on mem.room_id = m.room_id and mem.user_id = m.author_id
    where m.room_id = room
    order by m.created_at desc
    limit how_many
  ) l;
$$;
revoke all on function public.watch_outline_lines(uuid, integer) from public, anon, authenticated;

-- A private room, for somebody who has its link. Empty for an open room, which has no need of one.
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
  where r.id = room and r.privacy <> 'open';
$$;
revoke all on function public.watch_room_outline(uuid) from public;
grant execute on function public.watch_room_outline(uuid) to anon, authenticated, service_role;

-- The ROOM tab: private rooms that are live, and that this person isn't in. Counts only, and no link: the link is the key.
create or replace function public.watch_private_rooms()
returns table (joined bigint, messages bigint, strokes bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.watch_members m where m.room_id = r.id and m.removed_at is null),
    (select count(*) from public.watch_messages x where x.room_id = r.id),
    (select count(*) from public.room_canvas_inputs i join public.room_canvases c on c.id = i.canvas_id where c.room_id = r.id)
  from public.watch_rooms r
  where r.ended_at is null and r.origin = 'stream' and r.privacy <> 'open'
    and r.updated_at > now() - interval '30 minutes'
    and not public.is_room_member(r.id)
  order by 1 desc
  limit 50;
$$;
revoke all on function public.watch_private_rooms() from public;
grant execute on function public.watch_private_rooms() to anon, authenticated, service_role;

-- The board: private records this person can't read, each with the day it started and how many lines. Never a title, an author or a room.
create or replace function public.stream_record_outlines()
returns table (thread_id uuid, on_day timestamptz, messages bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, date_trunc('day', t.created_at), (select count(*) from public.watch_messages m where m.room_id = t.watch_room_id)
  from public.forum_threads t
  where t.privacy_at_write = 'private' and t.watch_room_id is not null
    and not public.is_room_member(t.watch_room_id)
    and (t.author_id is null or not public.is_banned(t.author_id))
  order by t.created_at desc
  limit 200;
$$;
revoke all on function public.stream_record_outlines() from public;
grant execute on function public.stream_record_outlines() to anon, authenticated, service_role;

create or replace function public.stream_record_outline(thread uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.watch_outline_lines(t.watch_room_id, 300)
  from public.forum_threads t
  where t.id = thread and t.privacy_at_write = 'private' and t.watch_room_id is not null;
$$;
revoke all on function public.stream_record_outline(uuid) from public;
grant execute on function public.stream_record_outline(uuid) to anon, authenticated, service_role;

-- STREAM CHAT under a file: private streams that played it, and the size of what was said over it.
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
        where m.media_item_id = q.media_item_id and m.privacy_at_write = 'private' and not public.is_room_member(r.id)
        order by m.created_at
        limit 100
      ) l
    )
  from public.watch_queue q join public.watch_rooms r on r.id = q.room_id
  where q.media_item_id = any (media_ids[1:100])
    and q.played_at is not null and q.privacy_at_write = 'private'
    and not public.is_room_member(r.id)
  group by q.media_item_id;
$$;
revoke all on function public.private_stream_folds(uuid[]) from public;
grant execute on function public.private_stream_folds(uuid[]) to anon, authenticated, service_role;
