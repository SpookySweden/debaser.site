-- The kept test accounts may delete a room they hosted, once it has ended (Luke's OK, 2026-11-08).
--
-- Why: nobody can delete a room, so stream history stays on record. But the live check Temp/check-private-streams.cjs makes a room
-- every run and could only end it, so a finished, empty test room piled up each time (25 were cleaned up by hand on 2026-11-08).
-- With this, the check deletes its own room when it is done.
--
-- Who: only TEST ACCOUNT A-D. Both must hold: the person's profile is hidden (set only by a migration), and the signed-in address is
-- one of the four test addresses. Guests are hidden too but have no address, so they are out; real people's addresses never match.
-- What: only a room that person hosts, and only after it has ended. Deleting a room takes its own queue rows, chat lines, members,
-- crowns and canvases with it (on delete cascade), as the clean-up of 2026-11-08 did. No real room can be touched by this.
--
-- Re-runnable: the policy is dropped and recreated by name.

drop policy if exists "watch rooms test accounts delete their finished rooms" on public.watch_rooms;
create policy "watch rooms test accounts delete their finished rooms" on public.watch_rooms
  for delete to authenticated
  using (
    host_id = (select auth.uid())
    and ended_at is not null
    and lower(coalesce((select auth.jwt()) ->> 'email', '')) ~ '^test-[a-d]@debaser\.site$'
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_hidden)
  );
