-- Profile characters get the house's "guests stay out" rule (Luke's OK, 2026-11-13: "Yes, add it"), which
-- 20261113022903_profile_characters.sql left off. It's the same restrictive rule every other table has, so check-guests holds
-- it like the rest. Stream-room guests could already change nothing here; now they read nothing either.
--
-- Re-runnable: the policy is dropped and recreated by name.

drop policy if exists "guests stay out" on public.profile_characters;
create policy "guests stay out" on public.profile_characters as restrictive for select to authenticated using (not (select public.is_guest()));
