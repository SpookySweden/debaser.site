-- The top bar's modules (Luke's OK 2026-11-06): which ones a person ticked and the hover colour each one turns, saved to their account so they follow them between
-- machines. Choices only: `app/lib/ui/modules.ts` reads them back through its own checks.
--
-- What this adds, and nothing else. No existing table, rule or row is altered:
--   - user_modules: one row a person. Owner only: only they can read, add or change it. Nobody else can read it, signed in or not.
--
-- Re-runnable: `if not exists`, constraint and policies dropped and recreated by name, grants revoked before given.

create table if not exists public.user_modules (
  person uuid primary key references auth.users (id) on delete cascade,
  choices jsonb not null default '{}'::jsonb
);

alter table public.user_modules drop constraint if exists user_modules_choices_shape;
alter table public.user_modules add constraint user_modules_choices_shape
  check (jsonb_typeof(choices) = 'object' and pg_column_size(choices) < 2048);

alter table public.user_modules enable row level security;

drop policy if exists "own modules readable" on public.user_modules;
create policy "own modules readable" on public.user_modules
  for select to authenticated using (person = auth.uid());

drop policy if exists "own modules addable" on public.user_modules;
create policy "own modules addable" on public.user_modules
  for insert to authenticated with check (person = auth.uid());

drop policy if exists "own modules changeable" on public.user_modules;
create policy "own modules changeable" on public.user_modules
  for update to authenticated using (person = auth.uid()) with check (person = auth.uid());

revoke all on public.user_modules from public, anon, authenticated;
grant select, insert, update on public.user_modules to authenticated;
