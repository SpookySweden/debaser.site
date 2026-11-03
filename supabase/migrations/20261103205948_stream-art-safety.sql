-- -----------------------------------------------------------------------------
-- STREAM ART safety (SPEC-stream-art.md follow-up, Luke's typed OK 2026-11-03: "Yes, close them")
-- -----------------------------------------------------------------------------
-- Closes the four gaps the canvas's code review found. Idempotent: every policy, function and trigger is dropped
-- and re-created by name. It changes no existing row and touches no other feature's tables.
--
-- 1. The live drawing line (Realtime broadcast `canvas:<room id>`) becomes a private channel: only signed-in,
--    unbanned people hear or send on it, and only while that room is live. Other channels stay public as before:
--    these policies apply to private channels only.
-- 2. A snapshot (and its picture in the bucket) is taken only by somebody with a part in the canvas: the room's
--    host, whoever saved it, anybody who drew on it, or anybody crowned in the room.
-- 3. A snapshot's "who was there" and crowns are written by the database from its own records, not taken from the
--    browser: the host, everybody who drew, everybody who chatted in the room since the canvas opened, the saver,
--    the taker, and everybody crowned there. Credits keep only those people. Watchers who never drew, chatted or
--    held a crown leave no record, so they are not listed.
-- 4. A hidden piece is unreadable (canvas, timeline, snapshots, pictures) for everybody but the house account,
--    not only kept off the archive page. Nothing is wiped.

-- Who has a part in a canvas (2 and 3). Security definer so it reads the same records for everybody.
create or replace function public.room_canvas_people(canvas uuid)
returns table (user_id uuid, crowned boolean)
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    select rc.id, rc.room_id, rc.host_id, rc.saved_by, rc.opened_at from public.room_canvases rc where rc.id = canvas
  ),
  people as (
    select c.host_id as user_id from c
    union select c.saved_by from c where c.saved_by is not null
    union select i.author_id from public.room_canvas_inputs i join c on i.canvas_id = c.id
    union select m.author_id from public.watch_messages m join c on m.room_id = c.room_id where m.created_at >= c.opened_at
    union select w.user_id from public.watch_crowns w join c on w.room_id = c.room_id
  )
  select p.user_id, exists (select 1 from public.watch_crowns w join c on w.room_id = c.room_id where w.user_id = p.user_id)
    from people p;
$$;

revoke all on function public.room_canvas_people(uuid) from public;
grant execute on function public.room_canvas_people(uuid) to authenticated;

-- The canvases' own people, minus chat-only watchers: may this account take a snapshot? (2)
create or replace function public.room_canvas_may_snapshot(canvas uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.room_canvases c
     where c.id = canvas
       and (
         c.host_id = auth.uid()
         or c.saved_by = auth.uid()
         or exists (select 1 from public.watch_rooms r where r.id = c.room_id and r.host_id = auth.uid())
         or exists (select 1 from public.room_canvas_inputs i where i.canvas_id = c.id and i.author_id = auth.uid())
         or exists (select 1 from public.watch_crowns w where w.room_id = c.room_id and w.user_id = auth.uid())
       )
  );
$$;

revoke all on function public.room_canvas_may_snapshot(uuid) from public;
grant execute on function public.room_canvas_may_snapshot(uuid) to authenticated;

-- Readable unless hidden; the house account reads everything (4).
create or replace function public.room_canvas_readable(canvas uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.room_canvases c where c.id = canvas and (c.hidden = false or public.is_admin()));
$$;

revoke all on function public.room_canvas_readable(uuid) from public;
grant execute on function public.room_canvas_readable(uuid) to authenticated;

-- 1. The live drawing line --------------------------------------------------------------
drop policy if exists "canvas wire heard in a live room" on realtime.messages;
create policy "canvas wire heard in a live room" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() like 'canvas:%'
    and not public.is_banned()
    and exists (select 1 from public.watch_rooms r where r.id::text = substr(realtime.topic(), 8) and r.ended_at is null)
  );

drop policy if exists "canvas wire sent in a live room" on realtime.messages;
create policy "canvas wire sent in a live room" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() like 'canvas:%'
    and not public.is_banned()
    and exists (select 1 from public.watch_rooms r where r.id::text = substr(realtime.topic(), 8) and r.ended_at is null)
  );

