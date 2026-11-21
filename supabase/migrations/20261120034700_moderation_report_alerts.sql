-- Report alerts on the bell (SPEC-moderation.md, 7A; Luke 2026-11-20: "Yes, add them"), now that the notifications are built
-- (SPEC-notifications.md, 20261120014611_notifications_phase1.sql).
--
-- What this adds, and nothing else:
--   1. 'report' joins the kinds a notification may be (the notifications' list, unchanged, plus 'report').
--   2. Every report or appeal filed tells each moderator once, on the bell: "NEW REPORT: <name> · <REASON>" or "NEW APPEAL: <name>",
--      opening REPORTS (/forum?reports=1). Filed by the database itself (a trigger on `reports`), so it names nobody's words and
--      the reporter is not told to anybody but the moderators. A moderator's own report doesn't tell them.
--   3. A browser can't file a 'report' notification of its own: the row is dropped, the way the notifications' gate drops the
--      database-only kinds.
-- Nothing is deleted. Re-runnable: the constraint and the triggers are dropped and recreated by name.

-- 1. The kinds.
alter table public.forum_notifications drop constraint if exists forum_notifications_kind_check;
alter table public.forum_notifications
  add constraint forum_notifications_kind_check
  check (kind in ('tag', 'reply', 'invite', 'recommend', 'letter', 'live', 'comic', 'comic_reply', 'report'));

-- 3. Only the database files a report alert.
create or replace function public.forum_notifications_report_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'report' and coalesce(current_setting('debaser.notify_internal', true), '') <> 'on' then
    return null;
  end if;
  return new;
end;
$$;
revoke all on function public.forum_notifications_report_guard() from public, anon, authenticated;

drop trigger if exists forum_notifications_report_guard on public.forum_notifications;
create trigger forum_notifications_report_guard
  before insert on public.forum_notifications
  for each row execute function public.forum_notifications_report_guard();

-- 2. A report or an appeal tells the moderators.
create or replace function public.reports_alert_moderators()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  who text;
  line text;
begin
  select coalesce(nullif(p.display_name, ''), 'SOMEBODY') into who from public.profiles p where p.id = new.account;
  line := case
    when new.kind = 'appeal' then 'NEW APPEAL: ' || coalesce(who, 'SOMEBODY')
    else 'NEW REPORT: ' || coalesce(who, 'SOMEBODY') || ' · ' || upper(coalesce(new.reason, ''))
  end;

  perform set_config('debaser.notify_internal', 'on', true);
  insert into public.forum_notifications (user_id, kind, actor_id, actor_name, thread_id, thread_title, body, href, ref)
  select m.user_id, 'report', null, 'REPORTS', null, left(line, 200), '', '/forum?reports=1', 'report:' || new.id::text
    from public.moderators m
   where m.user_id is distinct from new.reporter
  on conflict (user_id, ref) where ref is not null do nothing;
  perform set_config('debaser.notify_internal', '', true);
  return null;
end;
$$;
revoke all on function public.reports_alert_moderators() from public, anon, authenticated;

drop trigger if exists reports_alert_moderators on public.reports;
create trigger reports_alert_moderators
  after insert on public.reports
  for each row execute function public.reports_alert_moderators();
