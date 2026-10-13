-- -----------------------------------------------------------------------------
-- Where each person's docked windows sit, per screen shape
-- -----------------------------------------------------------------------------
-- Run this whole file with `npm run db:push`. It is idempotent: running it twice changes nothing the
-- second time, and it drops no row. Nothing that already exists is changed.
--
-- Why: the docked windows (music archive, arcade, playlists, preferences) can be snapped into groups,
-- resized and maximised (SPEC-windows.md), and that arrangement is saved to the account so it comes back
-- on any desktop. One row per account; the whole arrangement is one small `jsonb` bundle keyed by screen
-- shape (`tall`, `standard`, `wide`), each holding a box, a group id and an open flag per window. The app
-- reads it defensively (`readSavedLayouts` in app/lib/ui/window-layout.ts), so the shape lives there.
--
-- Nobody else ever reads a layout: every policy below is "own row only".

create table if not exists public.window_layouts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  layouts jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  -- A layout is a handful of numbers per window; anything near this size is not a layout.
  constraint window_layouts_small check (pg_column_size(layouts) < 65536)
);

alter table public.window_layouts enable row level security;

drop policy if exists "window layouts readable by owner" on public.window_layouts;
create policy "window layouts readable by owner" on public.window_layouts
  for select using (auth.uid() = user_id);

drop policy if exists "window layouts insertable by owner" on public.window_layouts;
create policy "window layouts insertable by owner" on public.window_layouts
  for insert with check (auth.uid() = user_id);

drop policy if exists "window layouts updatable by owner" on public.window_layouts;
create policy "window layouts updatable by owner" on public.window_layouts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "window layouts removable by owner" on public.window_layouts;
create policy "window layouts removable by owner" on public.window_layouts
  for delete using (auth.uid() = user_id);

-- Questions to ask the live database afterwards:
--   select relrowsecurity from pg_class where relname = 'window_layouts';          -- t
--   select policyname, cmd from pg_policies where tablename = 'window_layouts';    -- four, one per cmd
