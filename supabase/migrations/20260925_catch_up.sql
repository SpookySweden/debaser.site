-- -----------------------------------------------------------------------------
-- CATCH-UP: everything the live project is missing, in one paste.
-- -----------------------------------------------------------------------------
-- Run this whole file in the Supabase SQL Editor. It is the last three sections of
-- `supabase/schema.sql`, cut out as one file, for a project that was built before they existed and
-- has had them run in some order that left gaps. Every statement is written to be re-run: tables
-- are `if not exists`, policies are dropped and recreated by name, functions are
-- `create or replace`, and the realtime entries are guarded. Pasting it twice changes nothing.
--
-- What it puts in place, and what each one is for:
--
--   section 16  A group belongs to whoever opened it. `comms_threads` is granted for update on
--               `updated_at` only, a trigger refuses metadata changes by anybody but the owner,
--               and four functions (`rename_group`, `transfer_group_ownership`,
--               `remove_group_member`, `leave_group`) are the only door.
--   section 17  Tags and replies: `forum_notifications`, one row per account told, readable and
--               markable by that account alone. This is what the bell reads.
--   section 18  Pinned posts: `forum_pins`, one row per pinned post, written by the house account
--               only, read by everybody.
--
-- How this file was diagnosed, so the next person knows it was not a guess: against the live
-- project, with the publishable key, `GET /rest/v1/forum_notifications` answers
--
--   {"code":"PGRST205","message":"Could not find the table 'public.forum_notifications'"}
--
-- while `forum_pins` answers with the test pin, which is exactly the state this file is written
-- against. The checklist at the foot of the file is the same test, run from inside the database.

-- =============================================================================
-- SECTIONS 16 - 18 (verbatim from supabase/schema.sql)
-- =============================================================================

-- 16. A group belongs to whoever opened it.
--
-- The report: somebody invited to a group renamed it and claimed it as his own. Both are a
-- direct write to `public.comms_threads` - `name` and `created_by` - and the update policy
-- said yes to either, because it asked only "are you in this conversation". Confirmed against
-- this project before the fix, as a member, writing the values that were already there:
--
--   a member writes the group name            ALLOWED :: 1 row(s) written
--   a member writes the ownership column      ALLOWED :: 1 row(s) written
--
-- The same policy let a member add *himself* to any group he could name ("adding yourself" was
-- allowed for its own sake, so the creator could get into a group they had just made), which
-- is a reading hole as well as an ownership one: being in a group is what makes its messages
-- readable.
--
-- Three layers, in the order they can be trusted:
--
--   1. the client may write exactly one column, `updated_at` - the stamp `sendMessage` puts on
--      a conversation. Every other column is granted away, so a PATCH of `name` is refused by
--      the table itself, before a policy is consulted at all;
--   2. a trigger refuses a change to the metadata unless the caller is the owner (or the house
--      account, which repairs what it must). A policy re-created by hand later cannot quietly
--      re-open the hole;
--   3. the changes that should happen go through functions that check first - `rename_group`,
--      `transfer_group_ownership`, `remove_group_member`, `leave_group` - and ownership only
--      moves two ways: the owner hands it over, or the owner leaves and it passes to whoever
--      has been in the group longest.
--
-- Re-running this file is safe: every statement replaces what it finds.

-- 1. One column of a thread belongs to the client.

revoke update on public.comms_threads from anon, authenticated;
grant update (updated_at) on public.comms_threads to authenticated;

-- 2. Groups can be opened at all: section 12 re-created this policy without the `created_by`
--    case, and a group has no pair to be "in" - its members cannot exist before it does.

drop policy if exists "comms threads insert by participant" on public.comms_threads;
create policy "comms threads insert by participant" on public.comms_threads
  for insert with check (
    not public.is_banned()
    and (auth.uid() in (participant_a, participant_b) or created_by = auth.uid())
  );

-- Who owns a conversation: the account that opened it, or either side of a dm. Definer and
-- stable, like `is_comms_member`, so a policy can ask it without recursing through the
-- threads' own policies.

create or replace function public.is_comms_owner(thread text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.comms_threads t
    where t.id = thread
      and (t.created_by = auth.uid() or auth.uid() in (t.participant_a, t.participant_b))
  );
$$;

-- 3. Adding people: anybody in it may add somebody else; adding *yourself* only works in a
--    conversation you opened, which is what gets a new group's creator into their own group.

