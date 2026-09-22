-- 16. A group belongs to whoever opened it.
--
-- The report: somebody invited to a group renamed it and claimed it as his own. Both are a
-- direct write to `public.comms_threads` - `name` and `created_by` - and the update policy
-- said yes to either, because it asked only "are you in this conversation". Confirmed against
-- this project before the fix, as a member, writing the values that were already there:
--
--   a member writes the group name            ALLOWED :: 1 row(s) written
--   a member writes the ownership column      ALLOWED :: 1 row(s) written
--
-- The same policy let a member add *himself* to any group he could name ("adding yourself" was
-- allowed for its own sake, so the creator could get into a group they had just made), which
-- is a reading hole as well as an ownership one: being in a group is what makes its messages
-- readable.
--
-- Three layers, in the order they can be trusted:
--
--   1. the client may write exactly one column, `updated_at` - the stamp `sendMessage` puts on
--      a conversation. Every other column is granted away, so a PATCH of `name` is refused by
--      the table itself, before a policy is consulted at all;
--   2. a trigger refuses a change to the metadata unless the caller is the owner (or the house
--      account, which repairs what it must). A policy re-created by hand later cannot quietly
--      re-open the hole;
--   3. the changes that should happen go through functions that check first - `rename_group`,
--      `transfer_group_ownership`, `remove_group_member`, `leave_group` - and ownership only
--      moves two ways: the owner hands it over, or the owner leaves and it passes to whoever
--      has been in the group longest.
--
-- Re-running this file is safe: every statement replaces what it finds.

-- 1. One column of a thread belongs to the client.

revoke update on public.comms_threads from anon, authenticated;
grant update (updated_at) on public.comms_threads to authenticated;

-- 2. Groups can be opened at all: section 12 re-created this policy without the `created_by`
--    case, and a group has no pair to be "in" - its members cannot exist before it does.

drop policy if exists "comms threads insert by participant" on public.comms_threads;
create policy "comms threads insert by participant" on public.comms_threads
  for insert with check (
    not public.is_banned()
    and (auth.uid() in (participant_a, participant_b) or created_by = auth.uid())
  );

-- Who owns a conversation: the account that opened it, or either side of a dm. Definer and
-- stable, like `is_comms_member`, so a policy can ask it without recursing through the
-- threads' own policies.

create or replace function public.is_comms_owner(thread text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.comms_threads t
    where t.id = thread
      and (t.created_by = auth.uid() or auth.uid() in (t.participant_a, t.participant_b))
  );
$$;

-- 3. Adding people: anybody in it may add somebody else; adding *yourself* only works in a
--    conversation you opened, which is what gets a new group's creator into their own group.

drop policy if exists "comms members added by members" on public.comms_members;
create policy "comms members added by members" on public.comms_members
  for insert with check (
    not public.is_banned()
    and (
      (user_id = auth.uid() and public.is_comms_owner(thread_id))
      or public.is_comms_member(thread_id)
    )
  );

-- 4. The guard: nothing touches a conversation's metadata but its owner. `auth.uid()` inside a
--    trigger is still the caller's, whoever's privileges the function body runs with, so this
--    holds for a definer function, a policy and a console session alike. A null caller is the
--    SQL editor or the service role - the way a repair is made - and is left alone.

create or replace function public.comms_threads_guard_metadata()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if new.created_by is distinct from old.created_by and new.created_by is not null then
    if not exists (
      select 1 from public.comms_members m
      where m.thread_id = new.id and m.user_id = new.created_by
    ) then
      raise exception 'the owner of a conversation has to be in it' using errcode = 'check_violation';
    end if;
  end if;

  if new.name is distinct from old.name
     or new.kind is distinct from old.kind
     or new.created_by is distinct from old.created_by
     or new.participant_a is distinct from old.participant_a
     or new.participant_b is distinct from old.participant_b then
    if caller is not null and caller is distinct from old.created_by and not public.is_admin() then
      raise exception 'only the owner of a group may change it' using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists comms_threads_guard_metadata on public.comms_threads;
create trigger comms_threads_guard_metadata
  before update on public.comms_threads
  for each row execute function public.comms_threads_guard_metadata();


