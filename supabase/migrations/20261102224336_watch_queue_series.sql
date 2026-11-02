-- -----------------------------------------------------------------------------
-- Watch together: series in the queue (SPEC-stream-series.md, 2026-11-02)
-- -----------------------------------------------------------------------------
-- Run with `npm run db:push`. Re-runnable: columns and the check are added only if missing, the index is
-- created if missing, and the guard function is replaced by name. No row changes, no policy changes.
--
-- An Internet Archive item with several videos, or a YouTube playlist, is added to a room as a series: one row
-- per episode, as any video is, and three new marks on each of those rows:
--   series_id       one per add (the same series added twice is two blocks), shared by its episodes
--   series_title    the series' name, for the folded block and `SERIES :: EPISODE`
--   series_episode  the order inside the block (1, 2, 3...)
-- The episodes of one add share one `position`, so a crown's reorder moves the whole block with one write
-- (`... where series_id = X and played_at is null`), and the episode number keeps their order inside it.
-- A row is either a lone video (all three empty) or an episode (all three set).
--
-- Who may do what is unchanged: the policies and the guard of 20261102192043_watch_queue_additions.sql apply
-- to each episode row as to any row (only a crown moves or takes out what has not played, only the host marks
-- plays, your own addition is yours to take back until it is pulled in). The guard now also keeps the three
-- marks as they were written, so nobody can move an episode into another block or rename a series.
-- Rows already in the database (single videos, Archive items queued as one embed) stay exactly as they are.

-- 1. The marks ---------------------------------------------------------------------------

alter table public.watch_queue add column if not exists series_id uuid;
alter table public.watch_queue add column if not exists series_title text;
alter table public.watch_queue add column if not exists series_episode integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'watch_queue_series_marks' and conrelid = 'public.watch_queue'::regclass) then
    alter table public.watch_queue add constraint watch_queue_series_marks check (
      (series_id is null and series_title is null and series_episode is null)
      or (
        series_id is not null
        and series_title is not null and char_length(series_title) between 1 and 200
        and series_episode is not null and series_episode between 1 and 1000000
      )
    );
  end if;
end $$;

-- A block's episodes are found by their series (a move, a take-out); only episode rows are indexed.
create index if not exists watch_queue_series_idx on public.watch_queue (room_id, series_id) where series_id is not null;

-- 2. The guard keeps the marks -------------------------------------------------------------
-- The function of 20261102213149_watch_queue_kept_as_added.sql with the three marks pinned on every update.

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
    new.series_id := old.series_id;
    new.series_title := old.series_title;
    new.series_episode := old.series_episode;
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

-- Afterwards, to see it landed:
--   select column_name, data_type from information_schema.columns where table_name = 'watch_queue' and column_name like 'series%';
--   select conname from pg_constraint where conname = 'watch_queue_series_marks';
