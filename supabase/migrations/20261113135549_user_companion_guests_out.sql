-- user_companion (20261113133346) shut to a stream room's guests, as every table but the room's own is (Temp/check-guests.cjs):
-- a guest has a session but no account, so it has no companion switch to keep. Only narrows Luke's OK'd owner-only table
-- (2026-11-13) to accounts; nothing else changes.
--
-- Re-runnable: the policy is dropped and recreated by name.

drop policy if exists "guests stay out" on public.user_companion;
create policy "guests stay out" on public.user_companion as restrictive for select to authenticated using (not (select public.is_guest()));
