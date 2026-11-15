-- Proves 20261115170354_rooms_tightening.sql behaves, on the live database, and leaves nothing behind: everything
-- here happens inside one transaction that is ROLLED BACK at the end (and a failed expectation raises, which rolls it
-- back too). It needs --write to run because it contains inserts, but no row survives it.
--
--   npm run db -- --write --file supabase/cleanup/verify-rooms-tightening.sql
--
-- What it holds:
--   (a) a queue row whose address has a backslash, a tab, a line feed or a carriage return is refused, as a picture
--       and as a song; a plain site path and a plain https address are still taken;
--   (b) after NEXT takes a picture off (asked as TEST ACCOUNT A, the room's host), a write that puts that picture back
--       leaves the pointer empty; a write that puts something else on goes through; and once 15 seconds have passed
--       the same picture can be put on again on purpose;
--   (c) the room-link table has the restrictive "guests stay out" rule.
begin;

do $$
declare
  a uuid;
  room uuid := gen_random_uuid();
  picture uuid;
  song uuid;
  bad text;
  took boolean;
  now_on uuid;
begin
  select p.id into a from public.profiles p where p.is_hidden and p.display_name = 'TEST ACCOUNT A';
  if a is null then raise exception 'TEST ACCOUNT A not found'; end if;

  insert into public.watch_rooms (id, original_host_id, original_host_label, host_id, position_seconds, is_playing, privacy)
    values (room, a, 'TEST ACCOUNT A', a, 0, false, 'private');

  -- (a) each refused address, as a picture and as a song.
  foreach bad in array array[
    '/' || chr(92) || 'evil.example/x.png',
    '/assets/' || chr(92) || '..' || chr(92) || 'x.png',
    '/' || chr(9) || '/evil.example/x.png',
    '/' || chr(10) || '/evil.example/x.png',
    '/' || chr(13) || '/evil.example/x.png',
    'https://pictures.example.net' || chr(92) || '@192.168.1.10/x.png'
  ] loop
    begin
      insert into public.watch_queue (room_id, position, in_queue, source_url, source_kind, source_title, added_by) values (room, 900, true, bad, 'picture', 'X', a);
      raise exception 'NOT REFUSED as a picture: %', encode(convert_to(bad, 'UTF8'), 'escape');
    exception when check_violation then null;
    end;
    begin
      insert into public.watch_queue (room_id, position, in_queue, source_url, source_kind, source_title, added_by) values (room, 901, true, bad, 'audio', 'X', a);
      raise exception 'NOT REFUSED as a song: %', encode(convert_to(bad, 'UTF8'), 'escape');
    exception when check_violation then null;
    end;
  end loop;

  -- Still taken: a plain site path and a plain https address.
  insert into public.watch_queue (room_id, position, in_queue, source_url, source_kind, source_title, added_by, played_at, play_index)
    values (room, 1, true, '/assets/files/verify-picture.png', 'picture', 'VERIFY PICTURE', a, now(), 0) returning id into picture;
  insert into public.watch_queue (room_id, position, in_queue, source_url, source_kind, source_title, added_by)
    values (room, 2, true, 'https://example.org/verify-song.mp3', 'audio', 'VERIFY SONG', a) returning id into song;

  -- (b) the picture is on; NEXT, asked as the host, takes it off and notes it.
  update public.watch_rooms set current_entry_id = picture, position_seconds = 0, is_playing = true where id = room;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', a::text, true);
  took := public.watch_picture_next(room);
  if took is not true then raise exception 'watch_picture_next did not take the picture off (auth.uid() = %)', auth.uid(); end if;
  select current_entry_id into now_on from public.watch_rooms where id = room;
  if now_on is not null then raise exception 'the pointer was not cleared'; end if;
  if not exists (select 1 from public.watch_rooms where id = room and picture_off_entry_id = picture and picture_off_at is not null) then
    raise exception 'NEXT did not note what it took off';
  end if;

  -- The stale heartbeat: "the picture is on", a moment after NEXT.
  update public.watch_rooms set current_entry_id = picture, position_seconds = 0, is_playing = true where id = room;
  select current_entry_id into now_on from public.watch_rooms where id = room;
  if now_on is not null then raise exception 'a stale heartbeat put the picture back'; end if;
  if exists (select 1 from public.watch_rooms where id = room and is_playing) then raise exception 'a stale heartbeat set the room playing again'; end if;

  -- Whatever is next goes on as usual.
  update public.watch_rooms set current_entry_id = song, position_seconds = 0, is_playing = true where id = room;
  select current_entry_id into now_on from public.watch_rooms where id = room;
  if now_on is distinct from song then raise exception 'the next thing could not be put on'; end if;

  -- And later, the same picture can be put on again on purpose.
  update public.watch_rooms set picture_off_at = now() - interval '20 seconds' where id = room;
  update public.watch_rooms set current_entry_id = picture, position_seconds = 0, is_playing = true where id = room;
  select current_entry_id into now_on from public.watch_rooms where id = room;
  if now_on is distinct from picture then raise exception 'the same picture could not be put on again after 15 seconds'; end if;

  -- (c) the room-link table's rule.
  if not exists (
    select 1 from pg_policy p
    where p.polrelid = 'public.watch_room_links'::regclass and p.polname = 'guests stay out' and not p.polpermissive and p.polcmd = 'r'
  ) then
    raise exception 'watch_room_links has no restrictive "guests stay out" rule';
  end if;
end $$;

rollback;
