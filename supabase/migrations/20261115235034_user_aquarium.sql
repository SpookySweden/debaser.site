-- The AQUARIUM background's settings (Luke's OK 2026-11-15: "Yes, add it"; SPEC-aquarium-settings.md): every knob of a person's
-- sea and which background they have on (AQUARIUM or TILE), saved to their account so it follows them between machines.
-- `app/lib/aquarium/settings.ts` reads it back through its own checks, so the database only holds its shape and size.
--
-- What this adds, and nothing else. No existing table, rule or row is altered:
--   - user_aquarium: one row a person. Owner only: only they can read, add or change it. Nobody else can read it, signed in or not.
--
-- Re-runnable: `if not exists`, constraint and policies dropped and recreated by name, grants revoked before given.

create table if not exists public.user_aquarium (
  person uuid primary key references auth.users (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb
);

alter table public.user_aquarium drop constraint if exists user_aquarium_settings_shape;
alter table public.user_aquarium add constraint user_aquarium_settings_shape
  check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) < 4096);

alter table public.user_aquarium enable row level security;

drop policy if exists "own aquarium readable" on public.user_aquarium;
create policy "own aquarium readable" on public.user_aquarium
  for select to authenticated using (person = auth.uid());

drop policy if exists "own aquarium addable" on public.user_aquarium;
create policy "own aquarium addable" on public.user_aquarium
  for insert to authenticated with check (person = auth.uid());

drop policy if exists "own aquarium changeable" on public.user_aquarium;
create policy "own aquarium changeable" on public.user_aquarium
  for update to authenticated using (person = auth.uid()) with check (person = auth.uid());

revoke all on public.user_aquarium from public, anon, authenticated;
grant select, insert, update on public.user_aquarium to authenticated;
