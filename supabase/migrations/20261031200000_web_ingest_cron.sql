-- WEB (SPEC-web.md): once an hour, pg_cron asks pg_net to POST to the ingest route with the lock in a
-- header. Promoted from supabase/held/ on 2026-10-31 (Luke's OK), after the keyless route went live and a
-- manual ingest made the same call and saved 25 items.
--
-- The lock is read from Vault at call time (`vault.decrypted_secrets`; 20261031190000_web_ingest_lock.sql
-- made it), so it is in no file, no migration history and no cron.job row. If it were ever missing, the
-- header would be null, the route would answer 401 and nothing would be written.
--
-- The address is the production deployment `npm run read` checks (scripts/read-site.cjs). If the site
-- moves to its own domain, write a new migration that reschedules the job with the new address.
--
-- Re-runnable: extensions `if not exists`; the job is unscheduled by name before it is scheduled.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'web-ingest') then
    perform cron.unschedule('web-ingest');
  end if;
end;
$$;

-- Minute 17 of every hour: off the top of the hour, when everybody else's jobs fire.
select cron.schedule(
  'web-ingest',
  '17 * * * *',
  $job$
  select net.http_post(
    url := 'https://debaser-site.vercel.app/api/web/ingest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-web-ingest-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'web_ingest_secret' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
