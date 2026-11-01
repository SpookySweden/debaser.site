-- -----------------------------------------------------------------------------
-- 22. Lore pages: the world written down, and merged as it is typed.
-- -----------------------------------------------------------------------------
-- Run this whole file in the Supabase SQL Editor on a project that has already had
-- `supabase/schema.sql` run against it. Re-running it is safe: the table is `if not exists`, the
-- constraint is dropped and re-added by name, the index is guarded by name, and every policy is
-- dropped and re-created by name.
--
-- A page is a row, but the *writing* is a Yjs document: while a page is open the editors merge
-- their changes over a Realtime broadcast channel, and a row is written only when somebody saves
-- (app/lib/lore/supabase-lore-repository.ts). So the table holds two copies of the same writing,
-- on purpose:
--
--   yjs_state   base64 of the document, which is what an editor opens and keeps merging;
--   body_text   the same writing as plain text, which is what a visitor who is not signed in reads.
--
-- Neither is the other's source of truth: one save writes both, from the same document. The state
-- is base64 text rather than bytes because it is written and read by one client at a time - the
-- merging happens over the channel, never in the column - and text keeps the row legible in the
-- dashboard.
--
-- Who may do what: anybody may read a page, and only a signed-in account may open or file one. That
-- is the opposite of the board, which takes posts from guests, and it is deliberate - a keystroke
-- in a shared document has nowhere to go without a name on it.
--
-- Nothing here is added to `supabase_realtime`, and nothing here needs to be: the editors talk
-- over a broadcast channel rather than over the table's change feed, and a publication entry is
-- what a `postgres_changes` subscription needs. This feature therefore cannot be the table that
-- takes a channel quiet (see the note in supabase/README.md).

create table if not exists public.lore_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  summary text not null default '',
  body_text text not null default '',
  yjs_state text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_by_label text not null default 'Unknown',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_by_label text not null default 'Unknown'
);

-- A slug is lower-case words joined by single hyphens, which is what a link can hold. This is the
-- database's copy of `isLoreSlug` in app/lib/lore/pages.ts: the site refuses a title that makes no
-- address before it ever asks, and the table refuses one that got past it.
alter table public.lore_pages drop constraint if exists lore_pages_slug_shape;
alter table public.lore_pages add constraint lore_pages_slug_shape check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- The index reads pages by when they were last written in.
create index if not exists lore_pages_updated_idx on public.lore_pages (updated_at desc);

alter table public.lore_pages enable row level security;

drop policy if exists "lore pages readable" on public.lore_pages;
create policy "lore pages readable" on public.lore_pages for select using (true);

drop policy if exists "lore pages opened by an account" on public.lore_pages;
create policy "lore pages opened by an account" on public.lore_pages
  for insert to authenticated with check (not public.is_banned() and auth.uid() = created_by);

drop policy if exists "lore pages filed by an account" on public.lore_pages;
create policy "lore pages filed by an account" on public.lore_pages
  for update to authenticated
  using (not public.is_banned())
  with check (not public.is_banned() and auth.uid() = updated_by);

drop policy if exists "lore pages removed by their opener or admin" on public.lore_pages;
create policy "lore pages removed by their opener or admin" on public.lore_pages
  for delete to authenticated using (auth.uid() = created_by or public.is_admin());

-- Check it landed.

--   select table_name from information_schema.tables where table_schema = 'public' and table_name = 'lore_pages';
--   select conname from pg_constraint where conrelid = 'public.lore_pages'::regclass and conname = 'lore_pages_slug_shape';
--   select policyname, cmd, roles from pg_policies where tablename = 'lore_pages' order by policyname;
--   select slug, title, updated_by_label, updated_at, length(body_text) as letters, length(yjs_state) as state
--     from public.lore_pages order by updated_at desc;
