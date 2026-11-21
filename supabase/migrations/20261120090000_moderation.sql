-- Moderation: report, block, hide (Luke, 2026-11-20; SPEC-moderation.md, answers 1A 2A 3A 4B 5A 6B 7A 8A 9A 10A).
--
-- What this adds, and what it changes:
--   1. moderators: the list of moderator accounts. `is_admin()` now means "is on that list", so every power the house account had
--      (remove, pin, ban, canvas hide, group take-over) goes to the moderators. The list starts EMPTY: the first moderator (Luke)
--      is one separate write, by account id, never by address (this repository is public).
--   2. moderation_log: every hide, unhide, remove, ban, unban, dismiss and moderator change. Moderators read it; nobody, moderators
--      included, can change or delete a line.
--   3. HIDE: hidden_at / hidden_by / hidden_reason on board posts, replies, profile comments and room chat lines. A hidden row is read
--      only by its author and the moderators. Only the moderators' functions can set or clear those columns.
--   4. BLOCK (one way): blocks(blocker, blocked). The blocker stops reading the blocked person's posts, replies, profile comments,
--      room chat lines, messages, their one-to-one conversation and the rooms they host. The blocked person can't start or send a
--      one-to-one conversation to the blocker, add them to a group, comment on their profile, or join a room they host; blocking
--      takes them out of the blocker's live rooms, and unblocking lets them back. Who blocked whom is readable only by the blocker.
--   5. REPORTS: about an account, with a reason and a short text. When filed from a line (post, reply, profile comment, chat line,
--      message), the database copies that line itself, and only if the reporter can read it. Moderators alone read reports.
--      A banned account may file one appeal at a time.
--   6. watch_join / watch_join_link answer 'removed' / nothing to somebody the room's host has blocked.
--
-- Stream guests stay out of every new table ("guests stay out"), and can't block, report or appeal.
-- Nothing is deleted. Re-runnable: `if not exists`, functions replaced, triggers and policies dropped and recreated by name.

-- 1. Moderators ----------------------------------------------------------------------------------------------------------------

create table if not exists public.moderators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  is_owner boolean not null default false,
  added_by uuid references auth.users (id) on delete set null,
  added_at timestamptz not null default now()
);
alter table public.moderators enable row level security;
revoke all on public.moderators from anon, authenticated;
grant select on public.moderators to authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.moderators m where m.user_id = auth.uid());
$$;

drop policy if exists "moderators read by moderators" on public.moderators;
create policy "moderators read by moderators" on public.moderators
  for select to authenticated using (public.is_admin());
drop policy if exists "guests stay out" on public.moderators;
create policy "guests stay out" on public.moderators
  as restrictive for select to authenticated using (not (select public.is_guest()));

-- 2. The log ---------------------------------------------------------------------------------------------------------------------
-- Plain uuids, not references: deleting an account must not have to rewrite (or be stopped by) a log line.

create table if not exists public.moderation_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  action text not null check (action in ('hide', 'unhide', 'remove', 'ban', 'unban', 'dismiss', 'moderator_added', 'moderator_removed')),
  target_kind text check (target_kind in ('thread', 'reply', 'profile_comment', 'room_line', 'account', 'report')),
  target_id text,
  target_account uuid,
  reason text not null default '' check (char_length(reason) <= 500),
  excerpt text not null default '' check (char_length(excerpt) <= 300)
);
create index if not exists moderation_log_by_time on public.moderation_log (at desc);
alter table public.moderation_log enable row level security;
revoke all on public.moderation_log from anon, authenticated;
grant select on public.moderation_log to authenticated;

drop policy if exists "moderation log read by moderators" on public.moderation_log;
create policy "moderation log read by moderators" on public.moderation_log
  for select to authenticated using (public.is_admin());
drop policy if exists "guests stay out" on public.moderation_log;
create policy "guests stay out" on public.moderation_log
  as restrictive for select to authenticated using (not (select public.is_guest()));

create or replace function public.moderation_log_frozen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'the moderation log can''t be changed' using errcode = '42501';
end;
$$;
drop trigger if exists moderation_log_frozen on public.moderation_log;
create trigger moderation_log_frozen before update or delete on public.moderation_log
  for each row execute function public.moderation_log_frozen();

