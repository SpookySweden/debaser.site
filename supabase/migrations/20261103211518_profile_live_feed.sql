-- The profile live feed: tags, picture versions and track versions send live changes.
--
-- Why (2026-11-03): every page opens one Realtime channel for profiles ('profile-directory', in
-- app/lib/profile/supabase-profile-repository.ts) that listens to profiles, profile_avatar_versions,
-- profile_tags and profile_comments. Two of those were never in the publication, and Realtime refuses
-- the whole channel when any one table is missing ("Unable to subscribe to changes with given
-- parameters ... table: profile_tags"), so nothing on it arrived - not even the comments, which are
-- published. A visitor had to reload to see a new comment, tag, picture or track. profile_song_versions
-- is added too, because the channel now listens to it.
--
-- Nothing is read that was not readable before: Realtime sends each person only the rows their read
-- policy already allows (hidden tags stay with their owner and giver). Re-runnable. To undo:
--   alter publication supabase_realtime drop table public.profile_tags, public.profile_avatar_versions, public.profile_song_versions;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'profile_tags') then
    alter publication supabase_realtime add table public.profile_tags;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'profile_avatar_versions') then
    alter publication supabase_realtime add table public.profile_avatar_versions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'profile_song_versions') then
    alter publication supabase_realtime add table public.profile_song_versions;
  end if;
end $$;

-- Afterwards, to see it landed:
--   select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'profile%' order by 1;
