-- Somebody logging in with their old address gets the window that asks for a new password (Luke, 2026-11-06). This tells the sign-in form
-- whether an address is waiting to come back, and the name to greet it by, and nothing else. It reads one address at a time, so it can't
-- list them, and answers only for what's still unclaimed. The house account's address is left out: that one is locked.
create or replace function public.lost_account_name(mail text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.display_name from public.account_restores r
  where r.email = lower(btrim(coalesce(mail, ''))) and r.claimed_by is null and r.email <> 'admin1212@debaser.site';
$$;
revoke all on function public.lost_account_name(text) from public;
grant execute on function public.lost_account_name(text) to anon, authenticated;
