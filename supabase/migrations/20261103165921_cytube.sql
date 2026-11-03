-- -----------------------------------------------------------------------------
-- CYTUBE: each person's broadcaster look and their SHOW THE HOST'S LOOK switch (SPEC-cytube.md, 2026-11-03)
-- -----------------------------------------------------------------------------
-- Run with `npm run db:push` (Luke's typed OK, 2026-11-03, for the spec's "Data" section). Re-runnable: the
-- table is created if missing, its constraint and every policy are dropped and re-created by name. Nothing
-- that exists is changed and nothing is deleted.
--
-- `look`: the preset a person broadcasts in (one of the five in app/lib/cytube/looks.ts), or null for none
-- (their room then wears the viewer's own site theme). `show_host_look`: in somebody else's room, true shows
-- the host's look (the default), false keeps their own.
--
-- Readable by signed-in people, so a viewer can read the host's look; written only by its owner.
--
-- The spec's other data line, "a room can exist with an empty queue", needs no change: `watch_rooms` already
-- allows `current_entry_id` to be null and the room's insert policy never asked for a queue row. GO LIVE from
-- the CYTUBE page simply writes the room without its first file.

create table if not exists public.cytube_looks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  look text,
  show_host_look boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.cytube_looks drop constraint if exists cytube_looks_look;
alter table public.cytube_looks add constraint cytube_looks_look
  check (look is null or look in ('nigrosine', 'royal', 'blood', 'jungle', 'orchid'));

alter table public.cytube_looks enable row level security;

drop policy if exists "cytube looks readable when signed in" on public.cytube_looks;
create policy "cytube looks readable when signed in" on public.cytube_looks
  for select to authenticated using (true);

drop policy if exists "cytube looks written by their owner" on public.cytube_looks;
create policy "cytube looks written by their owner" on public.cytube_looks
  for insert to authenticated with check (user_id = auth.uid() and not public.is_banned());

drop policy if exists "cytube looks changed by their owner" on public.cytube_looks;
create policy "cytube looks changed by their owner" on public.cytube_looks
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "cytube looks removed by their owner" on public.cytube_looks;
create policy "cytube looks removed by their owner" on public.cytube_looks
  for delete to authenticated using (user_id = auth.uid());

-- Afterwards, to see it landed:
--   select relrowsecurity from pg_class where relname = 'cytube_looks';            -- t
--   select policyname, cmd from pg_policies where tablename = 'cytube_looks';      -- four, one per cmd
