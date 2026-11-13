-- Characters living on profiles (Luke, 2026-11-13; SPEC-profile-characters.md). Luke's typed OK, relayed by the main session:
-- "Yes, make it", for exactly this.
--
-- What this adds, and nothing else. No existing table, rule or row is altered:
--   - profile_characters: one row per person, the saved character they show on their profile, its mood, and where its baked
--     picture strip is with the short list of frames in it. Anyone reads it, signed out too: it holds no name, address or
--     figure. Only the owner adds, changes or removes their own row; stream guests can't.
--   - the `profile-characters` picture folder: the baked strips, PNG only, at most 512 KB each and 4 per person, each in its
--     owner's own folder, one every 5 seconds at most. Anyone views them; only the owner adds or removes their own. Nothing
--     replaces one in place.
--
-- Why not a SHOWN mark on user_characters, as the spec first said: that table keeps each owner's email address beside the
-- figure, and a rule letting anyone read a row hands out every column of it. So the figures stay readable by their owner
-- only, and a visitor sees pictures, never a figure.
--
-- Re-runnable: `if not exists`, triggers and policies dropped and recreated by name, grants revoked before given.

create table if not exists public.profile_characters (
  person uuid primary key default auth.uid(),
  character_id text not null check (length(character_id) between 1 and 80),
  mood text not null default 'calm' check (mood in ('calm', 'busy', 'party')),
  strip text not null check (length(strip) between 1 and 200),
  sheet jsonb not null check (jsonb_typeof(sheet) = 'object' and pg_column_size(sheet) < 16384),
  baked_at timestamptz not null default now()
);

-- The shown character has to be one of the person's own saved ones, not removed, and its strip has to be in their own folder.
create or replace function public.profile_characters_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.user_characters c
     where c.person = new.person and c.id = new.character_id and c.deleted_at is null
  ) then
    raise exception 'not one of your saved characters';
  end if;
  if new.strip not like new.person::text || '/%' then
    raise exception 'the strip is not in your own folder';
  end if;
  new.baked_at := now();
  return new;
end;
$$;
revoke all on function public.profile_characters_guard() from public, anon, authenticated;

drop trigger if exists profile_characters_guard on public.profile_characters;
create trigger profile_characters_guard before insert or update on public.profile_characters
  for each row execute function public.profile_characters_guard();

alter table public.profile_characters enable row level security;

drop policy if exists "profile characters readable" on public.profile_characters;
create policy "profile characters readable" on public.profile_characters
  for select to anon, authenticated using (true);

drop policy if exists "own profile character addable" on public.profile_characters;
create policy "own profile character addable" on public.profile_characters
  for insert to authenticated with check (person = (select auth.uid()) and not (select public.is_guest()));

drop policy if exists "own profile character changeable" on public.profile_characters;
create policy "own profile character changeable" on public.profile_characters
  for update to authenticated
  using (person = (select auth.uid()) and not (select public.is_guest()))
  with check (person = (select auth.uid()) and not (select public.is_guest()));

drop policy if exists "own profile character removable" on public.profile_characters;
create policy "own profile character removable" on public.profile_characters
  for delete to authenticated using (person = (select auth.uid()) and not (select public.is_guest()));

revoke all on public.profile_characters from public, anon, authenticated;
grant select on public.profile_characters to anon;
grant select, insert, update, delete on public.profile_characters to authenticated;

-- The baked strips.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-characters', 'profile-characters', true, 524288, array['image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profile character strips readable" on storage.objects;
create policy "profile character strips readable" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'profile-characters');

-- Into the owner's own folder, while they hold fewer than 4.
drop policy if exists "profile character strips added by their owner" on storage.objects;
create policy "profile character strips added by their owner" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'profile-characters'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not (select public.is_guest())
    and (
      select count(*) from storage.objects o
       where o.bucket_id = 'profile-characters' and (storage.foldername(o.name))[1] = (select auth.uid())::text
    ) < 4
    -- The rate limit: one strip every 5 seconds.
    and not exists (
      select 1 from storage.objects o
       where o.bucket_id = 'profile-characters' and o.owner_id = (select auth.uid())::text and o.created_at > now() - interval '5 seconds'
    )
  );

drop policy if exists "profile character strips removed by their owner" on storage.objects;
create policy "profile character strips removed by their owner" on storage.objects
  for delete to authenticated
  using (bucket_id = 'profile-characters' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- To check after the push:
--   select tablename, policyname from pg_policies where tablename = 'profile_characters' order by 2;
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'profile-characters';
