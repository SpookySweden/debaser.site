-- -----------------------------------------------------------------------------
-- What the live checks leave behind: the throwaway accounts they sign up.
-- -----------------------------------------------------------------------------
-- Read-only. Run it in the Supabase SQL Editor before the sweep, so the list is seen before
-- anything is removed.
--
-- Every check in Temp/ that talks to a real project signs accounts up to exercise a policy - a tag
-- has to be filed by one account *for another*, and a policy cannot be asked anything without a
-- session - and the client cannot delete an account, because that takes the service role, which the
-- site never holds. So they stay in `auth.users`, and `auth.users` is what the user directory on
-- /users lists. Run `throwaway-accounts-sweep.sql` after this to take them out.
--
-- The names they are given are the pattern to search for: `cline-*@debaser.site` (every check), the
-- `probe actor` / `probe to` display names the notification check uses, `diag <stamp>` from the two
-- diagnostics, and `PROBE ACCOUNT` from an earlier session's probe.

select u.id,
       u.email,
       p.display_name,
       u.created_at,
       case when p.id is null then 'no profile row' else 'listed in the directory' end as where_it_shows
from auth.users u
left join public.profiles p on p.id = u.id
where u.email ilike 'cline-%'
   or u.email ilike 'probe-%'
   or u.email ilike 'diag-%'
   or p.display_name in ('PROBE ACCOUNT', 'probe actor', 'probe to')
   or p.display_name ilike 'diag %'
order by u.created_at, u.email;

-- And the other half of the question: what a sweep would leave, which should be the accounts that
-- really exist - the house account and the people who signed themselves up.

select count(*) as accounts_left_after_a_sweep
from auth.users u
left join public.profiles p on p.id = u.id
where not (
  u.email ilike 'cline-%'
  or u.email ilike 'probe-%'
  or u.email ilike 'diag-%'
  or p.display_name in ('PROBE ACCOUNT', 'probe actor', 'probe to')
  or p.display_name ilike 'diag %'
);
