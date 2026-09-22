-- -----------------------------------------------------------------------------
-- 17. Notifications: who was tagged, and who was answered.
-- -----------------------------------------------------------------------------
-- Run this whole file in the Supabase SQL Editor (Dashboard -> SQL Editor) on a project that
-- has already had `supabase/schema.sql` run against it. Re-running it is safe: every statement
-- either replaces what it finds or is skipped when it is already true.
--
-- What it adds: one table, `public.forum_notifications`, one row per account told. A post that
-- names somebody with `@name` files a `'tag'`; a reply files a `'reply'` for whoever wrote the
-- post or the comment it answers. The row carries enough to draw the whole menu - who did it,
-- which post, a snippet of the words, and when - so the bell never has to read the board to
-- explain itself.
--
-- Why it is its own table rather than a column on the board: a post is read by everybody, a
-- notification is read by one account. A tag has to be a row that exactly one account can list,
-- mark seen and delete - which is what RLS is for. The rules, and why each one is there:
--
--   read     only the account the row names            (a feed is private)
--   insert   only signed by the tagger or replier,     (nobody can fake whose words they are)
--            never addressed to themselves,            (no self-notifications)
--            and never by a banned account            (same rule every other write carries)
--   update   only by the recipient,                    (marking it seen is a read receipt)
--   delete   only by the recipient                     (their feed, their choice)
--
-- The reader side is app/lib/notifications/supabase-notifications-repository.ts; the client
-- picks it up when the board is on Supabase (NEXT_PUBLIC_NOTIFICATIONS_DATA_SOURCE, or the
-- board's own setting - see app/lib/notifications/repository.ts).

-- 1. The table. One row per account told.

create table if not exists public.forum_notifications (
  id uuid primary key default gen_random_uuid(),
  -- Who is being told. Deleting that account takes its feed with it.
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 'tag': somebody named them. 'reply': somebody answered them.
  kind text not null check (kind in ('tag', 'reply')),
  -- Who did it. Kept nullable so that deleting the tagger's account does not delete the news.
  actor_id uuid references auth.users (id) on delete set null,
  -- The tagger's name as it was at the time. `actor_id` is the truth; this is what to print.
  actor_name text not null default 'Anonymous',
  -- The post it happened on. Removed post, removed news.
  thread_id uuid references public.forum_threads (id) on delete cascade,
  -- The post's title at the time, so the menu can name it without a second read.
  thread_title text not null default '',
  -- The words themselves, already shortened by the writer's client (120 characters).
  body text not null default '',
  created_at timestamptz not null default now(),
  -- Null while unread: that is the dot on the bell, and the row that draws white.
  read_at timestamptz
);

-- The feed is read newest-first for one account; that is the only query there is.
create index if not exists forum_notifications_user_idx
  on public.forum_notifications (user_id, created_at desc);

alter table public.forum_notifications enable row level security;

-- 2. The policies. Four, one per verb, each about the account the row names.

-- The feed belongs to its recipient and to nobody else. No admin read: the admin may take a
-- post down, but not read somebody's notifications.
drop policy if exists "forum_notifications readable by recipient" on public.forum_notifications;
create policy "forum_notifications readable by recipient" on public.forum_notifications
  for select using (user_id = auth.uid());

-- Written by whoever tags or answers: signed by them (`actor_id = auth.uid()`, so the row cannot
-- claim to be somebody else's words), addressed to somebody else (no self-notifications, which
-- the client also refuses), and not by a banned account - the same clause every other write in
-- this schema carries.
drop policy if exists "forum_notifications inserted by actor" on public.forum_notifications;
create policy "forum_notifications inserted by actor" on public.forum_notifications
  for insert with check (
    not public.is_banned()
    and actor_id = auth.uid()
    and user_id <> auth.uid()
  );

-- Seen or unseen is the recipient's to say, and only theirs. The row cannot be re-addressed by
-- an update: `with check` holds `user_id` to the account making the change.
drop policy if exists "forum_notifications marked read by recipient" on public.forum_notifications;
create policy "forum_notifications marked read by recipient" on public.forum_notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "forum_notifications deleted by recipient" on public.forum_notifications;
create policy "forum_notifications deleted by recipient" on public.forum_notifications
  for delete using (user_id = auth.uid());

-- 3. Realtime: the bell lights up while the page is open, without a reload.
--
-- Guarded, the way section 9 does it: a table that is already in the publication makes
-- `alter publication ... add table` an error, and this file has to stay re-runnable.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'forum_notifications'
  ) then
    alter publication supabase_realtime add table public.forum_notifications;
  end if;
end $$;

-- 4. Check it landed. Run these on their own afterwards; each should answer without an error.
--
--   select tablename, rowsecurity from pg_tables
--     where schemaname = 'public' and tablename = 'forum_notifications';
--   select policyname, cmd from pg_policies
--     where schemaname = 'public' and tablename = 'forum_notifications' order by cmd;
--   select tablename from pg_publication_tables
--     where pubname = 'supabase_realtime' and tablename = 'forum_notifications';
--   -- and, once somebody has been tagged, your own feed:
--   select kind, actor_name, thread_title, created_at, read_at
--     from public.forum_notifications where user_id = auth.uid()
--     order by created_at desc limit 20;
--
-- Then reload the site: the bell at the top of the side panel's comms block should read
-- `[ ! ] NOTIFICATIONS`, and tagging somebody in a post should light it up for them.
