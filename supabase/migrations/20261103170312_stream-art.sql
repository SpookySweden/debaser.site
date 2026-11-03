-- -----------------------------------------------------------------------------
-- The room canvas ("magma mode") and STREAM ART in the archive (SPEC-stream-art.md, 2026-11-03)
-- -----------------------------------------------------------------------------
-- Run with `npm run db:push` (Luke's typed OK, 2026-11-03, for the spec's "Data" section). Idempotent:
-- `if not exists` throughout, every policy, trigger and function dropped and re-created by name. It changes no
-- existing row and touches no existing table.
--
-- 1. `room_canvases`: one canvas per room session (GO LIVE to END STREAM; a music room's GO PUBLIC to public
--    off), opened by whoever draws or saves first. SAVE (`room_canvas_save`) documents it in the archive; only the
--    room's host closes it (`room_canvas_close`); only the house account hides it (`room_canvas_hide`). Nothing
--    else changes a canvas, and nothing deletes one.
-- 2. `room_canvas_inputs`: the timeline - who, what kind (stroke, erase, undo, place), the pixels or placement,
--    when, and the order the server got it (`seq`). Strokes travel live over a Realtime broadcast channel and are
--    written here in batches. Anybody signed in adds their own while the canvas is open and the room live; nobody
--    changes or deletes anyone's (no update or delete policy at all). Undo and erase of other people's work are
--    refused by the drawing rules (app/lib/watch/canvas.ts), which ignore an undo naming somebody else's input.
-- 3. `room_canvas_snapshots`: a saved canvas's pictures, each timed, dated and credited, with the GIFs and text
--    on it (drawn live over the picture, never baked in) and who was in the room. The picture is a PNG in the
--    private `stream-art` bucket, read by signed-in people only.
-- Reading any of it is for signed-in people, as the archive is.

