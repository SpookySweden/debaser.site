-- -----------------------------------------------------------------------------
-- Hidden test accounts, part 2: a hidden profile cannot be deleted from the site either
-- -----------------------------------------------------------------------------
-- Run this whole file with `npm run db:push`. It is idempotent: the guard function is replaced and its
-- trigger dropped and re-created by name. It changes no row.
--
-- Why: 20261021000032 refused any insert or update that moved `profiles.is_hidden` from a visitor's
-- request. A delete was still open - `profiles delete own` lets an account delete its own profile row -
-- and the presence heartbeat re-creates a missing row (an upsert) with the default, unmarked. So a test
-- account (anybody holding the test password) could un-hide itself in two steps and appear on /users.
--
-- Now a visitor's request - signed in or not - cannot delete a row that is marked hidden. Everything else
-- is as it was: an ordinary account still deletes its own profile row, and a migration, the SQL editor and
-- the service role are left alone (deleting a test account from the dashboard cascades through here as
-- the auth service, with no `auth.uid()`, and goes through).

create or replace function public.profiles_guard_hidden()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  visitor boolean := auth.uid() is not null or current_user in ('anon', 'authenticated');
begin
  if tg_op = 'DELETE' then
    if old.is_hidden and visitor then
      raise exception 'a hidden account cannot be deleted from the site - only a migration can do that'
        using errcode = 'insufficient_privilege';
    end if;

    return old;
  end if;

  if (tg_op = 'INSERT' and new.is_hidden)
     or (tg_op = 'UPDATE' and new.is_hidden is distinct from old.is_hidden) then
    if visitor then
      raise exception 'an account cannot be hidden or un-hidden from the site - only a migration can do that'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_hidden on public.profiles;
create trigger profiles_guard_hidden
  before insert or update or delete on public.profiles
  for each row execute function public.profiles_guard_hidden();

-- Afterwards: the trigger fires on all three (tgtype 31 = row, before, insert, delete, update).
--   select tgname, tgtype from pg_trigger where tgname = 'profiles_guard_hidden';
