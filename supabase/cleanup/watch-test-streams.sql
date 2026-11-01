-- -----------------------------------------------------------------------------
-- The watch-together drives' test streams, listed, then removed (2026-10-27)
-- -----------------------------------------------------------------------------
-- Every run of Temp/watch-drive.cjs (TEST ACCOUNT A + B) leaves one room, its queue rows, its chat lines
-- and one board thread `STREAM :: TEST ACCOUNT A :: <date>`. Only rooms started by a hidden test account
-- are touched (`profiles.is_hidden`); a real account's stream is never matched.
--
-- Run the LIST first (`npm run db -- "<the select>"`), check the survivors, and only with Luke's OK run
-- the REMOVE (`npm run db -- --write "<the delete>"`). Deleting the threads leaves the rooms pointing at
-- nothing (`on delete set null`); deleting the rooms takes their queue rows and chat lines with them
-- (`on delete cascade`). `:keep` is a room id to leave standing as an example, or '' for none.

-- LIST
select r.id as room, r.started_at, r.ended_at, r.forum_thread_id, t.title,
       (select count(*) from public.forum_comments c where c.thread_id = t.id) as replies,
       (select count(*) from public.watch_queue q where q.room_id = r.id) as plays,
       (select count(*) from public.watch_messages m where m.room_id = r.id) as lines
  from public.watch_rooms r
  left join public.forum_threads t on t.id = r.forum_thread_id
 where r.original_host_id in (select id from public.profiles where is_hidden)
 order by r.started_at;

-- REMOVE (threads first, then the rooms)
-- delete from public.forum_threads
--  where id in (select forum_thread_id from public.watch_rooms
--                where original_host_id in (select id from public.profiles where is_hidden)
--                  and id::text <> :keep);
-- delete from public.watch_rooms
--  where original_host_id in (select id from public.profiles where is_hidden)
--    and id::text <> :keep;

-- AFTERWARDS: the survivors
-- select count(*) from public.watch_rooms;
-- select count(*) from public.forum_threads where anchor_id like 'watch:%';
