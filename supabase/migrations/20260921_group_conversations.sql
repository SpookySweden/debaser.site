-- ---------------------------------------------------------------------------
-- Group conversations: the database half of `[ + NEW GROUP ]` on /comms
-- ---------------------------------------------------------------------------
-- Run this in the Supabase SQL editor (Dashboard -> SQL Editor -> New query) on a
-- project whose `comms_*` tables predate groups. It is section 13 of
-- supabase/schema.sql as a file you can paste on its own, and it is written to be
-- re-run: every statement either adds what is missing or replaces a policy by name.
--
-- Why it is needed: a direct conversation is a pair of accounts, and its id is
-- derived from the pair (`dm:<low id>|<high id>`), which is why a dm needs nothing
-- but `comms_threads`. A group has no pair to derive anything from, so it needs
--   * `kind` ('dm' or 'group'), `name` and `created_by` on `comms_threads`,
--   * optional `participant_a` / `participant_b` (a group stores no pair at all),
--   * `comms_members`: who is in the conversation, which is the whole answer for a
--     group and a convenience for a dm.
-- Until this runs, the site is honest about it: `[ + NEW GROUP ]` says the database
-- needs the update, and direct messages work exactly as before.
--
-- If you change anything here, change section 13 of supabase/schema.sql too: that
-- file is what a fresh project is built from, and this one is only the catch-up.

-- 0. What this file leans on ------------------------------------------------
-- The policies below ask `public.is_banned()`, which section 12 of schema.sql
-- creates. A project without it gets told rather than half-migrated.
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_banned'
  ) then
    raise exception 'Run supabase/schema.sql first: public.is_banned() is missing.';
  end if;
end $$;

-- 1. A conversation that is not a pair --------------------------------------
alter table public.comms_threads add column if not exists kind text not null default 'dm';
alter table public.comms_threads add column if not exists name text not null default '';
alter table public.comms_threads add column if not exists created_by uuid references auth.users (id) on delete set null;
alter table public.comms_threads alter column participant_a drop not null;
alter table public.comms_threads alter column participant_b drop not null;

alter table public.comms_threads drop constraint if exists comms_threads_kind_check;
alter table public.comms_threads add constraint comms_threads_kind_check check (kind in ('dm', 'group'));

create index if not exists comms_threads_updated_idx on public.comms_threads (updated_at desc);

-- 2. Who is in it -----------------------------------------------------------
create table if not exists public.comms_members (
  thread_id text not null references public.comms_threads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create index if not exists comms_members_user_idx on public.comms_members (user_id);

alter table public.comms_members enable row level security;

-- Definer and stable, so a policy on comms_members - or on the messages - can ask it
-- without recursing through comms_members' own policy.
create or replace function public.is_comms_member(thread text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.comms_members m
    where m.thread_id = thread and m.user_id = auth.uid()
  );
$$;

-- Every conversation that already existed becomes a membership row per side.
insert into public.comms_members (thread_id, user_id)
  select id, participant_a from public.comms_threads where participant_a is not null
  on conflict do nothing;

insert into public.comms_members (thread_id, user_id)
  select id, participant_b from public.comms_threads where participant_b is not null
  on conflict do nothing;


-- 3. The rules ---------------------------------------------------------------
-- Reading a conversation: you are in it (membership), or you are one of its pair - a
-- dm filed before the membership table existed, or by a client that predates it.
drop policy if exists "comms threads readable by participants" on public.comms_threads;
create policy "comms threads readable by participants" on public.comms_threads
  for select using (
    auth.uid() in (participant_a, participant_b) or public.is_comms_member(id)
  );

-- A dm is still inserted by one of its pair; a group is inserted by whoever opened it
-- (`created_by`), because the membership row cannot exist before the thread does.
drop policy if exists "comms threads insert by participant" on public.comms_threads;
create policy "comms threads insert by participant" on public.comms_threads
  for insert with check (
    not public.is_banned()
    and (auth.uid() in (participant_a, participant_b) or created_by = auth.uid())
  );

drop policy if exists "comms threads update by participant" on public.comms_threads;
create policy "comms threads update by participant" on public.comms_threads
  for update using (
    not public.is_banned()
    and (auth.uid() in (participant_a, participant_b) or public.is_comms_member(id))
  )
  with check (auth.uid() in (participant_a, participant_b) or public.is_comms_member(id));

-- The member list: readable by the people in it, and only they may change it. Adding
-- yourself is how a group is created; adding anybody else needs you to be in it.
drop policy if exists "comms members readable by members" on public.comms_members;
create policy "comms members readable by members" on public.comms_members
  for select using (public.is_comms_member(thread_id) or user_id = auth.uid());

drop policy if exists "comms members added by members" on public.comms_members;
create policy "comms members added by members" on public.comms_members
  for insert with check (
    not public.is_banned()
    and (user_id = auth.uid() or public.is_comms_member(thread_id))
  );

drop policy if exists "comms members leave" on public.comms_members;
create policy "comms members leave" on public.comms_members
  for delete using (user_id = auth.uid());

-- Closing a group: whoever opened it can take it down (messages cascade), and either
-- side of a dm can clear the conversation they are in.
drop policy if exists "comms threads deleted by the creator" on public.comms_threads;
create policy "comms threads deleted by the creator" on public.comms_threads
  for delete using (created_by = auth.uid() or auth.uid() in (participant_a, participant_b));

-- Messages follow the same rule, with the ban check section 12 added.
drop policy if exists "comms messages readable by participants" on public.comms_messages;
create policy "comms messages readable by participants" on public.comms_messages
  for select using (
    exists (
      select 1 from public.comms_threads t
      where t.id = thread_id
        and (auth.uid() in (t.participant_a, t.participant_b) or public.is_comms_member(t.id))
    )
  );

drop policy if exists "comms messages insert own" on public.comms_messages;
create policy "comms messages insert own" on public.comms_messages
  for insert with check (
    author_id = auth.uid()
    and not public.is_banned()
    and exists (
      select 1 from public.comms_threads t
      where t.id = thread_id
        and (auth.uid() in (t.participant_a, t.participant_b) or public.is_comms_member(t.id))
    )
  );

-- A read marker belongs to the account it is about, and to nobody else.
drop policy if exists "comms reads own" on public.comms_reads;
create policy "comms reads own" on public.comms_reads
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 4. Realtime: a group you are added to should appear without a reload ---------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comms_members'
  ) then
    alter publication supabase_realtime add table public.comms_members;
  end if;
end $$;

-- 5. Check it landed ---------------------------------------------------------
-- Run these on their own afterwards; each should answer without an error.
--
--   select column_name, is_nullable, column_default
--     from information_schema.columns
--     where table_schema = 'public' and table_name = 'comms_threads'
--     order by ordinal_position;
--
--   select thread_id, user_id from public.comms_members limit 5;
--
--   select tablename, rowsecurity from pg_tables
--     where schemaname = 'public' and tablename like 'comms%' order by tablename;
--
--   select tablename, policyname, cmd from pg_policies
--     where schemaname = 'public' and tablename like 'comms%' order by tablename, policyname;
