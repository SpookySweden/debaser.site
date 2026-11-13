-- Every signed-in upload failed from 20261113022846_live_docs.sql (Luke's OK in chat, 2026-11-13) until this: the rule
-- "doc pictures filed by accounts" counted storage.objects from a rule on storage.objects. Postgres calls that infinite
-- recursion and refuses the whole insert, for every bucket, because all of a table's insert rules are put together before
-- any of them is decided. The same trap as 20261106023721_stream_art_upload_rule.sql, and the same fix.
--
-- The two counts move into a function, which the rule can call without reading its own table. What the rule means
-- doesn't change: the account's own folder only, at most 20 in ten minutes and 300 in all. Luke OK'd this fix in chat
-- on 2026-11-13 ("Yes, fix it now"). Nothing is deleted. Re-runnable: the function is replaced, and the policy dropped
-- and recreated by name.

create or replace function public.doc_pictures_may_file()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from storage.objects o
      where o.bucket_id = 'doc-pictures' and o.owner_id = (auth.uid())::text
        and o.created_at > now() - interval '10 minutes') < 20
    and
    (select count(*) from storage.objects o
      where o.bucket_id = 'doc-pictures' and o.owner_id = (auth.uid())::text) < 300;
$$;
revoke all on function public.doc_pictures_may_file() from public, anon;
grant execute on function public.doc_pictures_may_file() to authenticated, service_role;

drop policy if exists "doc pictures filed by accounts" on storage.objects;
create policy "doc pictures filed by accounts" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'doc-pictures'
    and not public.is_guest()
    and not public.is_banned()
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.doc_pictures_may_file()
  );
