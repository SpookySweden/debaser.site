-- Luke's OK 2026-11-15 ("Yes, delete them", typed in the main session and relayed to the PROFILE session): the test rows the
-- PROFILE session's proofs left on the live site, all by the hidden test accounts. Nine named rows:
--   2 chat lines ("Live check, B speaking." by TEST ACCOUNT B, "Live check, A speaking." by TEST ACCOUNT A) from the one short
--     two-person check of stream-room speech (scripts/drive-speech-room-live.cjs);
--   2 ended PRIVATE stream rooms by TEST ACCOUNT A from that check and its first, spoiled run;
--   2 board threads, one for each of those rooms ("STREAM :: TEST ACCOUNT A :: 2026-11-15"), with no comments and no pins;
--   3 comments by TEST ACCOUNT A on its own profile ("SLIDER DRIVE one/two/three"), from the COMMENTS slider's proof.
-- With the two rooms go their own member rows (3) and crown rows (2), on delete cascade: they are part of a room and cannot
-- be kept without it. Nothing else.
-- Listed first with supabase/cleanup/test-profile-leftovers-2026-11-15-review.sql (the same conditions, as a select). Each id
-- is named and the conditions repeat what was checked, so running this again deletes nothing.
-- Backup: Documents/debaser-backups/2026-11-15-15-50 (96 tables, 0 failed; it holds these rows).
-- Run on 2026-11-15. Counts before -> after, whole tables: stream rooms 50 -> 48, board threads 71 -> 69, chat lines
-- 879 -> 877, profile comments 3 -> 0, room members 88 -> 85, room crowns 52 -> 50. The review reads 0 for all of it now.
begin;

delete from public.watch_messages m
where m.id in ('78526794-d03e-485f-b3d0-4db1fe41af1c', '33cc944a-e900-4ec3-bfaf-48d8b03e09e5')
  and m.room_id = 'a3f574f4-a6c4-484f-ac72-d0757bebc01c'
  and m.body like 'Live check, % speaking.';

delete from public.watch_rooms r
using public.profiles p
where p.id = r.host_id
  and p.is_hidden
  and p.display_name = 'TEST ACCOUNT A'
  and r.ended_at is not null
  and not exists (select 1 from public.watch_messages w where w.room_id = r.id)
  and r.id in ('d344b49f-1612-46ec-a666-ff031bd844d0', 'a3f574f4-a6c4-484f-ac72-d0757bebc01c');

delete from public.forum_threads t
using public.profiles p
where p.id = t.author_id
  and p.is_hidden
  and p.display_name = 'TEST ACCOUNT A'
  and t.title like 'STREAM :: TEST ACCOUNT A :: 2026-11-15%'
  and t.id in ('3e5ee119-95ac-4efd-a2c0-7f66bd6f1f72', '02a73f19-e030-442c-9b23-b2cee1a68bf9')
  and not exists (select 1 from public.forum_comments c where c.thread_id = t.id)
  and not exists (select 1 from public.forum_pins n where n.thread_id = t.id);

delete from public.profile_comments c
using public.profiles p
where p.id = c.author_id
  and p.is_hidden
  and p.display_name = 'TEST ACCOUNT A'
  and c.user_id = c.author_id
  and c.body like 'SLIDER DRIVE %'
  and c.id in ('803f7fb7-d19c-4fc5-8f98-565866b7b5b4', '8203fd16-0a19-40e6-87f9-1fb5110c2031', 'ab027348-a32a-4dfa-b923-ab911e704920');

commit;
