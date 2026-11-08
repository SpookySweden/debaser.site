-- WAITING FOR LUKE'S OK. Not run. The ended rooms and their board threads left on 2026-11-08 by the stream-room work, all hosted by the
-- kept TEST ACCOUNT A:
--   * the live three-browser sync drive (Temp/sync-drive.cjs: A hosts, B and C follow; YouTube and an Internet Archive file), one room
--     and one thread per run;
--   * the live check Temp/check-private-streams.cjs, run by `npm run checks:changed`, one open room per run with no thread and its own
--     three test lines ("said while private", a test word, "said while open").
-- Listed and checked first (read-only, 2026-11-08): every room is ended; the drive rooms have no chat lines and their threads no
-- comments; the members (2 or 3 each) are the kept test accounts. Deleting a room takes its queue rows, chat lines, members, crowns and
-- canvas with it (on delete cascade). Each id is named and the conditions repeat what was checked, so running it again deletes nothing.
--
-- Before running: `npm run db:backup`, then the two selects below from this file (`npm run db -- --file ...`), and read the counts.
--   select count(*) from public.watch_rooms where id in (<the room ids below>);     -- expect 25
--   select count(*) from public.forum_threads where id in (<the thread ids below>); -- expect 20
begin;

delete from public.watch_rooms r
using public.profiles p
where p.id = r.host_id
  and p.is_hidden
  and p.display_name = 'TEST ACCOUNT A'
  and r.ended_at is not null
  and r.started_at >= '2026-11-08'
  and r.id in (
    'fceb4f8e-29e3-49e8-8d40-9de7964455e8', '98e71d22-43f8-4b38-94d9-a7da9b3dfa99', '85a29157-e293-4b13-93f6-774e396ee2c7',
    'b1aa5298-e94e-407d-aef3-e159ec701461', '74183be8-3c78-4f56-9b2d-b855f67a7a26', 'f3c0a7b9-e14e-4af3-9670-1240d9041564',
    '602a14a5-6f1c-41a1-a533-a2e03fe9aaf5', '4f043b9c-da4e-4530-8397-0092e4d66be1', '44e2a92e-7d82-4b6e-8987-e2dea56cf18e',
    '2c3add4c-7f48-44b1-a802-317bd77f3aa9', '7c40ba70-0baf-4319-b476-efe57176da0f', '129ce541-39ca-4ff4-9e10-ca73aa362cdc',
    '4e08dfcb-b3e0-4005-afd5-79edc9238f38', '1be16e11-29b7-47fa-b914-9bd416ad80f2', '4b2e0634-b172-407e-bf2d-632b2ecf0087',
    '1503666c-9095-4f0a-ada8-ee9ff5689001', '2835dcc2-9e1f-453e-9a3f-c95e6eb35614', '8a3c9a8c-4f07-4aff-b466-0858d8318b12',
    '7e5a75fc-35a0-4de5-8c4b-82dbb5062676', '46b420b6-834a-4586-892b-38971595de31',
    -- check-private-streams' rooms (no thread):
    '19381b6f-c9b0-4ddd-bf9d-e10ee1f84336', '303aa40a-5391-42d8-87e1-1c427ea0e9ef', '1a23981d-7ffb-475f-bdb2-d0bad83f31ca',
    '0e82bc36-d8a3-4c9e-8402-144c1bf2159f', 'bf2222d6-dbc9-4cbd-ba5c-3b255661dafb'
  );

delete from public.forum_threads t
using public.profiles p
where p.id = t.author_id
  and p.is_hidden
  and p.display_name = 'TEST ACCOUNT A'
  and t.title like 'STREAM :: TEST ACCOUNT A :: 2026-11-08%'
  and t.id in (
    '584a84a5-4239-4959-a4da-5654d0a04f8e', '21ff7f7a-85ed-4c1d-a11c-d8e182753c84', 'a9228f8f-89d3-434e-b7ea-07416f48568e',
    'f061a876-f2fb-4644-99df-e33c5c9232ff', '1f70fc13-223a-4977-827a-a1c9a3fbcffb', 'e9e5de60-4b00-41cd-82dc-5c4d608dba97',
    '0901251e-2202-4824-9c22-b6b84469ed51', '60961542-73b5-44d2-841d-60dcc72f3127', '7d62945e-38e6-41c4-b5d7-0997fa9a8dc6',
    '907a2d2a-ec73-4054-ba99-f66faa33a6a6', '7c2f894d-6cef-4d91-ac69-aa673eff8ad2', '3a38acff-3739-4d01-ac87-8515721d2fbe',
    'f184fb61-65c5-4851-aaf9-2e16dfba4fcc', '2d2fe614-3eff-4b1d-9827-cd99b2072b27', '59391729-2414-4886-8287-a7ad04a36b1e',
    '848bf2d3-47e7-4f96-a4f9-8520248b5472', 'fafe511f-ca0e-4c08-bd96-d2f7df95f8a1', '2035cc06-33c9-4a7c-b77e-c169aebc8dec',
    '86e0fbd0-49e9-4ecd-b687-4efc63a8cb72', 'b436dc7c-5672-49fd-ada1-85aa0bf2c5dd'
  )
  and not exists (select 1 from public.forum_comments c where c.thread_id = t.id)
  and not exists (select 1 from public.forum_pins n where n.thread_id = t.id);

commit;
