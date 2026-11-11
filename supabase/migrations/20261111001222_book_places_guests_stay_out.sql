-- Reading places get the house's "guests stay out" rule (Luke's OK, 2026-11-11), which 20261110222807_books.sql left off
-- this one table. Stream-room guests could already read only their own places (none); this is the same restrictive rule
-- every other table has, so check-guests holds it like the rest.
--
-- Re-runnable: the policy is dropped and recreated by name.

drop policy if exists "guests stay out" on public.book_places;
create policy "guests stay out" on public.book_places as restrictive for select to authenticated using (not (select public.is_guest()));