-- 2. Snapshots only by somebody with a part in the canvas -------------------------------
drop policy if exists "room canvas snapshots taken of a saved canvas" on public.room_canvas_snapshots;
create policy "room canvas snapshots taken of a saved canvas" on public.room_canvas_snapshots
  for insert to authenticated
  with check (
    not public.is_banned()
    and taken_by = auth.uid()
    and public.room_canvas_may_snapshot(canvas_id)
    and exists (
      select 1 from public.room_canvases c
        join public.watch_rooms r on r.id = c.room_id
       where c.id = canvas_id and c.saved_at is not null and c.closed_at is null and r.ended_at is null
    )
  );

drop policy if exists "stream art filed for a saved canvas" on storage.objects;
create policy "stream art filed for a saved canvas" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'stream-art'
    and not public.is_banned()
    and exists (
      select 1 from public.room_canvases c
        join public.watch_rooms r on r.id = c.room_id
       where c.id::text = (storage.foldername(name))[1]
         and c.saved_at is not null and c.closed_at is null and r.ended_at is null
         and public.room_canvas_may_snapshot(c.id)
    )
    and not exists (
      select 1 from storage.objects o
       where o.bucket_id = 'stream-art' and o.owner_id = auth.uid()::text and o.created_at > now() - interval '10 seconds'
    )
  );

-- 3. "Who was there", crowns and credits written by the database --------------------------
create or replace function public.room_canvas_snapshot_people()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  known uuid[];
begin
  select array_agg(p.user_id) into known from public.room_canvas_people(new.canvas_id) p;
  known := coalesce(known, '{}') || new.taken_by;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.user_id,
           'label', left(coalesce(nullif(pr.display_name, ''), 'Unknown'), 80),
           'crowned', p.crowned
         ) order by (p.user_id = c.host_id) desc, pr.display_name), '[]'::jsonb)
    into new.participants
    from (select distinct on (x.user_id) x.user_id, x.crowned
            from (select pp.user_id, pp.crowned from public.room_canvas_people(new.canvas_id) pp
                  union all select new.taken_by, false) x
           order by x.user_id, x.crowned desc) p
    join public.room_canvases c on c.id = new.canvas_id
    left join public.profiles pr on pr.id = p.user_id;

  -- Credits keep their order and labels, minus anybody the records do not know (a credit by label alone stays:
  -- it names no account).
  select coalesce(jsonb_agg(e order by n), '[]'::jsonb)
    into new.credits
    from jsonb_array_elements(case when jsonb_typeof(new.credits) = 'array' then new.credits else '[]'::jsonb end)
         with ordinality as t(e, n)
   where jsonb_typeof(e -> 'id') = 'null'
      or (jsonb_typeof(e -> 'id') = 'string' and (e ->> 'id') = any (select k::text from unnest(known) k));

  select count(*) into new.input_count from public.room_canvas_inputs i where i.canvas_id = new.canvas_id;
  return new;
end;
$$;

drop trigger if exists room_canvas_snapshot_people on public.room_canvas_snapshots;
create trigger room_canvas_snapshot_people
  before insert on public.room_canvas_snapshots
  for each row execute function public.room_canvas_snapshot_people();

-- 4. Hidden pieces unreadable but to the house account ---------------------------------
drop policy if exists "room canvases readable by accounts" on public.room_canvases;
create policy "room canvases readable by accounts" on public.room_canvases
  for select to authenticated using (hidden = false or public.is_admin());

drop policy if exists "room canvas inputs readable by accounts" on public.room_canvas_inputs;
create policy "room canvas inputs readable by accounts" on public.room_canvas_inputs
  for select to authenticated using (public.room_canvas_readable(canvas_id));

drop policy if exists "room canvas snapshots readable by accounts" on public.room_canvas_snapshots;
create policy "room canvas snapshots readable by accounts" on public.room_canvas_snapshots
  for select to authenticated using (public.room_canvas_readable(canvas_id));

drop policy if exists "stream art readable by accounts" on storage.objects;
create policy "stream art readable by accounts" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'stream-art'
    and exists (select 1 from public.room_canvases c where c.id::text = (storage.foldername(name))[1] and (c.hidden = false or public.is_admin()))
  );

-- To check after the push:
--   select tablename, policyname from pg_policies where tablename in ('room_canvases', 'room_canvas_inputs',
--     'room_canvas_snapshots', 'messages', 'objects') and policyname ilike any (array['%canvas%', '%stream art%']) order by 1, 2;
--   select tgname from pg_trigger where tgname = 'room_canvas_snapshot_people';
