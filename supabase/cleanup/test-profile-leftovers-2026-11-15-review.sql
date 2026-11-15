-- REVIEW (read-only): what supabase/cleanup/test-profile-leftovers-2026-11-15.sql removes, counted with the same conditions.
-- Run before the delete (expected: 2 chat lines, 2 rooms, 2 threads, 3 comments, and with the rooms 3 member rows and
-- 2 crown rows) and after it (expected: all 0).
select
  (select count(*)
     from public.watch_messages m
    where m.id in ('78526794-d03e-485f-b3d0-4db1fe41af1c', '33cc944a-e900-4ec3-bfaf-48d8b03e09e5')
      and m.room_id = 'a3f574f4-a6c4-484f-ac72-d0757bebc01c'
      and m.body like 'Live check, % speaking.') as chat_lines,
  (select count(*)
     from public.watch_rooms r
     join public.profiles p on p.id = r.host_id
    where p.is_hidden
      and p.display_name = 'TEST ACCOUNT A'
      and r.ended_at is not null
      and r.id in ('d344b49f-1612-46ec-a666-ff031bd844d0', 'a3f574f4-a6c4-484f-ac72-d0757bebc01c')) as rooms,
  (select count(*)
     from public.forum_threads t
     join public.profiles p on p.id = t.author_id
    where p.is_hidden
      and p.display_name = 'TEST ACCOUNT A'
      and t.title like 'STREAM :: TEST ACCOUNT A :: 2026-11-15%'
      and t.id in ('3e5ee119-95ac-4efd-a2c0-7f66bd6f1f72', '02a73f19-e030-442c-9b23-b2cee1a68bf9')
      and not exists (select 1 from public.forum_comments c where c.thread_id = t.id)
      and not exists (select 1 from public.forum_pins n where n.thread_id = t.id)) as threads,
  (select count(*)
     from public.profile_comments c
     join public.profiles p on p.id = c.author_id
    where p.is_hidden
      and p.display_name = 'TEST ACCOUNT A'
      and c.user_id = c.author_id
      and c.body like 'SLIDER DRIVE %'
      and c.id in ('803f7fb7-d19c-4fc5-8f98-565866b7b5b4', '8203fd16-0a19-40e6-87f9-1fb5110c2031', 'ab027348-a32a-4dfa-b923-ab911e704920')) as profile_comments,
  (select count(*) from public.watch_members w
    where w.room_id in ('d344b49f-1612-46ec-a666-ff031bd844d0', 'a3f574f4-a6c4-484f-ac72-d0757bebc01c')) as members_going_with_the_rooms,
  (select count(*) from public.watch_crowns w
    where w.room_id in ('d344b49f-1612-46ec-a666-ff031bd844d0', 'a3f574f4-a6c4-484f-ac72-d0757bebc01c')) as crowns_going_with_the_rooms,
  (select count(*) from public.watch_rooms) as all_rooms,
  (select count(*) from public.forum_threads) as all_threads,
  (select count(*) from public.watch_messages) as all_chat_lines,
  (select count(*) from public.profile_comments) as all_profile_comments,
  (select count(*) from public.watch_members) as all_members,
  (select count(*) from public.watch_crowns) as all_crowns;