create or replace function public.moderation_note(act text, kind text, target text, person uuid, why text, words text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.moderation_log (actor, action, target_kind, target_id, target_account, reason, excerpt)
  values (auth.uid(), act, kind, target, person, left(coalesce(why, ''), 500), left(coalesce(words, ''), 300));
$$;
revoke all on function public.moderation_note(text, text, text, uuid, text, text) from public, anon, authenticated;

-- 3. HIDE: the columns, who may write them, who may read a hidden row ------------------------------------------------------------

alter table public.forum_threads add column if not exists hidden_at timestamptz;
alter table public.forum_threads add column if not exists hidden_by uuid;
alter table public.forum_threads add column if not exists hidden_reason text not null default '';
alter table public.forum_comments add column if not exists hidden_at timestamptz;
alter table public.forum_comments add column if not exists hidden_by uuid;
alter table public.forum_comments add column if not exists hidden_reason text not null default '';
alter table public.profile_comments add column if not exists hidden_at timestamptz;
alter table public.profile_comments add column if not exists hidden_by uuid;
alter table public.profile_comments add column if not exists hidden_reason text not null default '';
alter table public.watch_messages add column if not exists hidden_at timestamptz;
alter table public.watch_messages add column if not exists hidden_by uuid;
alter table public.watch_messages add column if not exists hidden_reason text not null default '';

-- Only the moderators' own functions (which mark the transaction) may touch the three columns: an author's ordinary edit can't
-- unhide their post, and a moderator's direct update can't skip the log.
create or replace function public.moderation_hidden_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed boolean := coalesce(current_setting('debaser.moderating', true), '') = 'on' and public.is_admin();
begin
  if tg_op = 'INSERT' then
    if (new.hidden_at is not null or new.hidden_by is not null or new.hidden_reason <> '') and not allowed then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  elsif (new.hidden_at, new.hidden_by, new.hidden_reason) is distinct from (old.hidden_at, old.hidden_by, old.hidden_reason) and not allowed then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists moderation_hidden_guard on public.forum_threads;
create trigger moderation_hidden_guard before insert or update on public.forum_threads
  for each row execute function public.moderation_hidden_guard();
drop trigger if exists moderation_hidden_guard on public.forum_comments;
create trigger moderation_hidden_guard before insert or update on public.forum_comments
  for each row execute function public.moderation_hidden_guard();
drop trigger if exists moderation_hidden_guard on public.profile_comments;
create trigger moderation_hidden_guard before insert or update on public.profile_comments
  for each row execute function public.moderation_hidden_guard();
drop trigger if exists moderation_hidden_guard on public.watch_messages;
create trigger moderation_hidden_guard before insert or update on public.watch_messages
  for each row execute function public.moderation_hidden_guard();

-- A hidden row is its author's and the moderators' alone. (A hidden post's replies go with it: their read rule needs the post.)
drop policy if exists "hidden by a moderator" on public.forum_threads;
create policy "hidden by a moderator" on public.forum_threads
  as restrictive for select using (hidden_at is null or author_id = (select auth.uid()) or public.is_admin());
drop policy if exists "hidden by a moderator" on public.forum_comments;
create policy "hidden by a moderator" on public.forum_comments
  as restrictive for select using (hidden_at is null or author_id = (select auth.uid()) or public.is_admin());
drop policy if exists "hidden by a moderator" on public.profile_comments;
create policy "hidden by a moderator" on public.profile_comments
  as restrictive for select using (hidden_at is null or author_id = (select auth.uid()) or public.is_admin());
drop policy if exists "hidden by a moderator" on public.watch_messages;
create policy "hidden by a moderator" on public.watch_messages
  as restrictive for select using (hidden_at is null or author_id = (select auth.uid()) or public.is_admin());

-- The pulse: one row, its time moved on by every hide and unhide. Open pages hear it live and read again, because a row that
-- has just become unreadable to them sends them no live change of its own. It says nothing about what was hidden.
create table if not exists public.moderation_pulse (
  id smallint primary key default 1 check (id = 1),
  at timestamptz not null default now()
);
insert into public.moderation_pulse (id) values (1) on conflict (id) do nothing;
alter table public.moderation_pulse enable row level security;
revoke all on public.moderation_pulse from anon, authenticated;
grant select on public.moderation_pulse to anon, authenticated;
drop policy if exists "moderation pulse readable" on public.moderation_pulse;
create policy "moderation pulse readable" on public.moderation_pulse for select using (true);
drop policy if exists "guests stay out" on public.moderation_pulse;
create policy "guests stay out" on public.moderation_pulse
  as restrictive for select to authenticated using (not (select public.is_guest()));
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'moderation_pulse'
  ) then
    alter publication supabase_realtime add table public.moderation_pulse;
  end if;
end $$;

create or replace function public.moderation_beat()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.moderation_pulse set at = now() where id = 1;
$$;
revoke all on function public.moderation_beat() from public, anon, authenticated;

-- A moderator's REMOVE (deleting somebody else's row for good) is written to the log, words and all, since the row is gone.
create or replace function public.moderation_log_remove()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  kind text;
  words text;
