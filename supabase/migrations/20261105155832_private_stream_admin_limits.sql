-- Privacy plan, phase 3, the review's follow-up (Luke's OK in chat, 2026-11-05). No rows change and nothing is deleted.
--
--   1. Decision 8, stated: the house account's moderation of threads and replies stops at what was made in the open. It already did, through the read
--      rules; now it holds on purpose.
--   2. Pins are public, so only a thread made in the open can be pinned.
--   3. A record whose room no longer exists stays its author's to read and delete. Somebody removed from a room that still exists gets nothing from this.
--
-- Re-runnable: policies dropped and recreated by name.

-- 1. Moderation.
drop policy if exists "forum_threads moderate" on public.forum_threads;
create policy "forum_threads moderate" on public.forum_threads
  for update
  using (public.is_admin() and privacy_at_write = 'open')
  with check (public.is_admin() and privacy_at_write = 'open');

drop policy if exists "forum_threads remove" on public.forum_threads;
create policy "forum_threads remove" on public.forum_threads
  for delete
  using (public.is_admin() and privacy_at_write = 'open');

drop policy if exists "forum_comments moderate" on public.forum_comments;
create policy "forum_comments moderate" on public.forum_comments
  for update
  using (public.is_admin() and privacy_at_write = 'open')
  with check (public.is_admin() and privacy_at_write = 'open');

drop policy if exists "forum_comments remove" on public.forum_comments;
create policy "forum_comments remove" on public.forum_comments
  for delete
  using (public.is_admin() and privacy_at_write = 'open');

-- 2. Pins.
drop policy if exists "forum_pins pinned by admin" on public.forum_pins;
create policy "forum_pins pinned by admin" on public.forum_pins
  for insert
  with check (
    public.is_admin() and pinned_by = auth.uid()
    and exists (select 1 from public.forum_threads t where t.id = forum_pins.thread_id and t.privacy_at_write = 'open')
  );

drop policy if exists "forum_pins changed by admin" on public.forum_pins;
create policy "forum_pins changed by admin" on public.forum_pins
  for update
  using (public.is_admin())
  with check (
    public.is_admin() and pinned_by = auth.uid()
    and exists (select 1 from public.forum_threads t where t.id = forum_pins.thread_id and t.privacy_at_write = 'open')
  );

-- 3. A stranded record: private, and tied to no room any more, which only a deleted room can cause.
drop policy if exists "forum_threads readable" on public.forum_threads;
create policy "forum_threads readable" on public.forum_threads
  for select
  using (
    (author_id is null or not public.is_banned(author_id) or public.is_admin())
    and (
      privacy_at_write = 'open'
      or public.is_room_member(watch_room_id)
      or (watch_room_id is null and author_id = auth.uid())
    )
  );
