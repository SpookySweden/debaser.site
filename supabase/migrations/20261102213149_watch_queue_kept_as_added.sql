-- -----------------------------------------------------------------------------
-- Watch together: which file a queue row is, and who added it, stay as written (review, 2026-11-02)
-- -----------------------------------------------------------------------------
-- Run with `npm run db:push`. Re-runnable: one function replaced by name. No row changes, no policy changes.
--
-- 20261102192043_watch_queue_additions.sql let somebody holding a crown change a room's queue rows (to pull
-- additions in and to reorder). Its guard kept what was added - the link, the room, when - but left
-- `media_item_id` and `added_by` alone, because their foreign keys set them null when a file or an account
-- is deleted. So a crowned watcher could, from the browser's console, point a played row at another file
-- (the stream's board record and the archive's folds would then name it) or make themselves a row's adder.
-- Only the host could do that before; now nobody can. A person's own update keeps both; a foreign key's
-- set-null runs as a trigger inside the delete (trigger depth 2), so it still gets through.
-- Proof: Temp/probe-watch-crowns.sql steps 24b and 24c (failed before this, 2026-11-02) and 28 (a real file
-- deleted still empties the played row that named it).

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
    new.id := old.id;
    new.room_id := old.room_id;
    new.source_url := old.source_url;
    new.source_kind := old.source_kind;
    new.source_title := old.source_title;
    new.added_at := old.added_at;

    -- The room's rules are for people on the site: the SQL editor and the service role have no user.
    if auth.uid() is not null then
      -- Which file, and who added it: a person's own update keeps both. A foreign key's set-null (the file
      -- or the account deleted) is a trigger inside the delete, deeper than 1, and gets through.
      if pg_trigger_depth() = 1 then
        new.media_item_id := old.media_item_id;
        new.added_by := old.added_by;
      end if;

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
