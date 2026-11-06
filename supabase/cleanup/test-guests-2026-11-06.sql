-- Removes the throwaway guests the live guest tests made on 2026-11-06 (SPEC-guests.md), with Luke's OK. Reviewed first: 59 at the time of writing, 17 named Moth, Wren or Fern by
-- the tests, the rest unnamed, and none of them in a room hosted by a real person. A real guest named anything else, or in a real person's room, is left alone.
-- Their chat lines and strokes in the ended test rooms go with them. The ended rooms themselves stay, hosted by a hidden test account.
delete from auth.users u
where u.is_anonymous
  and u.created_at < '2026-11-06 21:30+00'
  and exists (select 1 from public.profiles p where p.id = u.id and (p.display_name ~ '^(Moth|Wren|Fern)[ 0-9]' or p.display_name like 'GUEST-%'))
  and not exists (
    select 1 from public.watch_members m join public.watch_rooms r on r.id = m.room_id
    where m.user_id = u.id and r.original_host_id not in (select id from public.profiles where is_hidden)
  );
