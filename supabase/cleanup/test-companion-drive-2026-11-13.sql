-- Luke's OK 2026-11-13 ("Yes, clear them"): what scripts/drive-companion.cjs left on the live database, all by the kept test accounts.
--   * 10 comms messages TEST ACCOUNT B -> TEST ACCOUNT A, body "companion drive: a test message, to be deleted";
--   * 7 stream rooms hosted by TEST ACCOUNT A, all ended, no chat lines, 1-2 members (the test accounts); a room's queue, members,
--     crowns and canvas go with it (on delete cascade);
--   * their 7 board threads "STREAM :: TEST ACCOUNT A :: 2026-11-13", no comments, no pins.
-- Listed first with Temp/companion-cleanup-select.sql (read-only). Each id is named and the conditions repeat what was checked, so
-- running it again deletes nothing. Backup: Documents/debaser-backups/2026-11-13-15-01.
begin;

delete from public.comms_messages m
using public.profiles p
where p.id = m.author_id
  and p.is_hidden
  and p.display_name = 'TEST ACCOUNT B'
  and m.body = 'companion drive: a test message, to be deleted'
  and m.id in (
    '94f1457f-b10b-44e8-858b-1ab4ac882355', 'c67bf195-7f50-4762-8f44-9ff08ad30c2c', 'af2ff0c2-937c-449e-9f2c-7eb3d2e63f35',
    '4a960bae-ef20-4024-9014-ecce59ff7c88', '565b0367-234c-4757-9f7b-956c6567da58', '83276e72-e912-4290-a0e6-cf190eed77db',
    '5c8d3edf-745a-4648-ac66-dd329c780986', 'c0ef7c64-f5fa-4265-815d-7449ed86cb46', '64b69ab5-5e76-463b-aba2-c11e84653653',
    '585cad25-bd6e-48fc-91ca-cfbcfe7437d6'
  );

delete from public.watch_rooms r
using public.profiles p
where p.id = r.host_id
  and p.is_hidden
  and p.display_name = 'TEST ACCOUNT A'
  and r.ended_at is not null
  and not exists (select 1 from public.watch_messages w where w.room_id = r.id)
  and r.id in (
    '90e1aabb-fb9d-4904-a81d-2a65c4f44db8', '14fdec9a-82cc-456c-8bcb-e45840508b28', '6b84a07d-31a6-4059-bf8a-83c66fa7ab96',
    'a3089285-8ab2-49f1-ba34-bbfa82ad9d3d', 'e54c76bb-5fd1-45b6-bf00-70c86003922e', '8e934aea-7728-40f4-8574-2cd89e8c5f58',
    '11c07d1d-aa7f-4e41-889f-e98d03fe9ee2'
  );

delete from public.forum_threads t
using public.profiles p
where p.id = t.author_id
  and p.is_hidden
  and p.display_name = 'TEST ACCOUNT A'
  and t.title like 'STREAM :: TEST ACCOUNT A :: 2026-11-13%'
  and t.id in (
    'c05228ed-0b26-467b-b223-50dd3eecc031', '1abf084a-0924-448d-961e-1c4416657db0', '68fc5ae3-efe1-49af-bd5e-c3c189348b15',
    'e4094f0c-848a-4ec9-bf19-5d4da12c3509', '1aecf5eb-c172-4efd-b1d7-d4526bb79a9b', 'ed16c350-7f1c-45b6-911e-1b06087404ea',
    '587d70ba-106d-47a8-a74b-a82e179aa81b'
  )
  and not exists (select 1 from public.forum_comments c where c.thread_id = t.id)
  and not exists (select 1 from public.forum_pins n where n.thread_id = t.id);

commit;
