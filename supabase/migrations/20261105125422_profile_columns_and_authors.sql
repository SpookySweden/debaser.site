-- Privacy plan, phase 0, second half (Luke's OK in chat, 2026-11-05). Goes in after the code that needs it is live.
--
--   1. Who may read which profile column. Columns are granted by name, so a column added later is readable by nobody until a
--      migration says so.
--   2. Every post, comment, tag and track names the person who made it.
--   3. A visitor with no session keeps only the functions a page calls without one.
--
-- Nothing is deleted. The old presence columns on profiles stay, unread and no longer written. Re-runnable: revoking at
-- table level clears the column grants too, and policies are dropped and recreated by name.

-- The last stamps written before the site moved to profile_presence.
insert into public.profile_presence (user_id, last_seen_at, is_online)
  select id, last_seen_at, is_online from public.profiles
  on conflict (user_id) do update
    set last_seen_at = excluded.last_seen_at, is_online = excluded.is_online
    where excluded.last_seen_at > public.profile_presence.last_seen_at;

-- 1. Profile columns --------------------------------------------------------------------------------------------------
revoke select on public.profiles from anon, authenticated;

grant select (
  id, display_name, name_colour, bio, status,
  show_tags, show_profile_comments, show_avatar_comments, show_song_comments, hide_listening,
  current_version_id, avatar_crop, avatar_crop_x, avatar_crop_y, current_song_version_id,
  created_at, banned_at
) on public.profiles to anon, authenticated;

grant select (updated_at, location, country_code) on public.profiles to authenticated;

-- 2. An author on everything ------------------------------------------------------------------------------------------
drop policy if exists "forum_threads insert own" on public.forum_threads;
create policy "forum_threads insert own" on public.forum_threads
  for insert
  with check (author_id = auth.uid() and not public.is_banned());

drop policy if exists "forum_comments insert own" on public.forum_comments;
create policy "forum_comments insert own" on public.forum_comments
  for insert
  with check (author_id = auth.uid() and not public.is_banned());

drop policy if exists "profile comments insert" on public.profile_comments;
create policy "profile comments insert" on public.profile_comments
  for insert
  with check (author_id = auth.uid() and not public.is_banned());

drop policy if exists "profile tags insert" on public.profile_tags;
create policy "profile tags insert" on public.profile_tags
  for insert
  with check (given_by = auth.uid() and not public.is_banned());

drop policy if exists "music tracks filed by uploader" on public.music_tracks;
create policy "music tracks filed by uploader" on public.music_tracks
  for insert
  with check (uploaded_by = auth.uid() and not public.is_banned());

-- 3. Functions --------------------------------------------------------------------------------------------------------
-- Kept for a visitor: is_admin, is_banned, is_comms_member, is_comms_owner (rules read by a visitor call them); watch_now,
-- watch_close_stale, music_play_counts (pages call them with no session); account_list; and the web_* functions, which the
-- hourly jobs call with the public key and their secret.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    -- Fired by the database, never called by a person.
    'claim_house_name()', 'comms_threads_guard_metadata()', 'handle_new_user()', 'music_follows_guard()',
    'music_listens_guard()', 'profile_comments_guard_pin()', 'profiles_guard_hidden()', 'room_canvas_snapshot_people()',
    'touch_music_queue()', 'touch_music_song_notes()', 'touch_updated_at()', 'watch_queue_guard()',
    'watch_rooms_crown_host()', 'watch_rooms_guard()',
    -- Only ever called with a session.
    'music_for_you(integer)', 'music_mirror()', 'record_profile_visit(uuid)',
    'room_canvas_close(uuid)', 'room_canvas_hide(uuid, boolean)', 'room_canvas_may_snapshot(uuid)',
    'room_canvas_readable(uuid)', 'room_canvas_save(uuid)', 'watch_take_over(uuid, uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;
