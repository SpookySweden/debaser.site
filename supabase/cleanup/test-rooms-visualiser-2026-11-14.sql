-- Luke's OK 2026-11-14 ("Yes, delete them"): what the PLAYER session's visualiser drives (scripts/drive-visualiser.cjs) left behind,
-- all by the hidden TEST ACCOUNT A, with no chat lines, no comments and no pins:
--   4 ended private stream rooms from the drives on the live site, each with the one test song in its queue;
--   12 board threads titled "STREAM :: TEST ACCOUNT A :: 2026-11-14": 4 from those rooms, and 8 from drives on a dev server, where the
--   room is a mock but GO LIVE still posts its thread on the real board.
-- A room's queue, members, crowns and canvas go with it (on delete cascade). The 13 other threads of that title made the same day by
-- other sessions' tests are not named here and stay.
-- Listed first (read-only select with these same conditions: 4 rooms + 12 threads; 49 rooms and 80 threads before). Each id is named
-- and the conditions repeat what was checked, so running it again deletes nothing. Backup first: Documents/debaser-backups.
begin;

delete from public.watch_rooms r
using public.profiles p
where p.id = r.host_id
  and p.is_hidden
  and p.display_name = 'TEST ACCOUNT A'
  and r.ended_at is not null
  and not exists (select 1 from public.watch_messages w where w.room_id = r.id)
  and r.id in ('f35b5f7e-fdf2-439b-8101-d5a3b1e32491', 'f261966d-80e0-4eb6-8662-8446e8479023', 'd2193831-5641-4c5d-9108-ab081a82cc39', 'a4dc8f7d-1b5c-439e-9303-d12007fd47d9');

delete from public.forum_threads t
using public.profiles p
where p.id = t.author_id
  and p.is_hidden
  and p.display_name = 'TEST ACCOUNT A'
  and t.title = 'STREAM :: TEST ACCOUNT A :: 2026-11-14'
  and t.id in (
    '2d198f8e-b78d-465d-9b2c-839dcd600be1', '16d6c422-4319-404f-9e24-7163a67a1ffd', '14635886-6f13-499b-b49f-3792870badd6',
    '85a1444c-8364-45db-842f-3241566cd174', '13073333-0e6e-4696-b8d1-03e39d02104d', '38a67727-291b-4f5f-800b-ca58f4fcf119',
    '4304442e-809f-400d-82a7-fd150c37bdef', '3d04ccd7-c195-4016-8802-98d7ce149a43', '39dc4acd-4eb4-45d0-8a2c-cd5c67b52ba0',
    '40fc8a1a-1820-4fb3-9ec7-bbd40a24ea14', 'c86f18e7-cc7a-4a8a-a66b-86912199a1b4', 'b4cd755f-3388-4030-841f-7cbf03019910')
  and not exists (select 1 from public.forum_comments c where c.thread_id = t.id)
  and not exists (select 1 from public.forum_pins n where n.thread_id = t.id);

commit;
