-- NOT APPLIED. Waits for Luke's typed OK (asked 2026-11-13). When OK'd: `npm run db:new -- user_companion`, move this in,
-- `npm run db:push:dry`, then `npm run db:push`, and delete this file.
--
-- The COMPANION switch (SPEC-companion.md, decision 2): whether a person's companion is out on a computer and on a phone,
-- and which of their characters it wears, saved to their account so it follows them between machines. Choices only:
-- `app/lib/companion/choices.ts` reads them back through its own checks. Room positions are never stored (they travel
-- only on the room's presence).
--
-- What this adds, and nothing else. No existing table, rule or row is altered:
--   - user_companion: one row a person. Owner only: only they can read, add or change it. Nobody else can read it, signed in or not.
--
-- Re-runnable: `if not exists`, constraint and policies dropped and recreated by name, grants revoked before given.

create table if not exists public.user_companion (
  person uuid primary key references auth.users (id) on delete cascade,
  choices jsonb not null default '{}'::jsonb
);

alter table public.user_companion drop constraint if exists user_companion_choices_shape;
alter table public.user_companion add constraint user_companion_choices_shape
  check (jsonb_typeof(choices) = 'object' and pg_column_size(choices) < 1024);

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
