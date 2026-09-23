-- -----------------------------------------------------------------------------
-- 19. Pinned comments on a profile: the owner's mark, and what it may not touch.
-- -----------------------------------------------------------------------------
-- Run this whole file in the Supabase SQL Editor on a project that has already had
-- `supabase/schema.sql` run against it. Re-running it is safe: the columns are `if not exists`,
-- the index too, the policy and the trigger are dropped and recreated by name, and the realtime
-- entry is guarded.
--
-- The board's pin in miniature, and without a deadline. Pinning a comment on your own profile does
-- one thing: it takes the leading row of every run of three on that profile's wire
-- (app/lib/profile/feed.ts), so a remark the page wants read keeps coming back round as the strip
-- goes past. Nothing sweeps a pin up - it stays until the owner takes it off.
--
-- It is a pair of columns on the comment rather than a table of its own, which is the opposite of
-- what `forum_pins` (section 18) does, deliberately. A board pin is the *archive's* decision about
-- somebody else's post and outlives edits to it, while a profile pin is the page owner's own mark
-- on a comment that lives on that page and dies with it: one row per comment, two columns, nothing
-- to join. `pinned_at` is there because pins lead the wire in turn and the newest takes the first
-- turn.
--
-- Who may pin: the profile's owner, on any comment their page carries - the remarks on the profile
-- itself, and the ones left on the picture and the track, because the feed that runs under the
-- columns carries all three (app/lib/profile/feed.ts). The update policy below is what lets that
-- write through; the guard trigger is what keeps it a pin rather than an edit, because a policy
-- cannot say which columns a write may touch - and without the trigger the policy would hand the
-- owner the right to rewrite what somebody said about them.

-- 1. The two columns.

alter table public.profile_comments
  add column if not exists pinned boolean not null default false;

alter table public.profile_comments
  add column if not exists pinned_at timestamptz;

-- The wire reads a profile's comments with the pinned ones to hand, newest pin first.
create index if not exists profile_comments_pinned_idx
  on public.profile_comments (user_id, pinned_at desc) where pinned;

-- 2. The policies: the owner's pin, and the author's words.

drop policy if exists "profile comments pinned by owner" on public.profile_comments;
create policy "profile comments pinned by owner" on public.profile_comments
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- The guard. `auth.uid()` inside a trigger is still the caller's, whoever's privileges the body
-- runs with (the same note section 16 makes), and a null caller is the SQL editor or the service
-- role - the way a repair is made - and is left alone.
create or replace function public.profile_comments_guard_pin()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if new.user_id is distinct from old.user_id
     or new.kind is distinct from old.kind
     or new.author_id is distinct from old.author_id
     or new.author_label is distinct from old.author_label
     or new.body is distinct from old.body
     or new.created_at is distinct from old.created_at
     or new.avatar_version_id is distinct from old.avatar_version_id
     or new.song_version_id is distinct from old.song_version_id then
    if caller is not null and caller is distinct from old.author_id then
      raise exception 'only the author may change a comment - the profile owner may take its pin on and off'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profile_comments_guard_pin on public.profile_comments;
create trigger profile_comments_guard_pin
  before update on public.profile_comments
  for each row execute function public.profile_comments_guard_pin();

-- 3. Realtime: the wire and the comments list move on every open profile when a pin is taken or
--    dropped.
--
-- `profile_comments` had never been published, so a comment on a profile has never appeared on an
-- open page without a reload: the profile channel subscribes to it (see
-- app/lib/profile/supabase-profile-repository.ts) and a channel bound to a table that is not in
-- the publication reports SUBSCRIBED and then delivers nothing at all - from any of its tables.
-- Guarded like every other entry, so this file stays re-runnable.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profile_comments'
  ) then
    alter publication supabase_realtime add table public.profile_comments;
  end if;
end $$;

-- 4. Check it landed. Run these on their own afterwards; each should answer without an error.
--
--   select column_name, data_type, column_default from information_schema.columns
--     where table_schema = 'public' and table_name = 'profile_comments' order by ordinal_position;
--   select policyname, cmd from pg_policies
--     where schemaname = 'public' and tablename = 'profile_comments' order by cmd;
--   select tgname from pg_trigger where tgrelid = 'public.profile_comments'::regclass;
--   select tablename from pg_publication_tables
--     where pubname = 'supabase_realtime' and tablename = 'profile_comments';
--
-- Then open your own profile: `comment` -> `general`, the arrow beside `general` unfolds the list
-- of comments left on the page, and each one carries a small blue pin. Press one and it says
-- `PINNED`, the count in the panel's title bar gains `:: 1 PINNED`, and the wire under the columns
-- leads a run of three with it. Press it again and it goes back among the others.
