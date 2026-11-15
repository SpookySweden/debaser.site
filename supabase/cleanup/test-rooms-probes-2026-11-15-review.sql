-- Read-only. The review for test-rooms-probes-2026-11-15.sql: what that file would delete, by the same conditions, and the
-- totals before and after. Run it before the delete and read the counts; run it again afterwards.
--
-- The three rooms are what the ROOMS session's live probes left behind on 2026-11-15 (scripts/probe-go-live.cjs,
-- scripts/probe-pictures.cjs, scripts/probe-picture-removal.cjs): each an ended, private stream room started by the hidden
-- TEST ACCOUNT A, with no chat lines. TEST ACCOUNT A's own kept room (8853d917-ab5e-4b7d-9df2-fbb77d93fee7), its link row
-- and TEST ACCOUNT B's REMOVED row in it are NOT named here and stay (Luke, 2026-11-15: "Keep A's room").
with named as (
  select r.id
  from public.watch_rooms r
  join public.profiles p on p.id = r.host_id
  where p.is_hidden
    and p.display_name = 'TEST ACCOUNT A'
    and r.origin = 'stream'
    and r.ended_at is not null
    and not exists (select 1 from public.watch_messages w where w.room_id = r.id)
    and r.id in ('e032680b-10fb-4147-8934-75b17a999f57', '52b0d54f-e7db-456e-af19-c7eb46876160', 'ea402c51-3ffd-48cf-825a-9bcbadfd0ec4')
)
select
  (select count(*) from named) as rooms_to_go,
  (select count(*) from public.watch_queue q where q.room_id in (select id from named)) as queue_rows_to_go,
  (select count(*) from public.watch_queue q where q.room_id in (select id from named) and q.played_at is not null) as played_rows_to_go,
  (select count(*) from public.watch_members m where m.room_id in (select id from named)) as member_rows_to_go,
  (select count(*) from public.watch_crowns c where c.room_id in (select id from named)) as crown_rows_to_go,
  (select count(*) from public.watch_messages w where w.room_id in (select id from named)) as chat_lines_to_go,
  (select count(*) from public.forum_threads t where t.id in (select r.forum_thread_id from public.watch_rooms r where r.id in (select id from named))) as board_threads_of_theirs,
  (select count(*) from public.watch_rooms) as rooms_in_all,
  (select count(*) from public.watch_queue) as queue_rows_in_all,
  (select count(*) from public.watch_members) as member_rows_in_all,
  (select count(*) from public.watch_crowns) as crown_rows_in_all,
  (select count(*) from public.watch_rooms r where r.id = '8853d917-ab5e-4b7d-9df2-fbb77d93fee7') as kept_own_room,
  (select count(*) from public.watch_room_links l where l.room_id = '8853d917-ab5e-4b7d-9df2-fbb77d93fee7') as kept_link_rows,
  (select count(*) from public.watch_members m where m.room_id = '8853d917-ab5e-4b7d-9df2-fbb77d93fee7') as kept_member_rows;
