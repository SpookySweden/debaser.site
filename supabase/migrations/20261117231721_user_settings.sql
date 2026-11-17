-- Settings that follow the account (SPEC-forum-v3.md, F1B and F2A; Luke's typed OK in the FORUMUX chat, 2026-11-17: "Yes, create it").
-- A person's looks and filters (theme, cursor, background, the forum's tab/tags/sort/wire pause, MEDIA's filters and view, the player
-- bar, the MADE THIS switches) and what they have read on the forum, saved to their account so both of Luke's machines agree.
--
-- What this adds, and nothing else. No existing table, rule or row is altered:
--   - user_settings: one row a person. Owner only: only they can read, add or change it. Nobody else can read it, signed in or not,
--     and a stream guest (an anonymous sign-in) is kept out as from every other person's own table.
--   - `settings`: their choices, small (under 8 KB). `read_marks`: post id -> when they last opened it, the newest few hundred (under 64 KB).
--
-- Re-runnable: `if not exists`, constraints and policies dropped and recreated by name, grants revoked before given.

create table if not exists public.user_settings (
  person uuid primary key references auth.users (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  read_marks jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_settings drop constraint if exists user_settings_settings_shape;
alter table public.user_settings add constraint user_settings_settings_shape
  check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) < 8192);

alter table public.user_settings drop constraint if exists user_settings_read_marks_shape;
alter table public.user_settings add constraint user_settings_read_marks_shape
  check (jsonb_typeof(read_marks) = 'object' and pg_column_size(read_marks) < 65536);

alter table public.user_settings enable row level security;

drop policy if exists "own settings readable" on public.user_settings;
create policy "own settings readable" on public.user_settings
  for select to authenticated using (person = auth.uid());

drop policy if exists "own settings addable" on public.user_settings;
create policy "own settings addable" on public.user_settings
  for insert to authenticated with check (person = auth.uid());

drop policy if exists "own settings changeable" on public.user_settings;
create policy "own settings changeable" on public.user_settings
  for update to authenticated using (person = auth.uid()) with check (person = auth.uid());

drop policy if exists "guests stay out" on public.user_settings;
create policy "guests stay out" on public.user_settings as restrictive for select to authenticated using (not (select public.is_guest()));

revoke all on public.user_settings from public, anon, authenticated;
grant select, insert, update on public.user_settings to authenticated;
