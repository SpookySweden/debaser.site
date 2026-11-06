-- Luke's OK in chat, 2026-11-06: the three ended rooms and board threads the `[ WATCH IN ROOM ]` drive left, all hosted by the kept TEST ACCOUNT A.
-- Listed and checked first: no messages, comments, pins, join attempts or passwords; the 5 queue rows, 4 members and 3 crowns that go with the rooms are all
-- the kept test accounts' own. Each id is named, and the conditions repeat what was checked. Running it again deletes nothing.
begin;

delete from public.watch_rooms r
using public.profiles p
where p.id = r.host_id
  and p.is_hidden
  and p.display_name = 'TEST ACCOUNT A'
  and r.ended_at is not null
  and r.name in ('DRIVE PRIVATE', 'DRIVE OPEN')
  and r.id in (
    '6e39be94-c2fc-4c54-9347-5d481421d29b', 'f75a63d4-a22f-47d1-978a-fcdf60c3673c', 'be9f7435-7626-432e-b595-2f759db25685'
  );

delete from public.forum_threads t
using public.profiles p
where p.id = t.author_id
  and p.is_hidden
  and p.display_name = 'TEST ACCOUNT A'
  and t.title like 'STREAM :: TEST ACCOUNT A :: %'
  and t.id in (
    '99c7727b-758c-4e2c-981c-3748a06f8123', '7854c0a4-ce30-41f1-accc-83388cc27863', '7c887377-f1e7-4f30-8c84-bb68b0c17d35'
  )
  and not exists (select 1 from public.forum_comments c where c.thread_id = t.id)
  and not exists (select 1 from public.forum_pins n where n.thread_id = t.id);

commit;
