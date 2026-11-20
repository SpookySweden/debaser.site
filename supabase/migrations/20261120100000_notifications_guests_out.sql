-- Guests stay out of the notification tables (SPEC-guests.md's pattern; found by Temp/check-guests.cjs after
-- 20261120014611_notifications_phase1.sql). A stream guest (an anonymous sign-in) could already read only rows of its own
-- and can't make any; this is the site's usual second lock on top, so a guest reads nothing at all.
--
-- What this adds: one restrictive read rule on each of notification_prefs and live_watches. Nothing else changes.
-- Re-runnable: each rule is dropped and recreated by name.

drop policy if exists "guests stay out" on public.notification_prefs;
create policy "guests stay out" on public.notification_prefs as restrictive for select to authenticated using (not (select public.is_guest()));

drop policy if exists "guests stay out" on public.live_watches;
create policy "guests stay out" on public.live_watches as restrictive for select to authenticated using (not (select public.is_guest()));
