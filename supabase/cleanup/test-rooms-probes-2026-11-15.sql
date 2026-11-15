-- Luke's OK 2026-11-15, relayed by the main session ("Keep A's room"; delete the three ended probe rooms with their played,
-- unplayed, crown and member rows): what the ROOMS session's live probes left behind that day, all started by the hidden
-- TEST ACCOUNT A, all ended, all private, with no chat lines and no board thread:
--   e032680b-10fb-4147-8934-75b17a999f57  scripts/probe-go-live.cjs          (phase 3)
--   52b0d54f-e7db-456e-af19-c7eb46876160  scripts/probe-pictures.cjs         (phase 5)
--   ea402c51-3ffd-48cf-825a-9bcbadfd0ec4  scripts/probe-picture-removal.cjs  (phase 6)
-- A room's queue, members and crowns go with it (on delete cascade).
--
-- NOT touched, and not named here: TEST ACCOUNT A's own kept room 8853d917-ab5e-4b7d-9df2-fbb77d93fee7, its one link row,
-- and TEST ACCOUNT B's REMOVED row in it.
--
-- Listed first with test-rooms-probes-2026-11-15-review.sql (the same conditions, read-only), 2026-11-15:
--   to go: 3 rooms, 4 queue rows (3 played, 1 unplayed), 5 member rows, 2 crowns, 0 chat lines, 0 board threads;
--   before: 49 rooms, 216 queue rows, 87 member rows, 50 crowns in all.
-- Run 2026-11-15, about 17:00 UTC; the review again afterwards: 46 rooms, 212 queue rows, 82 member rows, 48 crowns
-- (3, 4, 5 and 2 fewer, as listed), nothing left to go, and the kept room, its link row and its 2 member rows still there.
-- Each id is named and the conditions repeat what was checked, so running it again deletes nothing.
-- Backup first: Documents/debaser-backups/2026-11-15-16-58.
begin;

delete from public.watch_rooms r
using public.profiles p
where p.id = r.host_id
  and p.is_hidden
  and p.display_name = 'TEST ACCOUNT A'
  and r.origin = 'stream'
  and r.ended_at is not null
  and not exists (select 1 from public.watch_messages w where w.room_id = r.id)
  and r.id in ('e032680b-10fb-4147-8934-75b17a999f57', '52b0d54f-e7db-456e-af19-c7eb46876160', 'ea402c51-3ffd-48cf-825a-9bcbadfd0ec4');

commit;