-- 1. The canvases ---------------------------------------------------------------------
create table if not exists public.room_canvases (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.watch_rooms (id) on delete cascade,
  -- Whose room it was: the piece wears their picture in the archive.
  host_id uuid not null references auth.users (id) on delete cascade,
  host_label text not null default 'Unknown',
  title text not null default '',
  opened_by uuid references auth.users (id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  saved_at timestamptz,
  saved_by uuid references auth.users (id) on delete set null,
  saved_by_label text,
  hidden boolean not null default false,
  hidden_at timestamptz,
  constraint room_canvases_host_label_length check (char_length(host_label) between 1 and 80),
  constraint room_canvases_title_length check (char_length(title) <= 120)
);

-- One open canvas per room at a time: two tabs opening it at once get the same one.
create unique index if not exists room_canvases_one_open on public.room_canvases (room_id) where closed_at is null;
create index if not exists room_canvases_saved_idx on public.room_canvases (saved_at desc) where saved_at is not null;

alter table public.room_canvases enable row level security;

drop policy if exists "room canvases readable by accounts" on public.room_canvases;
create policy "room canvases readable by accounts" on public.room_canvases
  for select to authenticated using (true);

-- Opened by anybody signed in, in their own name, for a live room, and only as a fresh canvas.
drop policy if exists "room canvases opened in a live room" on public.room_canvases;
create policy "room canvases opened in a live room" on public.room_canvases
  for insert to authenticated
  with check (
    not public.is_banned()
    and opened_by = auth.uid()
    and closed_at is null
    and saved_at is null
    and saved_by is null
    and hidden = false
    and hidden_at is null
    and exists (select 1 from public.watch_rooms r where r.id = room_id and r.ended_at is null and r.original_host_id = host_id)
  );
-- No update or delete policy: the three functions below are the only writes.

-- SAVE: anybody signed in, on an open canvas in a live room. Saying it twice keeps the first.
create or replace function public.room_canvas_save(canvas uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  label text;
  done integer;
begin
  if auth.uid() is null or public.is_banned() then
    return false;
  end if;
  select coalesce(nullif(p.display_name, ''), 'Unknown') into label from public.profiles p where p.id = auth.uid();
  update public.room_canvases c
     set saved_at = now(), saved_by = auth.uid(), saved_by_label = left(coalesce(label, 'Unknown'), 80)
   where c.id = canvas
     and c.saved_at is null
     and c.closed_at is null
     and exists (select 1 from public.watch_rooms r where r.id = c.room_id and r.ended_at is null);
  get diagnostics done = row_count;
  return done = 1;
end;
$$;

-- The session ended: only the room's current host closes its canvas (or anybody, once the room itself has ended).
create or replace function public.room_canvas_close(canvas uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  done integer;
begin
  if auth.uid() is null then
    return false;
  end if;
  update public.room_canvases c
     set closed_at = now()
   where c.id = canvas
     and c.closed_at is null
     and exists (
       select 1 from public.watch_rooms r
        where r.id = c.room_id and (r.host_id = auth.uid() or r.ended_at is not null)
     );
  get diagnostics done = row_count;
  return done = 1;
end;
$$;

-- HIDE: the house account only (the same `is_admin()` as the board's moderation). Off the archive, never wiped.
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
     set hidden = hide, hidden_at = case when hide then now() else null end
   where c.id = canvas and c.saved_at is not null;
  get diagnostics done = row_count;
  return done = 1;
end;
$$;

revoke all on function public.room_canvas_save(uuid) from public;
revoke all on function public.room_canvas_close(uuid) from public;
revoke all on function public.room_canvas_hide(uuid, boolean) from public;
grant execute on function public.room_canvas_save(uuid) to authenticated;
grant execute on function public.room_canvas_close(uuid) to authenticated;
grant execute on function public.room_canvas_hide(uuid, boolean) to authenticated;

-- 2. The timeline ----------------------------------------------------------------------
create table if not exists public.room_canvas_inputs (
  id uuid primary key,
  canvas_id uuid not null references public.room_canvases (id) on delete cascade,
  -- The order the server got it in: replay goes by this.
  seq bigint generated always as identity,
  author_id uuid not null references auth.users (id) on delete cascade,
  author_label text not null default 'Unknown',
  kind text not null,
  -- The pixels (colour, size, points) or the placement; checked again by the drawing rules when read.
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint room_canvas_inputs_kind check (kind in ('stroke', 'erase', 'undo', 'place')),
  constraint room_canvas_inputs_label_length check (char_length(author_label) between 1 and 80),
  constraint room_canvas_inputs_data_size check (octet_length(data::text) <= 16384)
);

create index if not exists room_canvas_inputs_canvas_idx on public.room_canvas_inputs (canvas_id, seq);

alter table public.room_canvas_inputs enable row level security;

drop policy if exists "room canvas inputs readable by accounts" on public.room_canvas_inputs;
create policy "room canvas inputs readable by accounts" on public.room_canvas_inputs
  for select to authenticated using (true);

drop policy if exists "room canvas inputs added in your own name" on public.room_canvas_inputs;
create policy "room canvas inputs added in your own name" on public.room_canvas_inputs
  for insert to authenticated
  with check (
    not public.is_banned()
    and author_id = auth.uid()
    and exists (
      select 1 from public.room_canvases c
        join public.watch_rooms r on r.id = c.room_id
       where c.id = canvas_id and c.closed_at is null and r.ended_at is null
    )
  );
-- No update or delete policy: what was drawn stays drawn (an undo is a new input, not a delete).

-- 3. The snapshots -------------------------------------------------------------------
create table if not exists public.room_canvas_snapshots (
  id uuid primary key,
  canvas_id uuid not null references public.room_canvases (id) on delete cascade,
  -- `<canvas id>/<snapshot id>.png` in the `stream-art` bucket.
  path text not null,
  taken_at timestamptz not null default now(),
  taken_by uuid not null references auth.users (id) on delete cascade,
  taken_by_label text not null default 'Unknown',
  placements jsonb not null default '[]'::jsonb,
  credits jsonb not null default '[]'::jsonb,
  participants jsonb not null default '[]'::jsonb,
  input_count integer not null default 0,
  constraint room_canvas_snapshots_label_length check (char_length(taken_by_label) between 1 and 80),
  constraint room_canvas_snapshots_path check (path = canvas_id::text || '/' || id::text || '.png'),
  constraint room_canvas_snapshots_size check (octet_length(placements::text) + octet_length(credits::text) + octet_length(participants::text) <= 262144)
);

create index if not exists room_canvas_snapshots_canvas_idx on public.room_canvas_snapshots (canvas_id, taken_at);

alter table public.room_canvas_snapshots enable row level security;

drop policy if exists "room canvas snapshots readable by accounts" on public.room_canvas_snapshots;
create policy "room canvas snapshots readable by accounts" on public.room_canvas_snapshots
  for select to authenticated using (true);

-- Taken by anybody signed in, in their own name, of a saved canvas still open in a live room.
drop policy if exists "room canvas snapshots taken of a saved canvas" on public.room_canvas_snapshots;
create policy "room canvas snapshots taken of a saved canvas" on public.room_canvas_snapshots
  for insert to authenticated
  with check (
    not public.is_banned()
    and taken_by = auth.uid()
    and exists (
      select 1 from public.room_canvases c
        join public.watch_rooms r on r.id = c.room_id
       where c.id = canvas_id and c.saved_at is not null and c.closed_at is null and r.ended_at is null
    )
  );

-- 4. The pictures: a private bucket, PNG only, small ---------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stream-art', 'stream-art', false, 1048576, array['image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "stream art readable by accounts" on storage.objects;
create policy "stream art readable by accounts" on storage.objects
  for select to authenticated
  using (bucket_id = 'stream-art');

-- Filed into a saved, open canvas's own folder, at most one picture per account every 10 seconds (the rate
-- limit), never replaced or removed (no update or delete policy).
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
    )
    and not exists (
      select 1 from storage.objects o
       where o.bucket_id = 'stream-art' and o.owner_id = auth.uid()::text and o.created_at > now() - interval '10 seconds'
    )
  );

-- To check after the push:
--   select tablename, policyname from pg_policies where tablename like 'room_canvas%' order by 1, 2;
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'stream-art';