drop policy if exists "comms members added by members" on public.comms_members;
create policy "comms members added by members" on public.comms_members
  for insert with check (
    not public.is_banned()
    and (
      (user_id = auth.uid() and public.is_comms_owner(thread_id))
      or public.is_comms_member(thread_id)
    )
  );

-- 4. The guard: nothing touches a conversation's metadata but its owner. `auth.uid()` inside a
--    trigger is still the caller's, whoever's privileges the function body runs with, so this
--    holds for a definer function, a policy and a console session alike. A null caller is the
--    SQL editor or the service role - the way a repair is made - and is left alone.

create or replace function public.comms_threads_guard_metadata()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if new.created_by is distinct from old.created_by and new.created_by is not null then
    if not exists (
      select 1 from public.comms_members m
      where m.thread_id = new.id and m.user_id = new.created_by
    ) then
      raise exception 'the owner of a conversation has to be in it' using errcode = 'check_violation';
    end if;
  end if;

  if new.name is distinct from old.name
     or new.kind is distinct from old.kind
     or new.created_by is distinct from old.created_by
     or new.participant_a is distinct from old.participant_a
     or new.participant_b is distinct from old.participant_b then
    if caller is not null and caller is distinct from old.created_by and not public.is_admin() then
      raise exception 'only the owner of a group may change it' using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists comms_threads_guard_metadata on public.comms_threads;
create trigger comms_threads_guard_metadata
  before update on public.comms_threads
  for each row execute function public.comms_threads_guard_metadata();


-- 5. The four things that may change a group, each checking for itself. They are definer
--    functions so that the column grant above cannot stand in their way, and they are the only
--    door: the app calls these rather than writing the table.

-- Renaming: the owner's, or the house account's when something has to be put right.
create or replace function public.rename_group(thread text, new_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  trimmed text := btrim(coalesce(new_name, ''));
begin
  if not (public.is_comms_owner(thread) or public.is_admin()) then
    raise exception 'only the owner may rename a group' using errcode = 'insufficient_privilege';
  end if;

  if trimmed = '' or length(trimmed) > 40 then
    raise exception 'a group name is between 1 and 40 characters' using errcode = 'check_violation';
  end if;

  update public.comms_threads set name = trimmed where id = thread and kind = 'group';
end;
$$;

-- Handing it over: the owner's choice, to somebody already in the group.
create or replace function public.transfer_group_ownership(thread text, to_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_comms_owner(thread) or public.is_admin()) then
    raise exception 'only the owner may hand a group over' using errcode = 'insufficient_privilege';
  end if;

  if to_user is null
     or not exists (select 1 from public.comms_members m where m.thread_id = thread and m.user_id = to_user) then
    raise exception 'a group can only be handed to somebody in it' using errcode = 'check_violation';
  end if;

  if public.is_banned(to_user) then
    raise exception 'that account is banned' using errcode = 'check_violation';
  end if;

  update public.comms_threads set created_by = to_user where id = thread and kind = 'group';
end;
$$;

-- Leaving: anybody in it. The owner leaving passes the group to whoever has been in it longest,
-- and the last member out takes the group with them - a group nobody is in cannot be read by
-- anybody, so leaving it behind would only be litter.
create or replace function public.leave_group(thread text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  leaver uuid := auth.uid();
  successor uuid;
begin
  if leaver is null then
    raise exception 'leaving needs a signed-in account' using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.comms_members m where m.thread_id = thread and m.user_id = leaver
  ) then
    raise exception 'you are not in this conversation' using errcode = 'check_violation';
  end if;

  delete from public.comms_members m where m.thread_id = thread and m.user_id = leaver;

  if exists (select 1 from public.comms_threads t where t.id = thread and t.created_by = leaver) then
    select m.user_id into successor
    from public.comms_members m
    where m.thread_id = thread
    order by m.joined_at, m.user_id
    limit 1;

    if successor is null then
      delete from public.comms_threads t where t.id = thread;
    else
      update public.comms_threads set created_by = successor where id = thread;
    end if;
  end if;
end;
$$;

-- Taking somebody else out: the owner's (or the house account's). You can always take yourself
-- out by leaving.
create or replace function public.remove_group_member(thread text, user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_comms_owner(thread) or public.is_admin()) then
    raise exception 'only the owner may remove a member' using errcode = 'insufficient_privilege';
  end if;

  if user_id = auth.uid() then
    perform public.leave_group(thread);
    return;
  end if;

  delete from public.comms_members m where m.thread_id = thread and m.user_id = user_id;