begin
  if auth.uid() is null or old.author_id is not distinct from auth.uid() or not public.is_admin() then return old; end if;
  if tg_table_name = 'forum_threads' then
    kind := 'thread'; words := coalesce(old.title, '') || ' :: ' || coalesce(old.body, '');
  elsif tg_table_name = 'forum_comments' then
    -- A reply going because its post was removed is part of that one removal.
    if not exists (select 1 from public.forum_threads t where t.id = old.thread_id) then return old; end if;
    kind := 'reply'; words := old.body;
  elsif tg_table_name = 'profile_comments' then
    kind := 'profile_comment'; words := old.body;
  else
    kind := 'room_line'; words := old.body;
  end if;
  perform public.moderation_note('remove', kind, old.id::text, old.author_id, '', words);
  return old;
end;
$$;
revoke all on function public.moderation_log_remove() from public, anon, authenticated;

drop trigger if exists moderation_log_remove on public.forum_threads;
create trigger moderation_log_remove after delete on public.forum_threads
  for each row execute function public.moderation_log_remove();
drop trigger if exists moderation_log_remove on public.forum_comments;
create trigger moderation_log_remove after delete on public.forum_comments
  for each row execute function public.moderation_log_remove();
drop trigger if exists moderation_log_remove on public.profile_comments;
create trigger moderation_log_remove after delete on public.profile_comments
  for each row execute function public.moderation_log_remove();
drop trigger if exists moderation_log_remove on public.watch_messages;
create trigger moderation_log_remove after delete on public.watch_messages
  for each row execute function public.moderation_log_remove();

-- 4. BLOCK -----------------------------------------------------------------------------------------------------------------------

