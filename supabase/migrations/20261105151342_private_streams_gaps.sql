-- Privacy plan, phase 2, closing what the code review found in 20261105145655_private_streams.sql (SPEC-privacy-phase-2.md, same OK):
--
--   1. A saved picture's file is readable exactly when its snapshot row is, so one made private stays private whatever its canvas was.
--   2. Saving a canvas or taking a snapshot needs somebody who may be in the room, so a removed person can't.
--   3. The host can't be handed to somebody who was removed, and a handover no longer un-removes anybody.
--   4. A music room switched off is its host's alone from now, not only from its next update.
--
-- Nothing is deleted. Re-runnable.

-- 1. The file follows its row, whose own rule already says who may read it.
drop policy if exists "stream art readable by accounts" on storage.objects;
create policy "stream art readable by accounts" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'stream-art'
    and exists (select 1 from public.room_canvas_snapshots s where s.path = objects.name)
  );

-- 2. Saving and snapshotting.
create or replace function public.room_canvas_save(canvas uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  label text;
  done integer;
begin
  if auth.uid() is null or public.is_banned() then return false; end if;
  select coalesce(nullif(p.display_name, ''), 'Unknown') into label from public.profiles p where p.id = auth.uid();
  update public.room_canvases c
    set saved_at = now(), saved_by = auth.uid(), saved_by_label = left(coalesce(label, 'Unknown'), 80)
    where c.id = canvas and c.saved_at is null and c.closed_at is null
      and public.room_may_talk(c.room_id)
      and exists (select 1 from public.watch_rooms r where r.id = c.room_id and r.ended_at is null);
  get diagnostics done = row_count;
  return done = 1;
end;
$$;

create or replace function public.room_canvas_may_snapshot(canvas uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.room_canvases c
    where c.id = canvas
      and public.room_may_talk(c.room_id)
      and (
        c.host_id = auth.uid()
        or c.saved_by = auth.uid()
        or exists (select 1 from public.watch_rooms r where r.id = c.room_id and r.host_id = auth.uid())
        or exists (select 1 from public.room_canvas_inputs i where i.canvas_id = c.id and i.author_id = auth.uid())
        or exists (select 1 from public.watch_crowns w where w.room_id = c.room_id and w.user_id = auth.uid())
      )
  );
$$;

-- 3. Handing over.
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
    -- Set only by watch_room_set_privacy, for the length of its own update. A person's request can't reach set_config.
    if coalesce(current_setting('debaser.room_privacy', true), '') <> 'on' then new.privacy := old.privacy; end if;
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
    on conflict (room_id, user_id) do nothing;
  end if;
  return null;
end;
$$;

-- 4. Music rooms switched off.
update public.watch_rooms set privacy = 'private' where origin = 'music' and not is_public and privacy <> 'private';
