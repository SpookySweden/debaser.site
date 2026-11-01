-- VANITY step 6 (SPEC-vanity.md): MIRROR, the uploader's own view of who plays their songs.
--
-- `music_mirror()` answers only for the person asking, and only about files they filed: a file is theirs
-- when its storage address carries their account id (the same rule `uploaderIdFromSrc` uses in the
-- app). For each such file, each listener and their plays, capped at 3 a day per song like every
-- other count. Hidden (test) accounts are left out entirely. People who switched their listening off,
-- and the uploader's own plays, still count in the numbers but come back with no listener id, so no
-- face can be shown for them.
--
-- No new table: it reads `music_listens`. Re-runnable: `create or replace`.

create or replace function public.music_mirror()
returns table (track_src text, listener_id uuid, plays bigint)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select l.track_src, l.user_id, (l.listened_at at time zone 'utc')::date as day
    from public.music_listens l
    join public.profiles pr on pr.id = l.user_id
    where auth.uid() is not null
      and not pr.is_hidden
      and lower(substring(l.track_src from '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')) = auth.uid()::text
  ),
  capped as (
    select m.track_src, m.user_id, least(count(*), 3) as n
    from mine m
    group by m.track_src, m.user_id, m.day
  )
  select c.track_src,
         case when c.user_id = auth.uid() or pr.hide_listening then null else c.user_id end as listener_id,
         sum(c.n)::bigint as plays
  from capped c
  join public.profiles pr on pr.id = c.user_id
  group by c.track_src, 2
  order by plays desc;
$$;

revoke all on function public.music_mirror() from public;
grant execute on function public.music_mirror() to authenticated;
