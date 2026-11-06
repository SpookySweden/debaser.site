-- After every account was deleted by mistake on 2026-11-06 (supabase/cleanup/test-guests-2026-11-06.sql, run cut short), with Luke's OK.
-- Three things. The house account can't be taken by whoever signs up with its public address. Somebody signing up again with their old
-- address gets their details back and their old posts relinked by the name written on them. The kept test accounts are hidden again.
-- account_restores holds addresses, so no policy lets anybody read it, and its rows are never in this public repository.

create table if not exists public.house_account (
  id uuid primary key references auth.users (id) on delete cascade,
  set_at timestamptz not null default now()
);
alter table public.house_account enable row level security;
revoke all on public.house_account from anon, authenticated;

create table if not exists public.house_account_gate (open_until timestamptz not null);
alter table public.house_account_gate enable row level security;
revoke all on public.house_account_gate from anon, authenticated;

create table if not exists public.account_restores (
  email text primary key check (email = lower(email)),
  display_name text not null,
  name_colour text,
  country_code text,
  avatar_src text,
  song_src text,
  song_title text,
  song_credit text,
  claimed_by uuid references auth.users (id) on delete set null,
  claimed_at timestamptz
);
alter table public.account_restores enable row level security;
revoke all on public.account_restores from anon, authenticated;

-- Admin needs both the address and the row, so a sign-up with the address alone is nobody.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'auth'
as $$
  select exists (
    select 1 from auth.users u
    join public.house_account h on h.id = u.id
    where u.id = auth.uid() and lower(u.email) = 'admin1212@debaser.site'
  );
$$;

create or replace function public.restore_lost_account(person uuid, mail text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.account_restores%rowtype;
  version_id uuid;
begin
  select * into r from public.account_restores a where a.email = lower(coalesce(mail, '')) and a.claimed_by is null for update;
  if not found then return false; end if;

  update public.profiles p
  set display_name = r.display_name,
      name_colour = coalesce(r.name_colour, p.name_colour),
      country_code = coalesce(r.country_code, p.country_code)
  where p.id = person;

  if r.avatar_src is not null then
    insert into public.profile_avatar_versions (user_id, version, src, note)
    values (person, 1, r.avatar_src, 'Restored after the accounts were lost')
    returning id into version_id;
    update public.profiles p set current_version_id = version_id where p.id = person;
  end if;

  if r.song_src is not null then
    insert into public.profile_song_versions (user_id, version, src, title, credit, note)
    values (person, 1, r.song_src, r.song_title, r.song_credit, 'Restored after the accounts were lost')
    returning id into version_id;
    update public.profiles p set current_song_version_id = version_id where p.id = person;
  end if;

  -- Their old posts kept the name they were written under, and nothing else: that name is how they come home.
  update public.forum_threads t set author_id = person where t.author_id is null and t.author_label = r.display_name;
  update public.forum_comments c set author_id = person where c.author_id is null and c.author_label = r.display_name;
  update public.profile_comments c set author_id = person where c.author_id is null and c.author_label = r.display_name;
  update public.music_tracks m set uploaded_by = person where m.uploaded_by is null and m.uploaded_by_label = r.display_name;
  update public.media_items m set uploaded_by = person where m.uploaded_by is null and m.uploaded_by_label = r.display_name;
  update public.music_folders f set created_by = person where f.created_by is null and f.created_by_label = r.display_name;
  update public.forum_pins f set pinned_by = person where f.pinned_by is null and f.pinned_by_label = r.display_name;

  update public.account_restores a set claimed_by = person, claimed_at = now() where a.email = r.email;
  return true;
end;
$$;
revoke all on function public.restore_lost_account(uuid, text) from public, anon, authenticated;

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
    insert into public.profiles (id, display_name, is_hidden)
    values (new.id, 'GUEST-' || upper(substr(md5(new.id::text), 1, 3)), true)
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

create or replace function public.guest_set_name(wanted text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  clean text := btrim(regexp_replace(coalesce(wanted, ''), '\s+', ' ', 'g'));
  key text;
  shown text;
begin
  if caller is null or not public.is_guest() or public.is_banned() then return 'refused'; end if;
  if exists (select 1 from public.profiles p where p.id = caller and p.display_name like '% [GUEST]') then return 'refused'; end if;

  if clean !~ '^[A-Za-z0-9_-][A-Za-z0-9 _-]{0,18}[A-Za-z0-9_-]$' then return 'bad'; end if;
  key := public.guest_name_key(clean);
  -- `key` has its lookalikes made one already, so admin reads admln here.
  if length(key) < 2 or key ~ '^(guest|anon)' or key ~ '(admln|debaser)' or key in ('formerguest', 'host', 'mod', 'moderator', 'staff', 'owner', 'system', 'unknown') then
    return 'bad';
  end if;

  -- Two guests asking for one name at once take turns.
  perform pg_advisory_xact_lock(hashtextextended('guest-name:' || key, 0));
  if exists (
    select 1 from public.profiles p
    where public.guest_name_key(p.display_name) in (key, key || 'guest')
  ) or exists (
    select 1 from public.account_restores r
    where r.claimed_by is null and public.guest_name_key(r.display_name) in (key, key || 'guest')
  ) then
    return 'taken';
  end if;

  shown := clean || ' [GUEST]';
  update public.profiles p set display_name = shown where p.id = caller;
  update public.watch_members m set label = shown where m.user_id = caller;
  return 'named';
end;
$$;
revoke all on function public.guest_set_name(text) from public, anon;

-- TEST ACCOUNT A and B, remade by a test's sign-in on 2026-11-06, and C and D whenever they return.
update public.profiles p set is_hidden = true
from auth.users u
where u.id = p.id and lower(u.email) ~ '^test-[a-d]@debaser\.site$';
