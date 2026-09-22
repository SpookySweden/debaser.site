-- -----------------------------------------------------------------------------
-- 18. Pinned posts: the moderator's mark, and how long it lasts.
-- -----------------------------------------------------------------------------
-- Run this whole file in the Supabase SQL Editor on a project that has already had
-- `supabase/schema.sql` run against it. Re-running it is safe.
--
-- A pin holds one post at the top of the board and leads the wire, until a set time runs out or
-- forever. It is a row of its own rather than a column on the thread because it is not part of
-- what was written - it is the archive's decision about somebody's post, and it can be taken back
-- without touching the post.
--
-- `expires_at` is null for a pin that never runs out. Nothing has to sweep a lapsed pin up: the
-- client (app/lib/forum/pins.ts) simply stops counting it, and the read below stays open so that
-- a screen can say when a pin went. There is no cron job in this design, deliberately - the
-- alternative is a scheduled task that has to exist for a pin to stop working.
--
-- Who may pin: the house account, and only it - the same `is_admin()` that lets it edit or remove
-- a post. A pin is the archive speaking, so the row is signed with the account that took it
-- (`pinned_by = auth.uid()`), and the label beside it is that account's name as it was then.

-- 1. The table. One row per pinned post.

create table if not exists public.forum_pins (
  -- The post that is pinned. One pin per post, and removing the post removes the pin with it.
  thread_id uuid primary key references public.forum_threads (id) on delete cascade,
  -- Who pinned it. Kept nullable so deleting that account does not un-pin the announcement.
  pinned_by uuid references auth.users (id) on delete set null,
  -- The pinner's name as it was at the time, which is what the board prints.
  pinned_by_label text not null default 'debaser.site',
  pinned_at timestamptz not null default now(),
  -- Null means forever; anything else is the moment the pin stops counting.
  expires_at timestamptz
);

-- The board reads the live pins in one go, newest first.
create index if not exists forum_pins_active_idx on public.forum_pins (pinned_at desc);

alter table public.forum_pins enable row level security;

-- 2. The policies: public to read, the moderator's alone to change.
--
-- Read is open, like the board it decorates - a pin has to be visible to the visitors it is
-- meant for, and hiding a lapsed one here would take away the only place that can say when it
-- went. Writing is the house account's, and the insert is signed by it.

drop policy if exists "forum_pins readable" on public.forum_pins;
create policy "forum_pins readable" on public.forum_pins
  for select using (true);

drop policy if exists "forum_pins pinned by admin" on public.forum_pins;
create policy "forum_pins pinned by admin" on public.forum_pins
  for insert with check (public.is_admin() and pinned_by = auth.uid());

-- Extending a deadline is an update, so the admin's own pin can be re-pinned without an unpin
-- first, and the row can never change hands.
drop policy if exists "forum_pins changed by admin" on public.forum_pins;
create policy "forum_pins changed by admin" on public.forum_pins
  for update using (public.is_admin()) with check (public.is_admin() and pinned_by = auth.uid());

drop policy if exists "forum_pins removed by admin" on public.forum_pins;
create policy "forum_pins removed by admin" on public.forum_pins
  for delete using (public.is_admin());

-- 3. Realtime: the top of the board moves on every open board when a pin is taken or dropped.
--
-- Guarded the way section 9 does it, so this file stays re-runnable.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'forum_pins'
  ) then
    alter publication supabase_realtime add table public.forum_pins;
  end if;
end $$;

-- 4. A test pin, so the feature has something in it.
--
-- Written by the house account and pinned forever, which is the state a standing notice is in.
-- Guarded by title, so running this file twice does not leave two of them. To take it away
-- (either before or after the pin is dropped from the panel in the app):
--
--   delete from public.forum_threads where title = 'PINNED TO THE TOP' and anchor_kind = 'board';

insert into public.forum_threads (
  title, body, author_id, author_label, anchor_kind, anchor_id, anchor_label, tags
)
select
  'PINNED TO THE TOP',
  'This is the archive''s first pinned post, and it is here to show the shape of one: it sits at '
    || 'the top of the board whatever else has been filed since, and it leads the newswire at the '
    || 'top of the page as it crawls past. A pin is taken by a moderator - debaser.site, for now '
    || 'the only one - from `[ PIN POST ]` on any post, for an hour, a day, a week, a month, or '
    || 'forever like this one. Take the pin off from the same control, or from the moderators'' '
    || 'panel at the top of the board.',
  u.id,
  'debaser.site',
  'board',
  'board-general',
  'GENERAL BOARD',
  '[]'::jsonb
from auth.users u
where lower(u.email) = 'admin1212@debaser.site'
  and not exists (
    select 1 from public.forum_threads t
    where t.title = 'PINNED TO THE TOP' and t.anchor_kind = 'board'
  );

insert into public.forum_pins (thread_id, pinned_by, pinned_by_label, expires_at)
select t.id, t.author_id, 'debaser.site', null
from public.forum_threads t
where t.title = 'PINNED TO THE TOP' and t.anchor_kind = 'board'
on conflict (thread_id) do nothing;

-- 5. Check it landed. Run these on their own afterwards; each should answer without an error.
--
--   select tablename, rowsecurity from pg_tables
--     where schemaname = 'public' and tablename = 'forum_pins';
--   select policyname, cmd from pg_policies
--     where schemaname = 'public' and tablename = 'forum_pins' order by cmd;
--   select tablename from pg_publication_tables
--     where pubname = 'supabase_realtime' and tablename = 'forum_pins';
--   select t.title, p.pinned_by_label, p.pinned_at, p.expires_at
--     from public.forum_pins p join public.forum_threads t on t.id = p.thread_id
--     order by p.pinned_at desc;
--
-- Then reload /forum: the test post should be at the top of the list carrying `PINNED FOREVER`,
-- the wire should lead with it, and - signed in as debaser.site - the moderators' panel should
-- list it with an `[ UNPIN ]`.
