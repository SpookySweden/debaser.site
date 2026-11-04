-- -----------------------------------------------------------------------------
-- STREAM ART safety, review fixes (follow-up to 20261103205948_stream-art-safety.sql; Luke's typed OK to close the
-- canvas gaps, 2026-11-03, and full permission to carry on, 2026-11-04)
-- -----------------------------------------------------------------------------
-- Idempotent: functions replaced by name, grants revoked or given again. Changes no row.
--
-- 1. `room_canvas_people` named the people of a hidden piece to any signed-in account calling it directly. Only the
--    snapshot trigger needs it, so nobody else may call it, and it names nobody for a hidden canvas (but to the
--    house account).
-- 2. A chat line said before the canvas opened and then dragged onto it lost its writer's credit: its writer now
--    counts as one of the canvas's people when a text placement on the canvas names them and they did chat in the
--    room.
-- 3. Hiding a canvas still open in a live room left the room unable to open a new one (non-admins could no longer
--    see the open one): HIDE now closes it too.
-- 4. Credits are rebuilt, not only filtered: an account's credit wears that account's own name; a credit with no
--    account keeps its words, cut to 80 characters.

-- 1 and 2 ---------------------------------------------------------------------------
create or replace function public.room_canvas_people(canvas uuid)
returns table (user_id uuid, crowned boolean)
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    select rc.id, rc.room_id, rc.host_id, rc.saved_by, rc.opened_at
      from public.room_canvases rc
     where rc.id = canvas and (rc.hidden = false or public.is_admin())
  ),
  people as (
    select c.host_id as user_id from c
    union select c.saved_by from c where c.saved_by is not null
    union select i.author_id from public.room_canvas_inputs i join c on i.canvas_id = c.id
    union select m.author_id from public.watch_messages m join c on m.room_id = c.room_id where m.created_at >= c.opened_at
    union select m.author_id from public.watch_messages m join c on m.room_id = c.room_id
     where exists (
       select 1 from public.room_canvas_inputs i
        where i.canvas_id = c.id and i.kind = 'place'
          and i.data -> 'place' ->> 'type' = 'text'
          and i.data -> 'place' ->> 'writerId' = m.author_id::text
     )
    union select w.user_id from public.watch_crowns w join c on w.room_id = c.room_id
  )
  select p.user_id, exists (select 1 from public.watch_crowns w join c on w.room_id = c.room_id where w.user_id = p.user_id)
    from people p;
$$;

revoke all on function public.room_canvas_people(uuid) from public;
revoke all on function public.room_canvas_people(uuid) from authenticated;
revoke all on function public.room_canvas_people(uuid) from anon;

-- 3 ---------------------------------------------------------------------------------
create or replace function public.room_canvas_hide(canvas uuid, hide boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  done integer;
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.room_canvases c
     set hidden = hide,
         hidden_at = case when hide then now() else null end,
         -- A hidden canvas is never left open: the room can open a fresh one.
         closed_at = case when hide then coalesce(c.closed_at, now()) else c.closed_at end
   where c.id = canvas and c.saved_at is not null;
  get diagnostics done = row_count;
  return done = 1;
end;
$$;

revoke all on function public.room_canvas_hide(uuid, boolean) from public;
grant execute on function public.room_canvas_hide(uuid, boolean) to authenticated;

-- 4 ---------------------------------------------------------------------------------
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

  -- Credits in the browser's order, each rebuilt: an account's credit wears its own name and must be somebody the
  -- records know; a credit with no account keeps its words, cut short.
  select coalesce(jsonb_agg(
           case when jsonb_typeof(t.e -> 'id') = 'string'
                then jsonb_build_object('id', t.e ->> 'id', 'label', left(coalesce(nullif(pr.display_name, ''), 'Unknown'), 80))
                else jsonb_build_object('id', null, 'label', left(t.e ->> 'label', 80))
           end order by t.n), '[]'::jsonb)
    into new.credits
    from jsonb_array_elements(case when jsonb_typeof(new.credits) = 'array' then new.credits else '[]'::jsonb end)
         with ordinality as t(e, n)
    left join public.profiles pr on jsonb_typeof(t.e -> 'id') = 'string' and pr.id::text = t.e ->> 'id'
   where jsonb_typeof(t.e) = 'object'
     and (
       (jsonb_typeof(t.e -> 'id') = 'null' and jsonb_typeof(t.e -> 'label') = 'string' and char_length(t.e ->> 'label') > 0)
       or (jsonb_typeof(t.e -> 'id') = 'string' and (t.e ->> 'id') = any (select k::text from unnest(known) k))
     );

  select count(*) into new.input_count from public.room_canvas_inputs i where i.canvas_id = new.canvas_id;
  return new;
end;
$$;
