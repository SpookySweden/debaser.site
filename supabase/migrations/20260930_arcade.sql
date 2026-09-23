-- -----------------------------------------------------------------------------
-- 23. The arcade: invitations, and the two columns the feed needs to carry them.
-- -----------------------------------------------------------------------------
-- Run the whole file in the Supabase SQL Editor (nothing selected). Every statement is written to be
-- re-run: the table is `if not exists`, and the constraints, policies and grants are dropped and
-- re-created by name.
--
-- `game_invites` is one row per challenge: who asked, who was asked, which game, and whether it has
-- been answered. It is the whole of the arcade's storage - a match in progress writes nothing,
-- because a match is two browsers on one realtime broadcast channel named after the invitation (see
-- app/lib/games/channel.ts).
--
-- Readable only by the two accounts it names, and writable by either of them: the sender inserts it,
-- the recipient answers it (`status`), and both may remove it - the sender cancelling, the recipient
-- clearing one they have answered. That is what keeps a match private: the room's name is the row's
-- id, and only the pair can read the id.
--
-- The same file widens `forum_notifications` so the bell can carry a challenge: `kind` gains
-- `'invite'`, and two columns say which game and which invitation. The notification is written by the
-- inviting account for the account it invites, exactly as a tag is, and the menu's row opens
-- `/games?invite=<id>` - which answers the invitation and starts the game.

create table if not exists public.game_invites (
  id uuid primary key default gen_random_uuid(),
  -- The two games this site carries: see app/lib/games/types.ts (GameId).
  game text not null check (game in ('tic-tac-toe', 'paddle-duel')),
  from_user uuid not null references auth.users (id) on delete cascade,
  -- Stored with the id, like a notification's actor name, so a row is drawable after an account goes.
  from_name text not null default 'Anonymous',
  to_user uuid not null references auth.users (id) on delete cascade,
  to_name text not null default 'Anonymous',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- An invitation is from one account to another: nobody challenges themselves.
  constraint game_invites_not_self check (from_user <> to_user)
);

create index if not exists game_invites_to_idx on public.game_invites (to_user, created_at desc);
create index if not exists game_invites_from_idx on public.game_invites (from_user, created_at desc);

alter table public.game_invites enable row level security;

drop policy if exists "game invites readable by the pair" on public.game_invites;
create policy "game invites readable by the pair" on public.game_invites
  for select using (from_user = auth.uid() or to_user = auth.uid());

drop policy if exists "game invites sent by the challenger" on public.game_invites;
create policy "game invites sent by the challenger" on public.game_invites
  for insert with check (
    not public.is_banned()
    and from_user = auth.uid()
    and to_user <> auth.uid()
  );

-- Either side moves the row: the recipient accepts or declines, the sender cancels (by removing it).
drop policy if exists "game invites answered by the pair" on public.game_invites;
create policy "game invites answered by the pair" on public.game_invites
  for update using (from_user = auth.uid() or to_user = auth.uid())
  with check (from_user = auth.uid() or to_user = auth.uid());

drop policy if exists "game invites removed by the pair" on public.game_invites;
create policy "game invites removed by the pair" on public.game_invites
  for delete using (from_user = auth.uid() or to_user = auth.uid());

-- -----------------------------------------------------------------------------
-- The notification feed carries a challenge.
-- -----------------------------------------------------------------------------

alter table public.forum_notifications add column if not exists game_id text;
alter table public.forum_notifications add column if not exists invite_id uuid;

-- Widened rather than re-made: a project that has the section 17 constraint keeps its rows.
alter table public.forum_notifications drop constraint if exists forum_notifications_kind_check;
alter table public.forum_notifications
  add constraint forum_notifications_kind_check check (kind in ('tag', 'reply', 'invite'));

-- The invitation the row is about. Cascades, so clearing invitations cannot leave a row pointing at
-- nothing; the column is nullable because a tag or a reply has no game behind it.
alter table public.forum_notifications drop constraint if exists forum_notifications_invite_id_fkey;
alter table public.forum_notifications
  add constraint forum_notifications_invite_id_fkey
  foreign key (invite_id) references public.game_invites (id) on delete cascade;

-- Realtime, guarded the way section 9 does it, so this block stays safe to re-run: an accepted
-- invitation has to reach the sender's screen without a reload.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_invites'
  ) then
    alter publication supabase_realtime add table public.game_invites;
  end if;
end $$;

-- =============================================================================
-- THE CHECKLIST: what the arcade needs, in one result. Every row should read `ok`.
-- =============================================================================

select object, state, section from (
  select 'table: game_invites' as object,
         case when to_regclass('public.game_invites') is null then 'MISSING' else 'ok' end as state,
         '23' as section
  union all
  select 'column: forum_notifications.game_id',
         case when exists (
           select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'forum_notifications' and column_name = 'game_id'
         ) then 'ok' else 'MISSING' end, '23'
  union all
  select 'column: forum_notifications.invite_id',
         case when exists (
           select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'forum_notifications' and column_name = 'invite_id'
         ) then 'ok' else 'MISSING' end, '23'
  union all
  select 'constraint: kind includes invite',
         case when exists (
           select 1 from pg_constraint
           where conname = 'forum_notifications_kind_check' and pg_get_constraintdef(oid) like '%invite%'
         ) then 'ok' else 'MISSING' end, '23'
  union all
  select 'policy: game invites sent by the challenger',
         case when exists (
           select 1 from pg_policies
           where schemaname = 'public' and tablename = 'game_invites'
             and policyname = 'game invites sent by the challenger'
         ) then 'ok' else 'MISSING' end, '23'
  union all
  select 'policy: game invites answered by the pair',
         case when exists (
           select 1 from pg_policies
           where schemaname = 'public' and tablename = 'game_invites'
             and policyname = 'game invites answered by the pair'
         ) then 'ok' else 'MISSING' end, '23'
  union all
  select 'policy: game invites readable by the pair',
         case when exists (
           select 1 from pg_policies
           where schemaname = 'public' and tablename = 'game_invites'
             and policyname = 'game invites readable by the pair'
         ) then 'ok' else 'MISSING' end, '23'
  union all
  select 'realtime: game_invites',
         case when exists (
           select 1 from pg_publication_tables
           where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_invites'
         ) then 'ok' else 'MISSING' end, '23'
) as checklist
order by section, object;
