-- user_aquarium (20261115235034) shut to a stream room's guests, as every table but the room's own is (Temp/check-guests.cjs):
-- a guest has a session but no account, so it has no aquarium settings to keep. Only narrows Luke's OK'd owner-only table
-- (2026-11-15) to accounts; nothing else changes. Luke's OK 2026-11-16 ("1a").
--
-- Re-runnable: the policy is dropped and recreated by name.

drop policy if exists "guests stay out" on public.user_aquarium;
create policy "guests stay out" on public.user_aquarium as restrictive for select to authenticated using (not (select public.is_guest()));
