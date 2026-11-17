-- -----------------------------------------------------------------------------
-- A room's canvas can be opened in a handed-on room too (CANVAS, 2026-11-17)
-- -----------------------------------------------------------------------------
-- Luke: "make sure they are all properly accessible to everyone in the room and saved safely."
--
-- The rule for opening a room's canvas (20261103170312_stream-art.sql) meant "the canvas is credited to the room's
-- original host": `r.original_host_id = host_id`. Inside that subquery `host_id` named the ROOM's current host, not
-- the canvas's, and 20261105145655_private_streams.sql spelled it out as `r.original_host_id = r.host_id`. So a canvas
-- could only be opened while the room was still hosted by the person who started it: in a room handed on
-- (SPEC-rooms-perpetual.md, it passes to whoever has been there longest), nobody could start a canvas, and strokes
-- drawn there stayed in the drawer's own browser.
--
-- Now: the canvas row must be credited to the room's original host (the intended check, the column the archive shows,
-- and what the guest trigger already sets), whoever hosts the room now. Everything else is unchanged: signed in, not
-- banned, in your own name, a fresh canvas, a live room, and allowed to speak there (room_may_talk). It changes no
-- existing row. Re-runnable: the policy is dropped and created by name.

drop policy if exists "room canvases opened in a live room" on public.room_canvases;
create policy "room canvases opened in a live room" on public.room_canvases
  for insert to authenticated
  with check (
    not public.is_banned()
    and opened_by = auth.uid()
    and closed_at is null and saved_at is null and saved_by is null and hidden = false and hidden_at is null
    and public.room_may_talk(room_id)
    and exists (
      select 1 from public.watch_rooms r
       where r.id = room_canvases.room_id and r.ended_at is null and r.original_host_id = room_canvases.host_id
    )
  );

-- To check after the push:
--   select with_check from pg_policies where tablename = 'room_canvases' and policyname = 'room canvases opened in a live room';