end;
$$;

-- The app reaches these with the signed-in role, and nothing else may.
revoke all on function public.rename_group(text, text) from public, anon;
revoke all on function public.transfer_group_ownership(text, uuid) from public, anon;
revoke all on function public.leave_group(text) from public, anon;
revoke all on function public.remove_group_member(text, uuid) from public, anon;

grant execute on function public.rename_group(text, text) to authenticated;
grant execute on function public.transfer_group_ownership(text, uuid) to authenticated;
grant execute on function public.leave_group(text) to authenticated;
grant execute on function public.remove_group_member(text, uuid) to authenticated;

-- 6. Putting right what was taken.
--
-- Ownership on this project reads correctly for the group in the report
-- (`grp:3f7e8deb-bb01-4424-8692-14e252d10409` is owned by 640d9861..., the account that opened
-- it), so nothing needs repairing today. If a group was taken, the owner is one statement away -
-- the SQL editor is not a client, so the guard above steps aside for it:
--
--   update public.comms_threads
--      set created_by = '<the account that opened it>'
--    where id = 'grp:...' and kind = 'group';
--
-- The house account can also do it from the app once this file is in, through
-- `transfer_group_ownership()`, which accepts it as the moderator.

-- -----------------------------------------------------------------------------
-- 17. Notifications: who was tagged, and who was answered.
-- -----------------------------------------------------------------------------
-- Also shipped on its own as supabase/migrations/20260923_notifications.sql, for a project that
-- has already had the rest of this file run against it.
--
-- One table, `public.forum_notifications`, one row per account told: a post that names somebody
-- with `@name` files a `'tag'`, and a reply files a `'reply'` for whoever wrote the post or the
-- comment it answers. The row carries enough to draw the whole menu - who did it, which post, a
-- snippet of the words, and when - so the bell never has to read the board to explain itself.
--
-- Why it is its own table rather than a column on the board: a post is read by everybody, a
-- notification is read by one account. A tag has to be a row that exactly one account can list,
-- mark seen and delete - which is what RLS is for. Read by
-- app/lib/notifications/supabase-notifications-repository.ts.

create table if not exists public.forum_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 'tag': somebody named them. 'reply': somebody answered them.
  kind text not null check (kind in ('tag', 'reply')),
  actor_id uuid references auth.users (id) on delete set null,
  actor_name text not null default 'Anonymous',
  thread_id uuid references public.forum_threads (id) on delete cascade,
  thread_title text not null default '',
  body text not null default '',
  created_at timestamptz not null default now(),
  -- Null while unread: that is the dot on the bell, and the row that draws white.
  read_at timestamptz
);

create index if not exists forum_notifications_user_idx
  on public.forum_notifications (user_id, created_at desc);

alter table public.forum_notifications enable row level security;

drop policy if exists "forum_notifications readable by recipient" on public.forum_notifications;
create policy "forum_notifications readable by recipient" on public.forum_notifications
  for select using (user_id = auth.uid());

drop policy if exists "forum_notifications inserted by actor" on public.forum_notifications;
create policy "forum_notifications inserted by actor" on public.forum_notifications
  for insert with check (
    not public.is_banned()
    and actor_id = auth.uid()
    and user_id <> auth.uid()
  );

drop policy if exists "forum_notifications marked read by recipient" on public.forum_notifications;
create policy "forum_notifications marked read by recipient" on public.forum_notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "forum_notifications deleted by recipient" on public.forum_notifications;
create policy "forum_notifications deleted by recipient" on public.forum_notifications
  for delete using (user_id = auth.uid());

-- Realtime, guarded the way section 9 does it, so this block stays safe to re-run.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'forum_notifications'
  ) then
    alter publication supabase_realtime add table public.forum_notifications;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 18. Pinned posts: the moderator's mark, and how long it lasts.
-- -----------------------------------------------------------------------------
-- Also shipped on its own as supabase/migrations/20260924_forum_pins.sql, for a project that has
-- already had the rest of this file run against it.
--
-- A pin holds one post at the top of the board and leads the wire, until a set time runs out or
-- forever. It is a row of its own rather than a column on the thread because it is not part of
-- what was written - it is the archive's decision about somebody's post. `expires_at` null means
-- forever; nothing sweeps a lapsed pin up, the client simply stops counting it
-- (app/lib/forum/pins.ts), so a pin does not depend on a scheduled job to stop working.
--
-- Who may pin: the house account, and only it - the same `is_admin()` that lets it edit or remove
-- a post - and the row is signed with the account that took it. Read by
-- app/lib/forum/supabase-repository.ts.

