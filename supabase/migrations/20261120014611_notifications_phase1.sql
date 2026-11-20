-- Notifications, phase 1 (SPEC-notifications.md; Luke's answers 2026-11-20: "1b-but they are also like a photo album or
-- letter 2c 3a 4a 5b 6a 7a 8a 9a 10a 11b", and "Yes, build phase 1").
--
-- What this adds. Nothing existing is deleted, and no existing notification row changes:
--   1. forum_notifications: kinds 'letter', 'live', 'comic' and 'comic_reply' (reserved for COMIC's panel comments), and
--      three columns: href (where the line opens, a site address only), room_id (the live room) and ref (a key, so one
--      event is never filed twice for one person).
--   2. notification_prefs: one row a person, their switches (one per kind, covering the site and the email), BALLOONS,
--      WEEKLY EMAIL (phase 2 sends it) and the code its unsubscribe link carries. Owner only.
--   3. live_watches: TELL ME WHEN LIVE. Only the picker sees, adds or removes their own picks; the person picked never.
--   4. A gate before every notification is filed: a kind switched off is not filed; a letter sent through RECOMMEND is
--      filed as 'letter'; a browser can't file the new kinds or set the new columns.
--   5. When a room becomes listed as OPEN or PASSWORD, the people who picked its host are told (once per room per 30 min).
--   6. notify_comic_page(): COMIC's way in (agreed with the COMIC session). The database only, never a browser.
--
-- Re-runnable: `if not exists`, constraints, policies and triggers dropped and recreated by name.

-- 1. The feed's new kinds and columns ----------------------------------------------------------------------------------

alter table public.forum_notifications add column if not exists href text;
alter table public.forum_notifications add column if not exists room_id uuid;
alter table public.forum_notifications add column if not exists ref text;

alter table public.forum_notifications drop constraint if exists forum_notifications_kind_check;
alter table public.forum_notifications
  add constraint forum_notifications_kind_check
  check (kind in ('tag', 'reply', 'invite', 'recommend', 'letter', 'live', 'comic', 'comic_reply'));

alter table public.forum_notifications drop constraint if exists forum_notifications_href_shape;
alter table public.forum_notifications
  add constraint forum_notifications_href_shape
  check (href is null or (char_length(href) <= 300 and href like '/%' and href not like '//%' and position(chr(92) in href) = 0));

alter table public.forum_notifications drop constraint if exists forum_notifications_room_id_fkey;
alter table public.forum_notifications
  add constraint forum_notifications_room_id_fkey
  foreign key (room_id) references public.watch_rooms (id) on delete set null;

create unique index if not exists forum_notifications_user_ref_idx
  on public.forum_notifications (user_id, ref) where ref is not null;

-- 2. The switches ----------------------------------------------------------------------------------------------------

create table if not exists public.notification_prefs (
  person uuid primary key references auth.users (id) on delete cascade,
  replies boolean not null default true,
  letters boolean not null default true,
  live boolean not null default true,
  comic boolean not null default false,
  invites boolean not null default true,
  balloons boolean not null default true,
  weekly_email boolean not null default false,
  unsubscribe_code uuid not null default gen_random_uuid(),
  last_emailed_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists notification_prefs_unsubscribe_idx on public.notification_prefs (unsubscribe_code);

alter table public.notification_prefs enable row level security;

drop policy if exists "own notification prefs readable" on public.notification_prefs;
create policy "own notification prefs readable" on public.notification_prefs
  for select to authenticated using (person = auth.uid());

drop policy if exists "own notification prefs addable" on public.notification_prefs;
create policy "own notification prefs addable" on public.notification_prefs
  for insert to authenticated with check (person = auth.uid() and not coalesce(public.is_guest(), false));

drop policy if exists "own notification prefs changeable" on public.notification_prefs;
create policy "own notification prefs changeable" on public.notification_prefs
  for update to authenticated using (person = auth.uid()) with check (person = auth.uid());

-- The browser may set the switches; the unsubscribe code and the last email time are the database's own.
revoke all on public.notification_prefs from anon, authenticated;
grant select (person, replies, letters, live, comic, invites, balloons, weekly_email, updated_at) on public.notification_prefs to authenticated;
grant insert (person, replies, letters, live, comic, invites, balloons, weekly_email, updated_at) on public.notification_prefs to authenticated;
-- `person` is in the update list only because a save is an upsert (PostgREST sets every column it sent); the policy's
-- `with check` holds it to the account making the change.
grant update (person, replies, letters, live, comic, invites, balloons, weekly_email, updated_at) on public.notification_prefs to authenticated;

-- 3. TELL ME WHEN LIVE -----------------------------------------------------------------------------------------------

create table if not exists public.live_watches (
  watcher uuid not null references auth.users (id) on delete cascade,
  host uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (watcher, host),
  constraint live_watches_not_self check (watcher <> host)
);

-- Who picked this host: the fan-out's one question.
create index if not exists live_watches_host_idx on public.live_watches (host);

alter table public.live_watches enable row level security;

drop policy if exists "own live watches readable" on public.live_watches;
create policy "own live watches readable" on public.live_watches
  for select to authenticated using (watcher = auth.uid());

drop policy if exists "own live watches addable" on public.live_watches;
create policy "own live watches addable" on public.live_watches
  for insert to authenticated with check (
    watcher = auth.uid()
    and not coalesce(public.is_guest(), false)
    and not public.is_banned()
    and exists (select 1 from public.profiles p where p.id = host)
    and (select count(*) from public.live_watches w where w.watcher = auth.uid()) < 200
  );

drop policy if exists "own live watches removable" on public.live_watches;
create policy "own live watches removable" on public.live_watches
  for delete to authenticated using (watcher = auth.uid());

revoke all on public.live_watches from anon, authenticated;
grant select, delete on public.live_watches to authenticated;
grant insert (watcher, host) on public.live_watches to authenticated;

-- 4. The gate before every notification ------------------------------------------------------------------------------
--    Filed by the database's own functions (with debaser.notify_internal on for the length of their insert): anything.
--    Filed by a browser (a tag, a reply, an invite): the old kinds only, and none of the new columns.

create or replace function public.forum_notifications_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  internal boolean := coalesce(current_setting('debaser.notify_internal', true), '') = 'on';
  prefs public.notification_prefs;
  blocked boolean := false;
begin
  -- Blocking (MODERATION's SPEC-moderation.md, one way): when the person told has blocked whoever did it, nothing is
  -- filed. Read only once MODERATION's `has_blocked(blocker, blocked)` exists, so this gate needs no change when it ships.
  if new.actor_id is not null and to_regprocedure('public.has_blocked(uuid, uuid)') is not null then
    execute 'select public.has_blocked($1, $2)' into blocked using new.user_id, new.actor_id;
    if coalesce(blocked, false) then
      return null;
    end if;
  end if;

  if not internal then
    if new.kind in ('letter', 'live', 'comic', 'comic_reply') then
      return null;
    end if;
    new.href := null;
    new.room_id := null;
    new.ref := null;
  end if;

  -- A letter travels inside a recommendation (20261111010257_recommendation_letters.sql): told as a letter.
  if new.kind = 'recommend' and new.recommendation_id is not null
     and exists (select 1 from public.recommendations r where r.id = new.recommendation_id and r.letter is not null) then
    new.kind := 'letter';
  end if;

  select * into prefs from public.notification_prefs p where p.person = new.user_id;
  if found then
    if (new.kind in ('tag', 'reply') and not prefs.replies)
       or (new.kind in ('recommend', 'letter') and not prefs.letters)
       or (new.kind = 'live' and not prefs.live)
       or (new.kind in ('comic', 'comic_reply') and not prefs.comic)
       or (new.kind = 'invite' and not prefs.invites) then
      return null;
    end if;
  elsif new.kind in ('comic', 'comic_reply') then
    -- No row yet means the defaults, and COMIC NEW PAGES starts off: following the comic turns it on.
    return null;
  end if;

  return new;
end;
$$;

revoke all on function public.forum_notifications_gate() from public, anon, authenticated;

drop trigger if exists forum_notifications_gate on public.forum_notifications;
create trigger forum_notifications_gate
  before insert on public.forum_notifications
  for each row execute function public.forum_notifications_gate();

-- 5. A picked person's room goes live --------------------------------------------------------------------------------
--    Listed as OPEN or PASSWORD, not ended. A PRIVATE (link-only) room tells nobody.

create or replace function public.watch_rooms_tell_watchers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  listed_now boolean := new.is_public and new.privacy in ('open', 'password') and new.ended_at is null;
  -- CASE, so OLD is never read on an INSERT (where it is unassigned): SQL doesn't promise AND's order.
  listed_before boolean := case when tg_op = 'UPDATE' then (old.is_public and old.privacy in ('open', 'password') and old.ended_at is null) else false end;
  host_name text;
begin
  if not listed_now or listed_before then
    return null;
  end if;

  select coalesce(p.display_name, new.original_host_label, 'Anonymous') into host_name
  from public.profiles p where p.id = new.host_id;

  perform set_config('debaser.notify_internal', 'on', true);
  insert into public.forum_notifications (user_id, kind, actor_id, actor_name, thread_id, thread_title, body, href, room_id)
  select w.watcher, 'live', new.host_id, coalesce(host_name, 'Anonymous'), null, left(coalesce(new.name, ''), 200), '',
         '/forum?watch=' || new.id::text, new.id
  from public.live_watches w
  where w.host = new.host_id
    and w.watcher <> new.host_id
    and not exists (
      select 1 from public.forum_notifications n
      where n.user_id = w.watcher and n.kind = 'live' and n.room_id = new.id and n.created_at > now() - interval '30 minutes'
    );
  perform set_config('debaser.notify_internal', '', true);

  return null;
end;
$$;

revoke all on function public.watch_rooms_tell_watchers() from public, anon, authenticated;

drop trigger if exists watch_rooms_tell_watchers on public.watch_rooms;
create trigger watch_rooms_tell_watchers
  after insert or update of is_public, privacy, ended_at on public.watch_rooms
  for each row execute function public.watch_rooms_tell_watchers();

-- 6. COMIC's way in --------------------------------------------------------------------------------------------------
--    One alert per release batch, ever (p_ref = 'comic:release:<batch id>'), to everyone with COMIC NEW PAGES on.
--    Called by COMIC's own release timer in the database. No browser may call it.

create or replace function public.notify_comic_page(p_ref text, p_title text, p_body text, p_href text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  told integer;
begin
  if p_ref is null or btrim(p_ref) = '' or char_length(p_ref) > 200 then
    raise exception 'a comic alert needs its ref' using errcode = '22023';
  end if;
  -- No backslash anywhere: browsers read `/\host` as `//host`, another site.
  if p_href is null or char_length(p_href) > 300 or p_href not like '/%' or p_href like '//%' or position(chr(92) in p_href) > 0 then
    raise exception 'a comic alert opens a site address' using errcode = '22023';
  end if;

  perform set_config('debaser.notify_internal', 'on', true);
  insert into public.forum_notifications (user_id, kind, actor_id, actor_name, thread_id, thread_title, body, href, ref)
  select p.person, 'comic', null, 'DEBASER', null, left(coalesce(p_title, ''), 200), left(coalesce(p_body, ''), 120), p_href, p_ref
  from public.notification_prefs p
  join public.profiles pr on pr.id = p.person
  where p.comic and pr.banned_at is null
  on conflict (user_id, ref) where ref is not null do nothing;
  get diagnostics told = row_count;
  perform set_config('debaser.notify_internal', '', true);

  return told;
end;
$$;

revoke all on function public.notify_comic_page(text, text, text, text) from public, anon, authenticated;
grant execute on function public.notify_comic_page(text, text, text, text) to service_role;

-- Check it landed (run on their own afterwards):
--   select conname from pg_constraint where conname in ('forum_notifications_kind_check', 'forum_notifications_href_shape');
--   select tablename, rowsecurity from pg_tables where tablename in ('notification_prefs', 'live_watches');
--   select tgname from pg_trigger where tgname in ('forum_notifications_gate', 'watch_rooms_tell_watchers');
--   select proname from pg_proc where proname in ('notify_comic_page', 'forum_notifications_gate', 'watch_rooms_tell_watchers');
