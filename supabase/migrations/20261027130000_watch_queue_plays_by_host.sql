-- -----------------------------------------------------------------------------
-- Watch together: only the host files a play (review finding, 2026-10-27)
-- -----------------------------------------------------------------------------
-- Run with `npm run db:push`. Idempotent: the policy is dropped and re-created by name. No row changes.
--
-- 20261027120000_watch_rooms.sql let any signed-in account add to a live room's queue in its own name -
-- which is the point (decision 2) - but did not stop that account writing the row as already played
-- (`played_at`, `play_index`). Such a row would show in the stream's forum record and the archive's folds
-- as a file that played, and the host could not take it out (only unplayed rows can be). Now an add from
-- anybody but the current host must be unplayed; the host still files the first play when going live.

drop policy if exists "watch queue added to by an account" on public.watch_queue;
create policy "watch queue added to by an account" on public.watch_queue
  for insert to authenticated
  with check (
    not public.is_banned()
    and added_by = auth.uid()
    and exists (select 1 from public.watch_rooms r where r.id = room_id and r.ended_at is null)
    and (
      (played_at is null and play_index is null)
      or exists (select 1 from public.watch_rooms r where r.id = room_id and r.host_id = auth.uid())
    )
  );