create table if not exists public.forum_pins (
  thread_id uuid primary key references public.forum_threads (id) on delete cascade,
  pinned_by uuid references auth.users (id) on delete set null,
  pinned_by_label text not null default 'debaser.site',
  pinned_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists forum_pins_active_idx on public.forum_pins (pinned_at desc);

alter table public.forum_pins enable row level security;

drop policy if exists "forum_pins readable" on public.forum_pins;
create policy "forum_pins readable" on public.forum_pins
  for select using (true);

drop policy if exists "forum_pins pinned by admin" on public.forum_pins;
create policy "forum_pins pinned by admin" on public.forum_pins
  for insert with check (public.is_admin() and pinned_by = auth.uid());

drop policy if exists "forum_pins changed by admin" on public.forum_pins;
create policy "forum_pins changed by admin" on public.forum_pins
  for update using (public.is_admin()) with check (public.is_admin() and pinned_by = auth.uid());

drop policy if exists "forum_pins removed by admin" on public.forum_pins;
create policy "forum_pins removed by admin" on public.forum_pins
  for delete using (public.is_admin());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'forum_pins'
  ) then
    alter publication supabase_realtime add table public.forum_pins;
  end if;
end $$;

-- =============================================================================
-- THE CHECKLIST: what is in place now, in one result.
-- =============================================================================
-- Run this on its own after the file above. Every row should read `ok`; anything reading
-- `MISSING` is a statement above that did not take, and the section column says where to look.

select object, state, section from (
  select 'table: forum_notifications' as object,
         case when to_regclass('public.forum_notifications') is null then 'MISSING' else 'ok' end as state,
         '17' as section
  union all
  select 'table: forum_pins',
         case when to_regclass('public.forum_pins') is null then 'MISSING' else 'ok' end, '18'
  union all
  select 'column: comms_threads.created_by',
         case when exists (
           select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'comms_threads' and column_name = 'created_by'
         ) then 'ok' else 'MISSING' end, '16'
  union all
  select 'column: comms_threads.kind',
         case when exists (
           select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'comms_threads' and column_name = 'kind'
         ) then 'ok' else 'MISSING' end, '16'
  union all
  select 'function: rename_group',
         case when to_regprocedure('public.rename_group(text,text)') is null then 'MISSING' else 'ok' end, '16'
  union all
  select 'function: transfer_group_ownership',
         case when to_regprocedure('public.transfer_group_ownership(text,uuid)') is null then 'MISSING' else 'ok' end, '16'
  union all
  select 'function: remove_group_member',
         case when to_regprocedure('public.remove_group_member(text,uuid)') is null then 'MISSING' else 'ok' end, '16'
  union all
  select 'function: leave_group',
         case when to_regprocedure('public.leave_group(text)') is null then 'MISSING' else 'ok' end, '16'
  union all
  select 'trigger: comms_threads_guard_metadata',
         case when exists (
           select 1 from pg_trigger where tgname = 'comms_threads_guard_metadata'
         ) then 'ok' else 'MISSING' end, '16'
  union all
  select 'policy: forum_notifications readable by recipient',
         case when exists (
           select 1 from pg_policies
           where schemaname = 'public' and tablename = 'forum_notifications'
             and policyname = 'forum_notifications readable by recipient'
         ) then 'ok' else 'MISSING' end, '17'
  union all
  select 'policy: forum_notifications inserted by actor',
         case when exists (
           select 1 from pg_policies
           where schemaname = 'public' and tablename = 'forum_notifications'
             and policyname = 'forum_notifications inserted by actor'
         ) then 'ok' else 'MISSING' end, '17'
  union all
  select 'policy: forum_pins pinned by admin',
         case when exists (
           select 1 from pg_policies
           where schemaname = 'public' and tablename = 'forum_pins'
             and policyname = 'forum_pins pinned by admin'
         ) then 'ok' else 'MISSING' end, '18'
  union all
  select 'realtime: forum_notifications',
         case when exists (
           select 1 from pg_publication_tables
           where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'forum_notifications'
         ) then 'ok' else 'MISSING' end, '17'
  union all
  select 'realtime: forum_pins',
         case when exists (
           select 1 from pg_publication_tables
           where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'forum_pins'
         ) then 'ok' else 'MISSING' end, '18'
) as checklist
order by section, object;