create table if not exists public.blocks (
  blocker uuid not null references auth.users (id) on delete cascade,
  blocked uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- The rooms the block took them out of, so unblocking lets them back into those and no others (a REMOVE by hand stays).
  removed_from uuid[] not null default '{}',
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
alter table public.blocks add column if not exists removed_from uuid[] not null default '{}';
create index if not exists blocks_by_blocked on public.blocks (blocked);
alter table public.blocks enable row level security;
revoke all on public.blocks from anon, authenticated;
grant select on public.blocks to authenticated;

drop policy if exists "blocks read by the blocker" on public.blocks;
create policy "blocks read by the blocker" on public.blocks
  for select to authenticated using (blocker = (select auth.uid()));
drop policy if exists "guests stay out" on public.blocks;
create policy "guests stay out" on public.blocks
  as restrictive for select to authenticated using (not (select public.is_guest()));

-- Two questions, each only about the caller: "have I blocked them?" and "have they blocked me?". Nobody can ask about two
-- other people.
create or replace function public.blocked_by_me(person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select person is not null and exists (select 1 from public.blocks b where b.blocker = auth.uid() and b.blocked = person);
$$;
create or replace function public.blocks_me(person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select person is not null and exists (select 1 from public.blocks b where b.blocker = person and b.blocked = auth.uid());
$$;
-- The general question, for the database's own definer functions only (the notifications' gate drops a notification to somebody
-- from a person they blocked, SPEC-notifications): nobody signed in can call it, so nobody can ask about two other people.
create or replace function public.has_blocked(blocker uuid, blocked uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.blocks b where b.blocker = $1 and b.blocked = $2);
$$;
revoke all on function public.has_blocked(uuid, uuid) from public, anon, authenticated;
grant execute on function public.has_blocked(uuid, uuid) to service_role;

revoke all on function public.blocked_by_me(uuid) from public, anon;
revoke all on function public.blocks_me(uuid) from public, anon;
grant execute on function public.blocked_by_me(uuid) to authenticated, service_role;
grant execute on function public.blocks_me(uuid) to authenticated, service_role;

create or replace function public.block_account(person uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  taken uuid[];
begin
  if caller is null or public.is_guest() or person is null or person = caller then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = person and not coalesce(u.is_anonymous, false)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if (select count(*) from public.blocks b where b.blocker = caller) >= 500 then
    raise exception 'too many blocks';
  end if;
  insert into public.blocks (blocker, blocked) values (caller, person) on conflict do nothing;

  -- Out of the rooms the blocker is hosting now, as REMOVE does.
  with gone as (
    update public.watch_members m set removed_at = now(), removed_by = caller
     where m.user_id = person and m.removed_at is null
       and m.room_id in (select r.id from public.watch_rooms r where r.host_id = caller and r.ended_at is null)
    returning m.room_id
  )
  select coalesce(array_agg(room_id), '{}') into taken from gone;
  update public.blocks b set removed_from = (select array(select distinct unnest(b.removed_from || taken)))
   where b.blocker = caller and b.blocked = person;
  delete from public.watch_crowns c
   where c.user_id = person and c.room_id in (select r.id from public.watch_rooms r where r.host_id = caller and r.ended_at is null);
end;
$$;

create or replace function public.unblock_account(person uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  taken uuid[];
begin
  if caller is null or public.is_guest() then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.blocks b where b.blocker = caller and b.blocked = person returning b.removed_from into taken;
  -- Back as it was: only the rooms the block took them out of, and only while the blocker still hosts them.
  update public.watch_members m set removed_at = null, removed_by = null
   where m.user_id = person and m.removed_by = caller and m.room_id = any (coalesce(taken, '{}'))
     and m.room_id in (select r.id from public.watch_rooms r where r.host_id = caller);
end;
$$;
revoke all on function public.block_account(uuid) from public, anon;
revoke all on function public.unblock_account(uuid) from public, anon;
grant execute on function public.block_account(uuid) to authenticated, service_role;
grant execute on function public.unblock_account(uuid) to authenticated, service_role;

-- What the blocker no longer reads. Restrictive, so these sit on top of every existing read rule. A moderator's own block never
-- hides what they moderate (SPEC: a block never hides anything from the moderator view), or REMOVE could not find the row.
drop policy if exists "blocked authors hidden" on public.forum_threads;
create policy "blocked authors hidden" on public.forum_threads
  as restrictive for select to authenticated using (author_id is null or not public.blocked_by_me(author_id) or public.is_admin());
drop policy if exists "blocked authors hidden" on public.forum_comments;
create policy "blocked authors hidden" on public.forum_comments
  as restrictive for select to authenticated using (author_id is null or not public.blocked_by_me(author_id) or public.is_admin());
drop policy if exists "blocked authors hidden" on public.profile_comments;
create policy "blocked authors hidden" on public.profile_comments
  as restrictive for select to authenticated using (author_id is null or not public.blocked_by_me(author_id) or public.is_admin());
drop policy if exists "blocked authors hidden" on public.watch_messages;
create policy "blocked authors hidden" on public.watch_messages
  as restrictive for select to authenticated using (author_id is null or not public.blocked_by_me(author_id) or public.is_admin());
drop policy if exists "blocked authors hidden" on public.comms_messages;
create policy "blocked authors hidden" on public.comms_messages
  as restrictive for select to authenticated using (author_id is null or not public.blocked_by_me(author_id));
drop policy if exists "blocked conversations hidden" on public.comms_threads;
create policy "blocked conversations hidden" on public.comms_threads
  as restrictive for select to authenticated
  using (kind <> 'dm' or not public.blocked_by_me(case when participant_a = (select auth.uid()) then participant_b else participant_a end));
-- A room is kept while the blocker is in it, so a room they are already in never breaks under them.
drop policy if exists "blocked hosts hidden" on public.watch_rooms;
create policy "blocked hosts hidden" on public.watch_rooms
  as restrictive for select to authenticated using (not public.blocked_by_me(host_id) or public.is_room_member(id));

-- What the blocked person can no longer do to the blocker.
drop policy if exists "no conversation with a blocker" on public.comms_threads;
create policy "no conversation with a blocker" on public.comms_threads
  as restrictive for insert to authenticated
  with check (kind <> 'dm' or not public.blocks_me(case when participant_a = (select auth.uid()) then participant_b else participant_a end));
drop policy if exists "no messages to a blocker" on public.comms_messages;
create policy "no messages to a blocker" on public.comms_messages
  as restrictive for insert to authenticated
  with check (not exists (
    select 1 from public.comms_threads t
     where t.id = comms_messages.thread_id and t.kind = 'dm'
       and public.blocks_me(case when t.participant_a = (select auth.uid()) then t.participant_b else t.participant_a end)
  ));
drop policy if exists "no adding a blocker to a group" on public.comms_members;
create policy "no adding a blocker to a group" on public.comms_members
  as restrictive for insert to authenticated with check (user_id = (select auth.uid()) or not public.blocks_me(user_id));
drop policy if exists "no comments on a blocker's profile" on public.profile_comments;
create policy "no comments on a blocker's profile" on public.profile_comments
  as restrictive for insert to authenticated with check (not public.blocks_me(user_id));

-- 5. REPORTS ---------------------------------------------------------------------------------------------------------------------

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'report' check (kind in ('report', 'appeal')),
  reporter uuid references auth.users (id) on delete set null,
  account uuid not null references auth.users (id) on delete cascade,
  reason text check (reason in ('spam', 'harassment', 'nasty', 'other')),
  note text not null default '' check (char_length(note) <= 500),
  context_kind text check (context_kind in ('thread', 'reply', 'profile_comment', 'room_line', 'message')),
  context_id text check (char_length(context_id) <= 100),
  context_text text not null default '' check (char_length(context_text) <= 1000),
  context_private boolean not null default false,
  state text not null default 'open' check (state in ('open', 'dismissed', 'acted')),
  handled_by uuid references auth.users (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists reports_one_open on public.reports (reporter, account) where state = 'open' and kind = 'report';
create unique index if not exists reports_one_open_appeal on public.reports (account) where state = 'open' and kind = 'appeal';
create index if not exists reports_by_state on public.reports (state, created_at desc);
create index if not exists reports_by_reporter on public.reports (reporter, created_at desc);
alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;
grant select on public.reports to authenticated;

drop policy if exists "reports read by moderators" on public.reports;
create policy "reports read by moderators" on public.reports
  for select to authenticated using (public.is_admin());
drop policy if exists "guests stay out" on public.reports;
create policy "guests stay out" on public.reports
  as restrictive for select to authenticated using (not (select public.is_guest()));

-- Filing a report. The line it was made from is read here, by the database, and only when the reporter could read it themselves
-- (the same tests as each table's read rule), so nobody can pull words out of a room or conversation they aren't in.
create or replace function public.file_report(person uuid, why text, words text default '', ctx_kind text default null, ctx_id text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  author uuid;
  copied text := '';
  private boolean := false;
  made uuid;
begin
  if caller is null or public.is_guest() or person is null or person = caller then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if why is null or why not in ('spam', 'harassment', 'nasty', 'other') then raise exception 'pick a reason'; end if;
  if char_length(coalesce(words, '')) > 500 then raise exception 'too long'; end if;
  if (select count(*) from public.reports r where r.reporter = caller and r.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too many reports';
  end if;

  if ctx_kind is not null then
    begin
      if ctx_kind = 'thread' then
        select t.author_id, coalesce(t.title, '') || ' :: ' || coalesce(t.body, ''), t.privacy_at_write <> 'open'
          into author, copied, private
          from public.forum_threads t
         where t.id = ctx_id::uuid
           and (t.privacy_at_write = 'open' or public.is_room_member(t.watch_room_id) or t.author_id = caller)
           and (t.hidden_at is null or t.author_id = caller) and (t.author_id is null or not public.is_banned(t.author_id));
      elsif ctx_kind = 'reply' then
        select c.author_id, c.body, c.privacy_at_write <> 'open' into author, copied, private
          from public.forum_comments c
         where c.id = ctx_id::uuid and (c.privacy_at_write = 'open' or public.forum_thread_is_member(c.thread_id))
           and (c.hidden_at is null or c.author_id = caller) and (c.author_id is null or not public.is_banned(c.author_id));
      elsif ctx_kind = 'profile_comment' then
        select c.author_id, c.body, false into author, copied, private
          from public.profile_comments c join public.profiles p on p.id = c.user_id
         where c.id = ctx_id::uuid
           and (c.user_id = caller or c.author_id = caller
             or (c.kind = 'profile' and p.show_profile_comments)
             or (c.kind = 'avatar' and p.show_avatar_comments)
             or (c.kind = 'song' and p.show_song_comments))
           and (c.hidden_at is null or c.author_id = caller);
      elsif ctx_kind = 'room_line' then
        select m.author_id, m.body, m.privacy_at_write <> 'open' into author, copied, private
          from public.watch_messages m
         where m.id = ctx_id::uuid and (m.privacy_at_write = 'open' or public.is_room_member(m.room_id))
           and (m.hidden_at is null or m.author_id = caller);
      elsif ctx_kind = 'message' then
        select m.author_id, m.body, true into author, copied, private
          from public.comms_messages m join public.comms_threads t on t.id = m.thread_id
         where m.id = ctx_id::uuid and (caller in (t.participant_a, t.participant_b) or public.is_comms_member(t.id));
      else
        raise exception 'not found';
      end if;
    exception when invalid_text_representation then
      raise exception 'not found';
    end;
    if author is null or author <> person then raise exception 'not found'; end if;
  end if;

  begin
    insert into public.reports (kind, reporter, account, reason, note, context_kind, context_id, context_text, context_private)
    values ('report', caller, person, why, coalesce(words, ''), ctx_kind, ctx_id, left(coalesce(copied, ''), 1000), coalesce(private, false))
    returning id into made;
  exception when unique_violation then
    raise exception 'already reported';
  end;
  return made;
end;
$$;

create or replace function public.file_appeal(words text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  made uuid;
begin
  if caller is null or public.is_guest() or not public.is_banned() then raise exception 'not allowed' using errcode = '42501'; end if;
  if char_length(coalesce(words, '')) not between 1 and 500 then raise exception 'write a few words'; end if;
  begin
    insert into public.reports (kind, reporter, account, note) values ('appeal', caller, caller, words) returning id into made;
  exception when unique_violation then
    raise exception 'already appealed';
  end;
  return made;
end;
$$;
revoke all on function public.file_report(uuid, text, text, text, text) from public, anon;
revoke all on function public.file_appeal(text) from public, anon;
grant execute on function public.file_report(uuid, text, text, text, text) to authenticated, service_role;
grant execute on function public.file_appeal(text) to authenticated, service_role;

-- A person reads their own standing: banned or not, the moderator's reason (banned_reason is not readable to accounts), and
-- whether their appeal is still open. Nothing about anybody else.
drop function if exists public.my_open_appeal();
create or replace function public.my_standing()
returns table (banned boolean, reason text, appeal_open boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.banned_at is not null, case when p.banned_at is null then '' else p.banned_reason end,
         exists (select 1 from public.reports r where r.kind = 'appeal' and r.account = p.id and r.state = 'open')
    from public.profiles p where p.id = auth.uid();
$$;
revoke all on function public.my_standing() from public, anon;
grant execute on function public.my_standing() to authenticated, service_role;

-- 6. The moderators' functions -----------------------------------------------------------------------------------------------

create or replace function public.moderation_close_report(report uuid, outcome text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.reports r set state = outcome, handled_by = auth.uid(), handled_at = now()
   where report is not null and r.id = report and r.state = 'open';
$$;
revoke all on function public.moderation_close_report(uuid, text) from public, anon, authenticated;

create or replace function public.moderate_hide(kind text, target text, why text default '', report uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  author uuid;
  words text;
  found_id uuid;
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  perform set_config('debaser.moderating', 'on', true);
  begin
    if kind = 'thread' then
      update public.forum_threads t set hidden_at = now(), hidden_by = auth.uid(), hidden_reason = left(coalesce(why, ''), 500)
       where t.id = target::uuid and t.privacy_at_write = 'open'
       returning t.id, t.author_id, coalesce(t.title, '') || ' :: ' || coalesce(t.body, '') into found_id, author, words;
    elsif kind = 'reply' then
      update public.forum_comments c set hidden_at = now(), hidden_by = auth.uid(), hidden_reason = left(coalesce(why, ''), 500)
       where c.id = target::uuid and c.privacy_at_write = 'open'
       returning c.id, c.author_id, c.body into found_id, author, words;
    elsif kind = 'profile_comment' then
      update public.profile_comments c set hidden_at = now(), hidden_by = auth.uid(), hidden_reason = left(coalesce(why, ''), 500)
       where c.id = target::uuid
       returning c.id, c.author_id, c.body into found_id, author, words;
    elsif kind = 'room_line' then
      update public.watch_messages m set hidden_at = now(), hidden_by = auth.uid(), hidden_reason = left(coalesce(why, ''), 500)
       where m.id = target::uuid and m.privacy_at_write = 'open'
       returning m.id, m.author_id, m.body into found_id, author, words;
    end if;
  exception when invalid_text_representation then
    found_id := null;
  end;
  perform set_config('debaser.moderating', 'off', true);
  if found_id is null then raise exception 'not found'; end if;
  perform public.moderation_note('hide', kind, target, author, why, words);
  perform public.moderation_beat();
  perform public.moderation_close_report(report, 'acted');
end;
$$;

create or replace function public.moderate_unhide(kind text, target text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  author uuid;
  found_id uuid;
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  perform set_config('debaser.moderating', 'on', true);
  begin
    if kind = 'thread' then
      update public.forum_threads t set hidden_at = null, hidden_by = null, hidden_reason = ''
       where t.id = target::uuid returning t.id, t.author_id into found_id, author;
    elsif kind = 'reply' then
      update public.forum_comments c set hidden_at = null, hidden_by = null, hidden_reason = ''
       where c.id = target::uuid returning c.id, c.author_id into found_id, author;
    elsif kind = 'profile_comment' then
      update public.profile_comments c set hidden_at = null, hidden_by = null, hidden_reason = ''
       where c.id = target::uuid returning c.id, c.author_id into found_id, author;
    elsif kind = 'room_line' then
      update public.watch_messages m set hidden_at = null, hidden_by = null, hidden_reason = ''
       where m.id = target::uuid returning m.id, m.author_id into found_id, author;
    end if;
  exception when invalid_text_representation then
    found_id := null;
  end;
  perform set_config('debaser.moderating', 'off', true);
  if found_id is null then raise exception 'not found'; end if;
  perform public.moderation_note('unhide', kind, target, author, '', '');
  perform public.moderation_beat();
end;
$$;

create or replace function public.ban_account(person uuid, why text, report uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if person is null or person = auth.uid() or exists (select 1 from public.moderators m where m.user_id = person) then
    raise exception 'a moderator can''t be banned';
  end if;
  if char_length(coalesce(why, '')) not between 1 and 500 then raise exception 'give a reason'; end if;
  update public.profiles p set banned_at = now(), banned_reason = why, banned_by = auth.uid() where p.id = person;
  if not found then raise exception 'not found'; end if;
  perform public.moderation_note('ban', 'account', person::text, person, why, '');
  perform public.moderation_close_report(report, 'acted');
end;
$$;

create or replace function public.unban_account(person uuid, report uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.profiles p set banned_at = null, banned_reason = '', banned_by = null where p.id = person;
  if not found then raise exception 'not found'; end if;
  perform public.moderation_note('unban', 'account', person::text, person, '', '');
  perform public.moderation_close_report(report, 'acted');
  -- An appeal still open is answered by the unban.
  update public.reports r set state = 'acted', handled_by = auth.uid(), handled_at = now()
   where r.kind = 'appeal' and r.account = person and r.state = 'open';
end;
$$;

create or replace function public.dismiss_report(report uuid, why text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  person uuid;
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.reports r set state = 'dismissed', handled_by = auth.uid(), handled_at = now()
   where r.id = report and r.state = 'open' returning r.account into person;
  if person is null then raise exception 'not found'; end if;
  perform public.moderation_note('dismiss', 'report', report::text, person, why, '');
end;
$$;

-- Only the owner (Luke) adds or takes off moderators; the owner can't be taken off.
create or replace function public.add_moderator(person uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.moderators m where m.user_id = auth.uid() and m.is_owner) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = person and not coalesce(u.is_anonymous, false)) then
    raise exception 'not found';
  end if;
  insert into public.moderators (user_id, added_by) values (person, auth.uid()) on conflict do nothing;
  perform public.moderation_note('moderator_added', 'account', person::text, person, '', '');
end;
$$;

create or replace function public.remove_moderator(person uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.moderators m where m.user_id = auth.uid() and m.is_owner) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.moderators m where m.user_id = person and not m.is_owner;
  if not found then raise exception 'not found'; end if;
  perform public.moderation_note('moderator_removed', 'account', person::text, person, '', '');
end;
$$;

revoke all on function public.moderate_hide(text, text, text, uuid) from public, anon;
revoke all on function public.moderate_unhide(text, text) from public, anon;
revoke all on function public.ban_account(uuid, text, uuid) from public, anon;
revoke all on function public.unban_account(uuid, uuid) from public, anon;
revoke all on function public.dismiss_report(uuid, text) from public, anon;
revoke all on function public.add_moderator(uuid) from public, anon;
revoke all on function public.remove_moderator(uuid) from public, anon;
grant execute on function public.moderate_hide(text, text, text, uuid) to authenticated, service_role;
grant execute on function public.moderate_unhide(text, text) to authenticated, service_role;
grant execute on function public.ban_account(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.unban_account(uuid, uuid) to authenticated, service_role;
grant execute on function public.dismiss_report(uuid, text) to authenticated, service_role;
grant execute on function public.add_moderator(uuid) to authenticated, service_role;
grant execute on function public.remove_moderator(uuid) to authenticated, service_role;

-- 7. Rooms: nobody joins a room whose host has blocked them -----------------------------------------------------------------
-- Both functions as they stand on the live database (read 2026-11-20), with one test added to each (marked BLOCK).

create or replace function public.watch_join(room uuid, password text default null::text)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  caller uuid := auth.uid();
  guest boolean := public.is_guest();
  setting text;
  ended timestamptz;
  switched_on boolean;
  stored text;
  attempt public.watch_join_attempts%rowtype;
  room_tries public.watch_guest_tries%rowtype;
  caller_label text;
begin
  if caller is null or public.is_banned() then return 'refused'; end if;

  select r.privacy, r.ended_at, r.is_public into setting, ended, switched_on from public.watch_rooms r
    where r.id = room
      and (r.origin <> 'music' or (r.is_public and r.privacy <> 'private') or r.host_id = caller
        or exists (select 1 from public.watch_members m where m.room_id = r.id and m.user_id = caller));
  if setting is null then return 'refused'; end if;

  if exists (select 1 from public.watch_members m where m.room_id = room and m.user_id = caller and m.removed_at is not null) then
    return 'removed';
  end if;
  -- BLOCK: the host has blocked the caller.
  if exists (select 1 from public.watch_rooms r join public.blocks b on b.blocker = r.host_id and b.blocked = caller where r.id = room) then
    return 'removed';
  end if;
  if public.is_room_member(room) then return 'joined'; end if;
  if ended is not null or not switched_on then return 'ended'; end if;

  if setting = 'password' then
    if guest then
      insert into public.watch_guest_tries (room_id) values (room) on conflict (room_id) do nothing;
      select * into room_tries from public.watch_guest_tries g where g.room_id = room for update;
      if room_tries.locked_until is not null and room_tries.locked_until > now() then return 'locked'; end if;
    end if;

    insert into public.watch_join_attempts (room_id, user_id) values (room, caller) on conflict (room_id, user_id) do nothing;
    -- Held until this answer is written, so tries sent at once are counted one by one.
    select * into attempt from public.watch_join_attempts a where a.room_id = room and a.user_id = caller for update;
    if attempt.locked_until is not null and attempt.locked_until > now() then return 'locked'; end if;

    select s.password_hash into stored from public.watch_room_passwords s where s.room_id = room;
    if stored is null or password is null or extensions.crypt(password, stored) <> stored then
      if guest then
        if room_tries.window_started_at < now() - interval '10 minutes' then
          room_tries.tries := 0;
          room_tries.window_started_at := now();
        end if;
        if room_tries.tries + 1 >= 20 then
          update public.watch_guest_tries g set tries = 0, window_started_at = now(), locked_until = now() + interval '10 minutes' where g.room_id = room;
          return 'locked';
        end if;
        update public.watch_guest_tries g set tries = room_tries.tries + 1, window_started_at = room_tries.window_started_at, locked_until = null where g.room_id = room;
      end if;
      if attempt.tries + 1 >= 5 then
        update public.watch_join_attempts a set tries = 0, locked_until = now() + interval '10 minutes' where a.room_id = room and a.user_id = caller;
        return 'locked';
      end if;
      update public.watch_join_attempts a set tries = attempt.tries + 1, locked_until = null where a.room_id = room and a.user_id = caller;
      return 'wrong';
    end if;
    delete from public.watch_join_attempts a where a.room_id = room and a.user_id = caller;
  end if;

  select coalesce(nullif(p.display_name, ''), 'Unknown') into caller_label from public.profiles p where p.id = caller;
  insert into public.watch_members (room_id, user_id, label) values (room, caller, coalesce(caller_label, 'Unknown'))
  on conflict (room_id, user_id) do nothing;
  return 'joined';
end;
$function$;

create or replace function public.watch_join_link(link text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  caller uuid := auth.uid();
  joined_room uuid;
  caller_label text;
begin
  if caller is null or public.is_banned() or public.is_guest() then return null; end if;
  if link is null or char_length(link) not between 32 and 64 then return null; end if;

  select l.room_id into joined_room
    from public.watch_room_links l join public.watch_rooms r on r.id = l.room_id
   where l.token = link and r.origin = 'music' and r.ended_at is null;
  if joined_room is null then return null; end if;

  if exists (select 1 from public.watch_members m where m.room_id = joined_room and m.user_id = caller and m.removed_at is not null) then
    return null;
  end if;
  -- BLOCK: the host has blocked the caller.
  if exists (select 1 from public.watch_rooms r join public.blocks b on b.blocker = r.host_id and b.blocked = caller where r.id = joined_room) then
    return null;
  end if;

  select coalesce(nullif(p.display_name, ''), 'Unknown') into caller_label from public.profiles p where p.id = caller;
  insert into public.watch_members (room_id, user_id, label) values (joined_room, caller, coalesce(caller_label, 'Unknown'))
  on conflict (room_id, user_id) do nothing;
  return joined_room;
end;
$function$;
