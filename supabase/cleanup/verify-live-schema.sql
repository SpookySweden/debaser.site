-- -----------------------------------------------------------------------------
-- Verify the live project, in one paste, read-only.
-- -----------------------------------------------------------------------------
-- Run this whole file in the Supabase SQL Editor and read the result: every row that says `MISSING`
-- is a piece of the schema this build expects and the project does not have. Nothing is created,
-- changed or removed here - the files that do that are in supabase/migrations/.
--
-- It covers, in order: the tables every screen reads, the columns the later sections added to an
-- earlier table, the constraints that were widened rather than re-made, the functions the comms
-- rules are the only door to, the policies the bell and the arcade lean on, and the two guard
-- triggers. The publication and the account count follow as listings.

select object, state, section from (
  -- Tables (sections 1-6, 14, 15, 17, 18, 22, 23).
  select 'table: profiles' as object, case when to_regclass('public.profiles') is null then 'MISSING' else 'ok' end as state, '1' as section
  union all select 'table: profile_avatar_versions', case when to_regclass('public.profile_avatar_versions') is null then 'MISSING' else 'ok' end, '2'
  union all select 'table: profile_tags', case when to_regclass('public.profile_tags') is null then 'MISSING' else 'ok' end, '3'
  union all select 'table: profile_comments', case when to_regclass('public.profile_comments') is null then 'MISSING' else 'ok' end, '4'
  union all select 'table: forum_threads', case when to_regclass('public.forum_threads') is null then 'MISSING' else 'ok' end, '5'
  union all select 'table: forum_comments', case when to_regclass('public.forum_comments') is null then 'MISSING' else 'ok' end, '5'
  union all select 'table: comms_threads', case when to_regclass('public.comms_threads') is null then 'MISSING' else 'ok' end, '6'
  union all select 'table: comms_members', case when to_regclass('public.comms_members') is null then 'MISSING' else 'ok' end, '6'
  union all select 'table: comms_messages', case when to_regclass('public.comms_messages') is null then 'MISSING' else 'ok' end, '6'
  union all select 'table: comms_reads', case when to_regclass('public.comms_reads') is null then 'MISSING' else 'ok' end, '6'
  union all select 'table: music_tracks', case when to_regclass('public.music_tracks') is null then 'MISSING' else 'ok' end, '14'
  union all select 'table: profile_song_versions', case when to_regclass('public.profile_song_versions') is null then 'MISSING' else 'ok' end, '15'
  union all select 'table: forum_notifications', case when to_regclass('public.forum_notifications') is null then 'MISSING' else 'ok' end, '17'
  union all select 'table: forum_pins', case when to_regclass('public.forum_pins') is null then 'MISSING' else 'ok' end, '18'
  union all select 'table: lore_pages', case when to_regclass('public.lore_pages') is null then 'MISSING' else 'ok' end, '22'
  union all select 'table: game_invites', case when to_regclass('public.game_invites') is null then 'MISSING' else 'ok' end, '23'

  -- Columns the later sections added to an earlier table.
  union all select 'column: profiles.last_seen_at', case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='last_seen_at') then 'ok' else 'MISSING' end, '1'
  union all select 'column: profiles.is_online', case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='is_online') then 'ok' else 'MISSING' end, '1'
  union all select 'column: profiles.current_song_version_id', case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='current_song_version_id') then 'ok' else 'MISSING' end, '15'
  union all select 'column: profiles.show_song_comments', case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='show_song_comments') then 'ok' else 'MISSING' end, '15'
  union all select 'column: profile_comments.song_version_id', case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='profile_comments' and column_name='song_version_id') then 'ok' else 'MISSING' end, '15'
  union all select 'column: profile_comments.pinned', case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='profile_comments' and column_name='pinned') then 'ok' else 'MISSING' end, '19'
  union all select 'column: forum_threads.track', case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='forum_threads' and column_name='track') then 'ok' else 'MISSING' end, '5'
  union all select 'column: forum_notifications.game_id', case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='forum_notifications' and column_name='game_id') then 'ok' else 'MISSING' end, '23'
  union all select 'column: forum_notifications.invite_id', case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='forum_notifications' and column_name='invite_id') then 'ok' else 'MISSING' end, '23'

  -- Constraints that were widened rather than re-made.
  union all select 'constraint: profile comment kinds include song', case when exists (select 1 from pg_constraint where conrelid='public.profile_comments'::regclass and pg_get_constraintdef(oid) like '%song%') then 'ok' else 'MISSING' end, '15'
  union all select 'constraint: notification kinds include invite', case when exists (select 1 from pg_constraint where conname='forum_notifications_kind_check' and pg_get_constraintdef(oid) like '%invite%') then 'ok' else 'MISSING' end, '23'

  -- The functions section 16 made the only door to a group, plus the two the policies ask.
  union all select 'function: is_admin', case when to_regprocedure('public.is_admin()') is null then 'MISSING' else 'ok' end, '10'
  union all select 'function: is_banned', case when to_regprocedure('public.is_banned(uuid)') is null then 'MISSING' else 'ok' end, '12'
  union all select 'function: is_comms_member', case when to_regprocedure('public.is_comms_member(text)') is null then 'MISSING' else 'ok' end, '13'
  union all select 'function: is_comms_owner', case when to_regprocedure('public.is_comms_owner(text)') is null then 'MISSING' else 'ok' end, '16'
  union all select 'function: rename_group', case when to_regprocedure('public.rename_group(text,text)') is null then 'MISSING' else 'ok' end, '16'
  union all select 'function: transfer_group_ownership', case when to_regprocedure('public.transfer_group_ownership(text,uuid)') is null then 'MISSING' else 'ok' end, '16'
  union all select 'function: remove_group_member', case when to_regprocedure('public.remove_group_member(text,uuid)') is null then 'MISSING' else 'ok' end, '16'
  union all select 'function: leave_group', case when to_regprocedure('public.leave_group(text)') is null then 'MISSING' else 'ok' end, '16'
) as checklist
order by section, object;

-- The policies the bell, the board's pins and the arcade lean on, one row each.

select expected.policyname,
       case when p.policyname is null then 'MISSING' else 'ok' end as state
from unnest(array[
  'forum_notifications readable by recipient',
  'forum_notifications inserted by actor',
  'forum_notifications marked read by recipient',
  'forum_notifications deleted by recipient',
  'forum_pins readable',
  'forum_pins pinned by admin',
  'forum_pins changed by admin',
  'forum_pins removed by admin',
  'game invites readable by the pair',
  'game invites sent by the challenger',
  'game invites answered by the pair',
  'game invites removed by the pair'
]) as expected(policyname)
left join pg_policies p
  on p.schemaname = 'public' and p.policyname = expected.policyname
order by expected.policyname;

-- The two guards: the pin one stops a pin rewriting somebody's words, the comms one stops a member
-- renaming a group and claiming it.

select expected.tgname,
       case when t.tgname is null then 'MISSING' else 'ok' end as state
from unnest(array['comms_threads_guard_metadata', 'profile_comments_guard_pin']) as expected(tgname)
left join pg_trigger t on t.tgname = expected.tgname
order by expected.tgname;

-- The publication as it stands, for the record: what the board, the feed and the arcade get their
-- live updates from. A table missing from it is a slower screen rather than a broken one - each of
-- those reads also polls.

select tablename
from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
order by tablename;

-- And the count the user directory on /users will draw.

select count(*) as accounts_listed from public.profiles;
