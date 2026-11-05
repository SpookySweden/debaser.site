-- Privacy plan, phase 1 (SPEC-privacy-phase-1.md).
--
--   1. New accounts start private: lamp, listening and comments off, by column default. Existing accounts keep their settings.
--   2. New switches on profiles. show_name_to_visitors and credit_me_in_art do nothing until phase 5.
--   3. privacy_seen: whether the account has been shown the PRIVACY window. The kept test accounts are marked, so it does not sit over
--      every check; those four rows are the only existing rows this edits.
--   4. A presence stamp is readable by its owner, and by other accounts only while the owner's lamp is on.
--
-- Nothing is deleted. Re-runnable: `if not exists`, and the policy dropped and recreated by name.

-- 1 and 2. A new column takes the first default on the rows already there, then new rows get the second.
alter table public.profiles add column if not exists show_online boolean not null default true;
alter table public.profiles alter column show_online set default false;

alter table public.profiles add column if not exists show_name_to_visitors boolean not null default true;
alter table public.profiles alter column show_name_to_visitors set default false;

alter table public.profiles add column if not exists credit_me_in_art boolean not null default true;

alter table public.profiles alter column hide_listening set default true;
alter table public.profiles alter column show_profile_comments set default false;
alter table public.profiles alter column show_avatar_comments set default false;
alter table public.profiles alter column show_song_comments set default false;

-- 3. The window, once.
alter table public.profiles add column if not exists privacy_seen boolean not null default false;

update public.profiles set privacy_seen = true where is_hidden and not privacy_seen;

grant select (show_online, show_name_to_visitors, credit_me_in_art, privacy_seen) on public.profiles to authenticated;

-- 4. The lamp switch.
drop policy if exists "presence readable by accounts" on public.profile_presence;
create policy "presence readable by accounts" on public.profile_presence
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = profile_presence.user_id and p.show_online)
  );
