-- -----------------------------------------------------------------------------
-- The sweep: take the throwaway accounts out, and the directory with them.
-- -----------------------------------------------------------------------------
-- Run `throwaway-accounts-review.sql` first and read the list. Then run this whole file in the
-- Supabase SQL Editor (nothing selected).
--
-- It removes one thing - the accounts the live checks signed up - plus whatever those accounts left
-- behind, so no row is left pointing at nobody. Deleting an auth user cascades to everything keyed
-- to it (its profile, its picture versions, its songs, the tags other people gave it, and the
-- comments left on its page), and sets the *author* columns of what it wrote to null - which is why
-- the words are deleted first, while the ids are still known. Idempotent: run it twice and the
-- second run finds nothing.
--
-- Nothing here can touch an account that really exists unless it wears one of the test names.

begin;

create temporary table sweep_ids on commit drop as
select u.id
from auth.users u
left join public.profiles p on p.id = u.id
where u.email ilike 'cline-%'
   or u.email ilike 'probe-%'
   or u.email ilike 'diag-%'
   or p.display_name in ('PROBE ACCOUNT', 'probe actor', 'probe to')
   or p.display_name ilike 'diag %';

-- What they wrote, while the ids are still there to match on.
delete from public.forum_notifications where user_id in (select id from sweep_ids) or actor_id in (select id from sweep_ids);
delete from public.profile_comments     where author_id in (select id from sweep_ids);
delete from public.forum_comments       where author_id in (select id from sweep_ids);
delete from public.forum_threads        where author_id in (select id from sweep_ids);
delete from public.comms_messages       where author_id in (select id from sweep_ids);
delete from public.comms_members        where user_id in (select id from sweep_ids);
delete from public.comms_threads        where created_by in (select id from sweep_ids);

-- Section 23, when it is there: the arcade's invitations name both accounts.
do $$
begin
  if to_regclass('public.game_invites') is not null then
    delete from public.game_invites
    where from_user in (select id from sweep_ids) or to_user in (select id from sweep_ids);
  end if;
end $$;

-- And the accounts themselves.
delete from auth.users where id in (select id from sweep_ids);

commit;

-- What is left, in one result: the account count, and the directory as the site will draw it.
select count(*) as accounts_left from auth.users;

select id, display_name, created_at from public.profiles order by created_at;
