-- -----------------------------------------------------------------------------
-- Watch together: people's additions and crowns (SPEC-stream-queue.md, 2026-11-02)
-- -----------------------------------------------------------------------------
-- Run with `npm run db:push`. Re-runnable: the column is added if missing, the table is created if
-- missing, every policy, trigger and function is dropped and re-created by name, and the one insert
-- skips rows that are already there. Nothing is deleted.
--
-- Until now anything anybody added went straight into a room's queue. Now an addition waits on its
-- adder's own list (`in_queue` = false) until somebody holding a crown pulls it in (`in_queue` = true,
-- with a place). The room's host gives and takes the crowns (`watch_crowns`), their own included; the
-- database gives the host one at GO LIVE and on every change of host, so a hand-over cannot miss it.
--
-- What a crown allows: put things straight into the queue, pull additions in, reorder, take out what
-- has not played. Play, pause, seek, skip and ending stay the host's (the room row, unchanged here), and
-- only the host marks what played, crown or no crown.
--
-- Row changes: every existing queue row reads in_queue = true (the column's first default), so past
-- streams and their board records do not change; and a room live when this runs gets its host's crown,
-- so a stream in progress keeps working.

-- 1. The mark on every queue row -------------------------------------------------------

-- Existing rows are filled with true as the column is added. After that a row written without saying is
-- an addition, which can never jump the queue (and a page from before this change adds to a list).
alter table public.watch_queue add column if not exists in_queue boolean not null default true;
alter table public.watch_queue alter column in_queue set default false;

-- 2. The crowns ------------------------------------------------------------------------

create table if not exists public.watch_crowns (
  room_id uuid not null references public.watch_rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Who gave it: the host at the time, or whoever's change of host gave the new host theirs.
  given_by uuid references auth.users (id) on delete set null,
  given_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.watch_crowns enable row level security;

drop policy if exists "watch crowns readable" on public.watch_crowns;
create policy "watch crowns readable" on public.watch_crowns for select using (true);

-- Only the room's current host, while it is live, in their own name.
drop policy if exists "watch crowns given by the host" on public.watch_crowns;
create policy "watch crowns given by the host" on public.watch_crowns
  for insert to authenticated
  with check (
    not public.is_banned()
    and given_by = auth.uid()
    and exists (select 1 from public.watch_rooms r where r.id = watch_crowns.room_id and r.host_id = auth.uid() and r.ended_at is null)
  );

-- Only the room's current host takes one off, their own included. No updates.
drop policy if exists "watch crowns taken by the host" on public.watch_crowns;
create policy "watch crowns taken by the host" on public.watch_crowns
  for delete to authenticated
  using (exists (select 1 from public.watch_rooms r where r.id = watch_crowns.room_id and r.host_id = auth.uid() and r.ended_at is null));

-- The host's crown at GO LIVE and on every change of host (hand-over or take-over). Security definer: a
-- host handing over is no longer the host by the time this runs, and only the host may give a crown.
create or replace function public.watch_rooms_crown_host()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.host_id is distinct from old.host_id then
    insert into public.watch_crowns (room_id, user_id, given_by)
    values (new.id, new.host_id, coalesce(auth.uid(), new.host_id))
    on conflict (room_id, user_id) do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists watch_rooms_crown_host on public.watch_rooms;
create trigger watch_rooms_crown_host
  after insert or update of host_id on public.watch_rooms
  for each row execute function public.watch_rooms_crown_host();

-- A room live right now gets its host's crown, so it keeps working.
insert into public.watch_crowns (room_id, user_id, given_by)
select r.id, r.host_id, r.host_id from public.watch_rooms r where r.ended_at is null
on conflict (room_id, user_id) do nothing;

-- 3. Who may do what with the queue ---------------------------------------------------------

-- Adding: to your own list, anybody signed in; straight into the queue, a crown; already played (GO LIVE's
-- first file), the host - the rule 20261027130000_watch_queue_plays_by_host.sql made, kept.
drop policy if exists "watch queue added to by an account" on public.watch_queue;
create policy "watch queue added to by an account" on public.watch_queue
  for insert to authenticated
  with check (
    not public.is_banned()
    and added_by = auth.uid()
    and exists (select 1 from public.watch_rooms r where r.id = watch_queue.room_id and r.ended_at is null)
    and (
      (not in_queue and played_at is null and play_index is null)
      or (
        in_queue and played_at is null and play_index is null
        and exists (select 1 from public.watch_crowns c where c.room_id = watch_queue.room_id and c.user_id = auth.uid())
      )
      or (played_at is not null and exists (select 1 from public.watch_rooms r where r.id = watch_queue.room_id and r.host_id = auth.uid()))
    )
  );

-- Changing a row: the host (marking plays) or a crown (pulling in, reordering). Which columns each may
-- change is the guard's business below, because a policy cannot compare a row before and after.
drop policy if exists "watch queue run by the host" on public.watch_queue;
drop policy if exists "watch queue run by the host or a crown" on public.watch_queue;
create policy "watch queue run by the host or a crown" on public.watch_queue
  for update to authenticated
  using (
    exists (
      select 1 from public.watch_rooms r
       where r.id = watch_queue.room_id and r.ended_at is null
         and (r.host_id = auth.uid() or exists (select 1 from public.watch_crowns c where c.room_id = r.id and c.user_id = auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from public.watch_rooms r
       where r.id = watch_queue.room_id
         and (r.host_id = auth.uid() or exists (select 1 from public.watch_crowns c where c.room_id = r.id and c.user_id = auth.uid()))
    )
  );

-- Taking out what has not played: a crown, from the queue or from anybody's list; or your own addition
-- that was never pulled in. What played is the record.
drop policy if exists "watch queue trimmed by the host" on public.watch_queue;
drop policy if exists "watch queue trimmed by a crown or taken back" on public.watch_queue;
create policy "watch queue trimmed by a crown or taken back" on public.watch_queue
  for delete to authenticated
  using (
    played_at is null
    and exists (select 1 from public.watch_rooms r where r.id = watch_queue.room_id and r.ended_at is null)
    and (
      exists (select 1 from public.watch_crowns c where c.room_id = watch_queue.room_id and c.user_id = auth.uid())
      or (not in_queue and added_by = auth.uid())
    )
  );

-- The columns: only the host marks what played; only a crown moves a row (its place, or into the queue);
-- a row in the queue stays in it; what was added, where and when never changes. A played row is always
-- in the queue, which also covers a page from before this change filing GO LIVE's first play.
create or replace function public.watch_queue_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  hosting boolean;
  crowned boolean;
begin
  if tg_op = 'UPDATE' then
    -- `media_item_id` and `added_by` are left to their foreign keys, which set them null when the file
    -- or the account is deleted.
    new.id := old.id;
    new.room_id := old.room_id;
    new.source_url := old.source_url;
    new.source_kind := old.source_kind;
    new.source_title := old.source_title;
    new.added_at := old.added_at;

    -- The room's rules are for people on the site: the SQL editor and the service role have no user.
    if auth.uid() is not null then
      select r.host_id = auth.uid() into hosting from public.watch_rooms r where r.id = new.room_id;
      crowned := exists (select 1 from public.watch_crowns c where c.room_id = new.room_id and c.user_id = auth.uid());

      if (new.played_at is distinct from old.played_at or new.play_index is distinct from old.play_index)
         and not coalesce(hosting, false) then
        raise exception 'only the host marks what played' using errcode = '42501';
      end if;

      if (new.position is distinct from old.position or new.in_queue is distinct from old.in_queue) and not crowned then
        raise exception 'only a crown moves the queue' using errcode = '42501';
      end if;

      if old.in_queue and not new.in_queue then
        raise exception 'a row in the queue stays in it' using errcode = '42501';
      end if;
    end if;
  end if;

  if new.played_at is not null then
    new.in_queue := true;
  end if;

  return new;
end;
$$;

drop trigger if exists watch_queue_guard on public.watch_queue;
create trigger watch_queue_guard
  before insert or update on public.watch_queue
  for each row execute function public.watch_queue_guard();

-- 4. Live changes ------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'watch_crowns') then
    alter publication supabase_realtime add table public.watch_crowns;
  end if;
end $$;

-- Afterwards, to see it landed:
--   select tablename, policyname, cmd from pg_policies where tablename like 'watch_%' order by 1, 2;
--   select tgname from pg_trigger where tgrelid in ('public.watch_rooms'::regclass, 'public.watch_queue'::regclass) and not tgisinternal;
--   select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'watch_%';
