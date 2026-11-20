-- The weekly email, phase 2 of SPEC-notifications.md (Luke's answers 6A 7A 8A 9A 10A; "A: set up debaser.site").
--
-- What this adds. Nothing existing is deleted or changed:
--   1. A lock for the weekly email, made here at random inside the database's vault (the hourly MEDIA fetch's pattern,
--      20261031190000_web_ingest_lock.sql): no person types it, and it is in no file, migration or timer row.
--   2. notify_digest_due(lock, week start): for the site, the people who asked for the weekly email and haven't had this
--      week's, with their address, their unsubscribe code and their unread notifications (newest 5 of each kind, with how
--      many in all). Never test or hidden accounts, banned accounts, stream guests, or anybody without an address.
--      Private words stay out: names, titles and where each line opens only, never a notification's text.
--   3. notify_digest_sent(lock, person): records that their email went, so nobody gets two in one week.
--   4. notify_unsubscribe(code, on): the email's one-click link. Changes WEEKLY EMAIL only, for the one person whose
--      random code it is; anybody may call it, since the code is the key.
--   5. A timer: minute 23 of every hour on Sundays and Mondays (UTC), calling https://debaser.site/api/notify/digest with
--      the lock. The site sends only between Sunday 18:00 and Monday 18:00 UK time, so summer time needs no second timer.
--
-- Re-runnable: the secret only if missing, functions replaced, the timer unscheduled by name before it is scheduled.

-- 1. The lock ------------------------------------------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'notify_digest_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'notify_digest_secret', 'Weekly email lock');
  end if;
end;
$$;

create or replace function public.notify_digest_lock_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(length(p_secret) >= 32, false)
    and exists (
      select 1
      from vault.decrypted_secrets s
      where s.name = 'notify_digest_secret'
        and extensions.digest(s.decrypted_secret, 'sha256') = extensions.digest(p_secret, 'sha256')
    );
$$;

revoke all on function public.notify_digest_lock_ok(text) from public, anon, authenticated;

-- 2. Who is owed this week's email, and what goes in it ---------------------------------------------------------------

create or replace function public.notify_digest_due(p_secret text, p_week_start timestamptz)
returns table (
  person uuid, email text, unsubscribe_code uuid, kind text, actor_name text, thread_title text,
  thread_id uuid, recommendation_id uuid, invite_id uuid, room_id uuid, href text, created_at timestamptz, kind_total integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.notify_digest_lock_ok(p_secret) or p_week_start is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return query
    with owed as (
      select p.person, u.email::text as email, p.unsubscribe_code, p.replies, p.letters, p.live, p.comic, p.invites,
             greatest(coalesce(p.last_emailed_at, p_week_start - interval '7 days'), p_week_start - interval '7 days') as since
      from public.notification_prefs p
      join auth.users u on u.id = p.person
      join public.profiles pr on pr.id = p.person
      where p.weekly_email
        and (p.last_emailed_at is null or p.last_emailed_at < p_week_start)
        and u.email is not null and u.email <> ''
        and not coalesce(u.is_anonymous, false)
        and not pr.is_hidden
        and pr.banned_at is null
    ),
    waiting as (
      select o.person, o.email, o.unsubscribe_code, n.kind, n.actor_name, n.thread_title, n.thread_id, n.recommendation_id,
             n.invite_id, n.room_id, n.href, n.created_at,
             row_number() over (partition by o.person, n.kind order by n.created_at desc) as at,
             count(*) over (partition by o.person, n.kind) as total
      from owed o
      join public.forum_notifications n on n.user_id = o.person
      where n.read_at is null
        and n.created_at > o.since
        and ((n.kind in ('tag', 'reply') and o.replies)
          or (n.kind in ('recommend', 'letter') and o.letters)
          or (n.kind = 'live' and o.live)
          or (n.kind in ('comic', 'comic_reply') and o.comic)
          or (n.kind = 'invite' and o.invites))
    )
    select w.person, w.email, w.unsubscribe_code, w.kind, w.actor_name, left(w.thread_title, 120), w.thread_id,
           w.recommendation_id, w.invite_id, w.room_id, w.href, w.created_at, w.total::integer
    from waiting w
    where w.at <= 5
    order by w.person, w.kind, w.created_at desc
    limit 5000;
end;
$$;

revoke all on function public.notify_digest_due(text, timestamptz) from public, anon, authenticated;
grant execute on function public.notify_digest_due(text, timestamptz) to anon, authenticated;

-- 3. This week's went --------------------------------------------------------------------------------------------------

create or replace function public.notify_digest_sent(p_secret text, p_person uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.notify_digest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.notification_prefs set last_emailed_at = now() where person = p_person;
end;
$$;

revoke all on function public.notify_digest_sent(text, uuid) from public, anon, authenticated;
grant execute on function public.notify_digest_sent(text, uuid) to anon, authenticated;

-- 4. The unsubscribe link ----------------------------------------------------------------------------------------------

create or replace function public.notify_unsubscribe(p_code uuid, p_on boolean default false)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if p_code is null then
    return false;
  end if;
  update public.notification_prefs set weekly_email = coalesce(p_on, false), updated_at = now() where unsubscribe_code = p_code;
  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

revoke all on function public.notify_unsubscribe(uuid, boolean) from public, anon, authenticated;
grant execute on function public.notify_unsubscribe(uuid, boolean) to anon, authenticated;

-- 5. The timer ---------------------------------------------------------------------------------------------------------

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'notify-digest') then
    perform cron.unschedule('notify-digest');
  end if;
end;
$$;

select cron.schedule(
  'notify-digest',
  '23 * * * 0,1',
  $job$
  select net.http_post(
    url := 'https://debaser.site/api/notify/digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notify-digest-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notify_digest_secret' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);

-- Check it landed (run on their own afterwards):
--   select jobname, schedule, active from cron.job where jobname = 'notify-digest';
--   select proname from pg_proc where proname like 'notify_%' order by 1;
