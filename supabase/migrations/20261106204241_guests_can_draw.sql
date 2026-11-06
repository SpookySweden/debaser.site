-- Guests can draw (SPEC-guests.md, Luke's OK 2026-11-06): strokes, rubbing out and undo. Saving a canvas and placing pictures or chat lines on it stay with accounts,
-- and GUESTS CAN TALK off stops drawing as well, because the rules on the canvas already ask `room_may_talk`. Safe to run again.

-- The name is the database's, as on a chat line. The limits are drawing's own: a pen makes far more rows than a mouth does, and one row can be 16 KB.
create index if not exists room_canvas_inputs_recent_idx on public.room_canvas_inputs (canvas_id, created_at);

create or replace function public.room_canvas_inputs_guest()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  shown text;
begin
  if not public.is_guest() then return new; end if;

  select p.display_name into shown from public.profiles p where p.id = caller;
  if shown is null or shown not like '% [GUEST]' then
    raise exception 'a guest needs a name' using errcode = 'GT401';
  end if;
  if new.kind not in ('stroke', 'erase', 'undo') then
    raise exception 'placing needs an account' using errcode = 'GT415';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('guest-stroke:' || caller::text, 0));
  if (select count(*) from public.room_canvas_inputs i where i.canvas_id = new.canvas_id and i.author_id = caller and i.created_at > now() - interval '10 seconds') >= 60
    or (select count(*) from public.room_canvas_inputs i where i.canvas_id = new.canvas_id and i.author_id = caller and i.created_at > now() - interval '1 minute') >= 200
    or (select count(*) from public.room_canvas_inputs i where i.canvas_id = new.canvas_id and i.author_label like '% [GUEST]' and i.created_at > now() - interval '1 minute') >= 600
  then
    raise exception 'slow down' using errcode = 'GT429';
  end if;

  new.author_label := shown;
  return new;
end;
$$;
revoke all on function public.room_canvas_inputs_guest() from public, anon, authenticated;
drop trigger if exists room_canvas_inputs_guest on public.room_canvas_inputs;
create trigger room_canvas_inputs_guest before insert on public.room_canvas_inputs for each row execute function public.room_canvas_inputs_guest();

-- A guest's first stroke can open the room's canvas. What it is called and whose it is come from the room, not the browser.
create or replace function public.room_canvases_guest()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  room public.watch_rooms%rowtype;
begin
  if not public.is_guest() then return new; end if;

  select * into room from public.watch_rooms r where r.id = new.room_id;
  if room.id is null then
    raise exception 'no such room' using errcode = '42501';
  end if;
  new.host_id := room.original_host_id;
  new.host_label := left(room.original_host_label, 80);
  new.title := left(case when room.origin = 'music' then 'MUSIC' else 'STREAM' end || ' :: ' || upper(room.original_host_label), 120);
  return new;
end;
$$;
revoke all on function public.room_canvases_guest() from public, anon, authenticated;
drop trigger if exists room_canvases_guest on public.room_canvases;
create trigger room_canvases_guest before insert on public.room_canvases for each row execute function public.room_canvases_guest();

-- Strokes go out on the room's canvas wire as they are drawn.
drop policy if exists "guests say only room presence" on realtime.messages;
drop policy if exists "guests say only room presence and strokes" on realtime.messages;
create policy "guests say only room presence and strokes" on realtime.messages
  as restrictive for insert to authenticated
  with check (
    not (select public.is_guest())
    or (extension = 'presence' and realtime.topic() like 'watch:%')
    or (extension = 'broadcast' and realtime.topic() like 'canvas:%')
  );

-- The gate, as before, plus the two writes drawing needs.
create or replace function public.guest_request_gate()
returns void
language plpgsql
set search_path = ''
as $$
declare
  place text;
  method text;
begin
  if not public.is_guest() then return; end if;

  place := coalesce(current_setting('request.path', true), '');
  method := upper(coalesce(current_setting('request.method', true), ''));

  if place in (
    '/rpc/watch_room_door', '/rpc/watch_join', '/rpc/watch_room_outline', '/rpc/watch_private_rooms', '/rpc/stream_record_outline',
    '/rpc/private_stream_folds', '/rpc/watch_now', '/rpc/watch_close_stale', '/rpc/guest_self', '/rpc/guest_set_name'
  ) then
    return;
  end if;
  if method in ('GET', 'HEAD') and place in (
    '/watch_rooms', '/watch_messages', '/watch_queue', '/watch_crowns', '/watch_members', '/room_canvases', '/room_canvas_inputs', '/room_canvas_snapshots'
  ) then
    return;
  end if;
  if method = 'POST' and place in ('/watch_messages', '/room_canvas_inputs', '/room_canvases') then return; end if;

  raise exception 'guests cannot do that' using errcode = '42501';
end;
$$;
