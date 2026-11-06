-- Two tightenings of beatbox_songs (Luke's OK 2026-11-05, "Yes, make it"). No rows change, and nothing else is touched:
--   - Banned accounts can't add or change songs, as on the site's other tables. They can still read and delete their own.
--   - The 100-song limit runs after the check that you're saving as yourself. A signed-in person trying to save as someone
--     else used to be able to tell from the error whether that person had 100 songs.
--
-- Re-runnable: policies dropped and recreated by name, `create or replace`.

drop policy if exists "owner adds their songs" on public.beatbox_songs;
create policy "owner adds their songs" on public.beatbox_songs
  for insert to authenticated with check (owner = auth.uid() and not public.is_banned());

drop policy if exists "owner changes their songs" on public.beatbox_songs;
create policy "owner changes their songs" on public.beatbox_songs
  for update to authenticated
  using (owner = auth.uid() and not public.is_banned())
  with check (owner = auth.uid() and not public.is_banned());

-- A trigger runs before the rules above, so it asks who's saving first, and everyone else gets the same refusal.
create or replace function public.beatbox_songs_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner is distinct from auth.uid() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('beatbox_songs_cap:' || new.owner::text, 0));
  if (select count(*) from public.beatbox_songs s where s.owner = new.owner) >= 100 then
    raise exception 'That is 100 saved songs, the most there is room for. Delete one first.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.beatbox_songs_cap() from public, anon, authenticated;
