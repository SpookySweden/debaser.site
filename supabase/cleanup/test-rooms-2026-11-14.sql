-- Luke's OK 2026-11-14 ("Yes, delete them"): two ended test stream rooms and their board threads, all by the hidden TEST ACCOUNT A,
-- no chat lines, no comments: "COMPANION ROOM DRIVE" (the companion session's look at windows hiding companions) and "ROOM TEST"
-- (the main session's two-account room test). A room's queue, members, crowns and canvas go with it (on delete cascade).
-- Listed first (read-only select, 2 rooms + 2 threads). Each id is named and the conditions repeat what was checked, so running it
-- again deletes nothing. Backup: Documents/debaser-backups/2026-11-14-02-07.
begin;

delete from public.watch_rooms r
using public.profiles p
where p.id = r.host_id
  and p.is_hidden
  and p.display_name = 'TEST ACCOUNT A'
  and r.ended_at is not null
  and not exists (select 1 from public.watch_messages w where w.room_id = r.id)
  and r.id in ('ec8d3c95-05ad-41a1-bace-7951f7874ed1', '46b58c54-0c8f-4497-b8eb-8d0ffceb0907');

delete from public.forum_threads t
using public.profiles p
where p.id = t.author_id
  and p.is_hidden
  and p.display_name = 'TEST ACCOUNT A'
  and t.title like 'STREAM :: TEST ACCOUNT A :: 2026-11-1%'
  and t.id in ('e0239037-ffe6-4c1d-9d31-db2b635a4a4a', '0fbc9b03-28cd-40cb-9aec-3429758b3776')
  and not exists (select 1 from public.forum_comments c where c.thread_id = t.id)
  and not exists (select 1 from public.forum_pins n where n.thread_id = t.id);

commit;
