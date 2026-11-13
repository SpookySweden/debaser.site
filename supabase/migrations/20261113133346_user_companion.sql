-- The COMPANION switch (SPEC-companion.md, decision 2; Luke's OK 2026-11-13, "Yes, make it"): whether a person's companion is
-- out on a computer and on a phone, saved to their account so it follows them between machines. It always wears the
-- profile's SHOWN character (Luke: "Only the shown one"), so no character is stored. Room positions are never stored: they
-- travel only on the room's presence.
--
-- What this adds, and nothing else. No existing table, rule or row is altered:
--   - user_companion: one row a person. Owner only: only they can read, add or change it. Nobody else can read it, signed in or not.
--
-- Re-runnable: `if not exists`, policies dropped and recreated by name, grants revoked before given.

create table if not exists public.user_companion (
  person uuid primary key references auth.users (id) on delete cascade,
  -- Null is the default: on once the account has a SHOWN character.
  on_computer boolean,
  on_phone boolean not null default false
);

alter table public.user_companion enable row level security;

drop policy if exists "own companion readable" on public.user_companion;
create policy "own companion readable" on public.user_companion
  for select to authenticated using (person = auth.uid());

drop policy if exists "own companion addable" on public.user_companion;
create policy "own companion addable" on public.user_companion
  for insert to authenticated with check (person = auth.uid());

drop policy if exists "own companion changeable" on public.user_companion;
create policy "own companion changeable" on public.user_companion
  for update to authenticated using (person = auth.uid()) with check (person = auth.uid());

revoke all on public.user_companion from public, anon, authenticated;
grant select, insert, update on public.user_companion to authenticated;
