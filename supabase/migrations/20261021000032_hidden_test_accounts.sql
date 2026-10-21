-- -----------------------------------------------------------------------------
-- Hidden test accounts: the site's own test accounts are never listed as people
-- -----------------------------------------------------------------------------
-- Run this whole file with `npm run db:push`. It is idempotent: the column is added only if it is missing,
-- the guard is replaced by name, and the marking only touches a row that is not marked yet. It drops and
-- deletes nothing.
--
-- Why (SPEC-test-accounts.md): the checks and tools sign in as four kept test accounts - TEST ACCOUNT A, B,
-- C and D, `test-a@` to `test-d@debaser.site` - instead of signing a new account up on every run. Those four
-- must never appear where a person is listed, picked or counted: the directory on /users, who's online, the
-- comms and tagging pickers, the arcade's challenge list. For everybody, the test accounts included, so a
-- check signed in as A can prove A is missing. What they post, reply, message and upload is NOT hidden, and
-- a profile still opens by its direct link: only the lists skip them.
--
-- The marker lives here; the lists are the app's. Every list of people is drawn from the account list, and
-- `listedAccounts()` (app/lib/auth/hidden.ts) is the one place that drops a hidden account from it - the
-- lists of who is online included, which are drawn from it too. (Comment corrected after this file was
-- pushed; the statements are unchanged.)
-- The column is readable by everybody, like the rest of the profile row, because the app filters on it.
--
-- Who may set it: nobody who is visiting the site. Not the account itself (or anybody could vanish from the
-- directory), not another account, not the house account. The profile's own update policy lets an owner
-- write their whole row, and a policy cannot keep one column out of that, so the guard is a trigger, the
-- same pattern as `comms_threads_guard_metadata`: a change to the marker from a visitor's request - signed
-- in (`auth.uid()` set) or not (the `anon` / `authenticated` roles) - is refused. A migration, the SQL
-- editor and the service role are none of those, which is how the four below are marked.

alter table public.profiles add column if not exists is_hidden boolean not null default false;

comment on column public.profiles.is_hidden is
  'A kept test account: left out of every list of people on the site. Set by a migration only (20261021000032).';

create or replace function public.profiles_guard_hidden()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (tg_op = 'INSERT' and new.is_hidden)
     or (tg_op = 'UPDATE' and new.is_hidden is distinct from old.is_hidden) then
    if auth.uid() is not null or current_user in ('anon', 'authenticated') then
      raise exception 'an account cannot be hidden or un-hidden from the site - only a migration can do that'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_hidden on public.profiles;
create trigger profiles_guard_hidden
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_hidden();

-- The four kept test accounts, by address. An address that has no account yet is simply not matched, so
-- this is safe on a project where some of them were never made; to hide one made later, run this statement
-- again (a database write, so it is asked for first).
update public.profiles p
   set is_hidden = true
  from auth.users u
 where u.id = p.id
   and u.email in ('test-a@debaser.site', 'test-b@debaser.site', 'test-c@debaser.site', 'test-d@debaser.site')
   and not p.is_hidden;

-- Afterwards, these should answer: four rows, all four marked; and the guard in place.
--   select u.email, p.display_name, p.is_hidden from public.profiles p join auth.users u on u.id = p.id
--    where p.is_hidden or u.email like 'test-_@debaser.site';
--   select tgname from pg_trigger where tgname = 'profiles_guard_hidden';
