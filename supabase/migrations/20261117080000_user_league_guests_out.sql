-- user_league (20261117060000, LEAGUEBOT's private Riot ID table) shut to a stream room's guests, as every table but the
-- room's own is (Temp/check-guests.cjs): a guest has a session but no account, so it has no Riot ID to keep on one. Only
-- narrows Luke's OK'd owner-only table (2026-11-17, "Yes, create it") to accounts; nothing else changes.
--
-- Re-runnable: the policy is dropped and recreated by name.

drop policy if exists "guests stay out" on public.user_league;
create policy "guests stay out" on public.user_league as restrictive for select to authenticated using (not (select public.is_guest()));
