-- Deleting a stream's board thread left its room pointing at a thread that was gone, because the room's guard put the old value back over the database's own
-- set-null (Luke's OK in chat, 2026-11-06). A person's own write still can't change a thread once filed; the database clearing it inside a delete can.
-- Any pointers already left dangling are cleared. No rows are deleted. Re-runnable.

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
  -- A foreign key's set-null is a trigger inside the delete, deeper than 1, and gets through.
  if old.forum_thread_id is not null and pg_trigger_depth() = 1 then new.forum_thread_id := old.forum_thread_id; end if;
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

-- Without the guard for this one statement, so it can clear them and no room's heartbeat moves.
alter table public.watch_rooms disable trigger watch_rooms_guard;
update public.watch_rooms r set forum_thread_id = null
  where r.forum_thread_id is not null and not exists (select 1 from public.forum_threads t where t.id = r.forum_thread_id);
alter table public.watch_rooms enable trigger watch_rooms_guard;
