-- People can see who's online by default (Luke, 2026-11-07: "i noticed that it doesnt show other users online status, if that is due to a privacy default, change the default").
-- It was off for new accounts since 20261105135310. The switch stays in each person's privacy settings. Guests stay off: they aren't people in the directory.
--
-- What this changes: the column's default, the accounts that came back after the loss (which only have it off because of that default), and
-- guest sign-ups, which now say off outright. Test accounts and everything else stay as they are.
alter table public.profiles alter column show_online set default true;

update public.profiles set show_online = true where show_online = false and is_hidden = false;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  chosen_name text;
  restoring boolean := false;
  is_house boolean;
begin
  if new.is_anonymous then
    insert into public.profiles (id, display_name, is_hidden, show_online)
    values (new.id, 'GUEST-' || upper(substr(md5(new.id::text), 1, 3)), true, false)
    on conflict (id) do nothing;
    return new;
  end if;

  is_house := lower(coalesce(new.email, '')) = 'admin1212@debaser.site';

  -- The house account's address is public and its power comes with it, so it can only be made while the owner has opened the gate.
  if is_house then
    if not exists (select 1 from public.house_account_gate g where g.open_until > now()) then
      raise exception 'the house account is locked';
    end if;
    insert into public.house_account (id) values (new.id) on conflict (id) do nothing;
    delete from public.house_account_gate where true;
  end if;

  chosen_name := case
    when is_house then 'debaser.site'
    else coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Anonymous'
    )
  end;

  insert into public.profiles (id, display_name, name_colour)
  values (new.id, chosen_name, case when is_house then '#1d3ca6' else null end)
  on conflict (id) do nothing;

  -- The kept test accounts stay out of every list of people, however they come to be made.
  if lower(coalesce(new.email, '')) ~ '^test-[a-d]@debaser\.site$' then
    update public.profiles set is_hidden = true where id = new.id;
  end if;

  -- Somebody coming back after the accounts were lost: their details and their old posts. A failure here must never stop them signing up.
  begin
    restoring := public.restore_lost_account(new.id, new.email);
  exception when others then
    raise warning 'restore_lost_account failed for %: %', new.id, sqlerrm;
  end;
  if restoring then return new; end if;

  -- The welcome tag. Its id is derived from the profile it belongs to, which is what
  -- makes the insert idempotent: running this again cannot file a second welcome.
  --
  -- The giver is looked up rather than assumed, because this trigger also fires for
  -- the house account itself and the two accounts can be created in either order.
  -- `given_by` is nullable, so a missing house account leaves a null giver - which
  -- the app still reads as an approved tag, because what makes a tag pending is the
  -- *owner* having given it to themselves.
  insert into public.profile_tags (id, user_id, label, colour, given_by, given_by_label, hidden)
  values (
    md5('tag-default-new-here:' || new.id::text)::uuid,
    new.id,
    'NEW HERE',
    '#1d3ca6',
    (select id from auth.users where lower(email) = 'admin1212@debaser.site' limit 1),
    'debaser.site',
    false
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
