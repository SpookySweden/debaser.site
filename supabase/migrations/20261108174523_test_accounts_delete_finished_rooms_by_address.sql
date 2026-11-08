-- The test accounts' room delete (20261108174247), without its look at profiles.is_hidden: signed-in people can't read that column
-- ("permission denied for table profiles"), so every delete failed. The signed-in address alone settles it: an address belongs to one
-- account, and test-a to test-d@debaser.site are the kept test accounts. Guests have no address. Same room conditions as before.
--
-- Re-runnable: the policy is dropped and recreated by name.

drop policy if exists "watch rooms test accounts delete their finished rooms" on public.watch_rooms;
create policy "watch rooms test accounts delete their finished rooms" on public.watch_rooms
  for delete to authenticated
  using (
    host_id = (select auth.uid())
    and ended_at is not null
    and lower(coalesce((select auth.jwt()) ->> 'email', '')) ~ '^test-[a-d]@debaser\.site$'
  );
