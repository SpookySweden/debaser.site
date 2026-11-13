-- A fix to 20261113022903_profile_characters.sql, the same day, keeping exactly what Luke OK'd for the picture folder (PNG only,
-- 512 KB each, 4 per person, one every 5 seconds, each in its owner's own folder).
--
-- Its upload rule counted the folder's pictures by reading storage.objects from a rule on storage.objects. Postgres calls that
-- infinite recursion and refuses the whole insert, for every bucket, because all of a table's insert rules are put together
-- before any is decided: every signed-in upload on the site failed ("The database schema is invalid or incompatible"). The
-- same trap as stream art's on 2026-11-06 (20261106023721_stream_art_upload_rule.sql), fixed the same way: the counting moves
-- into a function the rule calls, which reads the table without the rule being read again. What the rule means doesn't change.
--
-- Nothing is deleted. Re-runnable: the function is replaced and the policy dropped and recreated by name.

create or replace function public.profile_character_strip_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from storage.objects o
      where o.bucket_id = 'profile-characters' and (storage.foldername(o.name))[1] = (auth.uid())::text) < 4
    and not exists (
      select 1 from storage.objects o
       where o.bucket_id = 'profile-characters' and o.owner_id = (auth.uid())::text and o.created_at > now() - interval '5 seconds'
    );
$$;
revoke all on function public.profile_character_strip_allowed() from public, anon;
grant execute on function public.profile_character_strip_allowed() to authenticated, service_role;

drop policy if exists "profile character strips added by their owner" on storage.objects;
create policy "profile character strips added by their owner" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'profile-characters'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not (select public.is_guest())
    and public.profile_character_strip_allowed()
  );
