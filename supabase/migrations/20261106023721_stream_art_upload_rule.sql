-- Every signed-in upload has failed since 20261103205948_stream-art-safety.sql (Luke's OK in chat, 2026-11-06): the stream art rule's ten-second limit read
-- storage.objects from a rule on storage.objects. Postgres calls that infinite recursion and refuses the whole insert, for every bucket, because all of a
-- table's insert rules are put together before any of them is decided.
--
-- The limit moves into a function, which the rule can call without reading its own table. What the rule means doesn't change.
-- Nothing is deleted. Re-runnable: the function is replaced and the policy dropped and recreated by name.

create or replace function public.stream_art_filed_just_now()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from storage.objects o
    where o.bucket_id = 'stream-art'
      and o.owner_id = (auth.uid())::text
      and o.created_at > now() - interval '10 seconds'
  );
$$;
revoke all on function public.stream_art_filed_just_now() from public, anon;
grant execute on function public.stream_art_filed_just_now() to authenticated, service_role;

drop policy if exists "stream art filed for a saved canvas" on storage.objects;
create policy "stream art filed for a saved canvas" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'stream-art'
    and not public.is_banned()
    and exists (
      select 1 from public.room_canvases c join public.watch_rooms r on r.id = c.room_id
      where c.id::text = (storage.foldername(objects.name))[1]
        and c.saved_at is not null and c.closed_at is null and r.ended_at is null
        and public.room_canvas_may_snapshot(c.id)
    )
    and not public.stream_art_filed_just_now()
  );
