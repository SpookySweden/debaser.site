-- The welcome tag, and the house account's Royal Blue
--
-- Paste this whole file into the Supabase SQL editor and run it. It is idempotent: running it twice
-- changes nothing the second time. Nothing here drops or overwrites anybody's data.
--
-- What it does:
--   1. every new account is given one approved tag, `NEW HERE`, from the house account, so a fresh
--      profile is not an empty tag heading;
--   2. accounts that already exist and have no tags get the same tag;
--   3. the house account's seed colour moves off `#000080` onto the swatch's Royal Blue `#1d3ca6`.
--
-- This keeps the database in step with app/lib/profile/visibility.ts (`defaultProfileTag`) and
-- app/globals.css (the eight-dye swatch), which is the whole point: the mock store and Supabase
-- file the *same* row, and the two would otherwise open differently.

-- ---------------------------------------------------------------------------
-- 1. The signup trigger: seed the profile in Royal Blue, and file the tag
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  chosen_name text;
  is_house boolean;
begin
  is_house := lower(coalesce(new.email, '')) = 'admin1212@debaser.site';

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

  -- The welcome tag. Its id is derived from the profile it belongs to, which is what makes the
  -- insert idempotent: running this script again cannot file a second welcome.
  --
  -- The giver is looked up rather than assumed, because this trigger also fires for the house
  -- account itself and the two accounts can be created in either order. `given_by` is nullable, so
  -- a missing house account leaves a null giver - which the app still reads as an approved tag,
  -- because what makes a tag pending is the *owner* having given it to themselves.
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

-- Re-create the trigger so the new function body is the one that runs (create or replace on the
-- function is enough in Postgres, but this makes the intent explicit and is safe to re-run).
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 2. Accounts that predate the tag: give it to any profile with no tags at all
-- ---------------------------------------------------------------------------
-- Scoped to tagless profiles, so it can never land on somebody who has been using the tag list -
-- and matching on the derived id, so it cannot duplicate a welcome that is already there.

insert into public.profile_tags (id, user_id, label, colour, given_by, given_by_label, hidden)
select
  md5('tag-default-new-here:' || p.id::text)::uuid,
  p.id,
  'NEW HERE',
  '#1d3ca6',
  (select id from auth.users where lower(email) = 'admin1212@debaser.site' limit 1),
  'debaser.site',
  false
from public.profiles p
where not exists (select 1 from public.profile_tags t where t.user_id = p.id)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. The house account: off `#000080`, onto the swatch's Royal Blue
-- ---------------------------------------------------------------------------
-- Only fills in what is still the old seed, so re-running never undoes a colour the owner has since
-- chosen by hand in the customiser.

update public.profiles
set name_colour = '#1d3ca6',
    updated_at = now()
where id in (select id from auth.users where lower(email) = 'admin1212@debaser.site')
  and name_colour = '#000080';

-- The same, for an account that arrived with a name already (a Google sign-in) and never got one.
update public.profiles
set name_colour = '#1d3ca6',
    updated_at = now()
where id in (select id from auth.users where lower(email) = 'admin1212@debaser.site')
  and name_colour is null
  and display_name = 'debaser.site';

-- ---------------------------------------------------------------------------
-- Done. To check it landed:
--   select p.display_name, t.label, t.hidden
--     from public.profiles p
--     left join public.profile_tags t on t.user_id = p.id
--    order by p.display_name;
-- ---------------------------------------------------------------------------