-- 5. The four things that may change a group, each checking for itself. They are definer
--    functions so that the column grant above cannot stand in their way, and they are the only
--    door: the app calls these rather than writing the table.

-- Renaming: the owner's, or the house account's when something has to be put right.
create or replace function public.rename_group(thread text, new_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  trimmed text := btrim(coalesce(new_name, ''));
begin
  if not (public.is_comms_owner(thread) or public.is_admin()) then
    raise exception 'only the owner may rename a group' using errcode = 'insufficient_privilege';
  end if;

  if trimmed = '' or length(trimmed) > 40 then
    raise exception 'a group name is between 1 and 40 characters' using errcode = 'check_violation';
  end if;

  update public.comms_threads set name = trimmed where id = thread and kind = 'group';
end;
$$;

-- Handing it over: the owner's choice, to somebody already in the group.
create or replace function public.transfer_group_ownership(thread text, to_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_comms_owner(thread) or public.is_admin()) then
    raise exception 'only the owner may hand a group over' using errcode = 'insufficient_privilege';
  end if;

  if to_user is null
     or not exists (select 1 from public.comms_members m where m.thread_id = thread and m.user_id = to_user) then
    raise exception 'a group can only be handed to somebody in it' using errcode = 'check_violation';
  end if;

  if public.is_banned(to_user) then
    raise exception 'that account is banned' using errcode = 'check_violation';
  end if;

  update public.comms_threads set created_by = to_user where id = thread and kind = 'group';
end;
$$;

-- Leaving: anybody in it. The owner leaving passes the group to whoever has been in it longest,
-- and the last member out takes the group with them - a group nobody is in cannot be read by
-- anybody, so leaving it behind would only be litter.
create or replace function public.leave_group(thread text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  leaver uuid := auth.uid();
  successor uuid;
begin
  if leaver is null then
    raise exception 'leaving needs a signed-in account' using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.comms_members m where m.thread_id = thread and m.user_id = leaver
  ) then
    raise exception 'you are not in this conversation' using errcode = 'check_violation';
  end if;

  delete from public.comms_members m where m.thread_id = thread and m.user_id = leaver;

  if exists (select 1 from public.comms_threads t where t.id = thread and t.created_by = leaver) then
    select m.user_id into successor
    from public.comms_members m
    where m.thread_id = thread
    order by m.joined_at, m.user_id
    limit 1;

    if successor is null then
      delete from public.comms_threads t where t.id = thread;
    else
      update public.comms_threads set created_by = successor where id = thread;
    end if;
  end if;
end;
$$;

-- Taking somebody else out: the owner's (or the house account's). You can always take yourself
-- out by leaving.
create or replace function public.remove_group_member(thread text, user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_comms_owner(thread) or public.is_admin()) then
    raise exception 'only the owner may remove a member' using errcode = 'insufficient_privilege';
  end if;

  if user_id = auth.uid() then
    perform public.leave_group(thread);
    return;
  end if;

  delete from public.comms_members m where m.thread_id = thread and m.user_id = user_id;
end;
$$;

-- The app reaches these with the signed-in role, and nothing else may.
revoke all on function public.rename_group(text, text) from public, anon;
revoke all on function public.transfer_group_ownership(text, uuid) from public, anon;
revoke all on function public.leave_group(text) from public, anon;
revoke all on function public.remove_group_member(text, uuid) from public, anon;

grant execute on function public.rename_group(text, text) to authenticated;
grant execute on function public.transfer_group_ownership(text, uuid) to authenticated;
grant execute on function public.leave_group(text) to authenticated;
grant execute on function public.remove_group_member(text, uuid) to authenticated;

-- 6. Putting right what was taken.
--
-- Ownership on this project reads correctly for the group in the report
-- (`grp:3f7e8deb-bb01-4424-8692-14e252d10409` is owned by 640d9861..., the account that opened
-- it), so nothing needs repairing today. If a group was taken, the owner is one statement away -
-- the SQL editor is not a client, so the guard above steps aside for it:
--
--   update public.comms_threads
--      set created_by = '<the account that opened it>'
--    where id = 'grp:...' and kind = 'group';
--
-- The house account can also do it from the app once this file is in, through
-- `transfer_group_ownership()`, which accepts it as the moderator.
