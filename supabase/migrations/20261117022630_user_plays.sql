-- HISTORY (SPEC-history.md; Luke's interview and "Yes, build it", 2026-11-17): what a person played, how it reached them,
-- and when, one row per play, so the HISTORY window can list it and fold open the session, letter or comment it came from.
--
-- What this adds, and nothing else. No existing table, rule or row is altered or removed:
--   - user_plays: one row per play (a song, a video, a book opened in READ). What it was (its site address, title and maker
--     as shown, a hotlinked thumbnail), how it reached the person (they played it themselves, their own queue, someone's
--     room, a letter, a profile comment, a board post, a profile song, someone's playlist, the reader, or NOT RECORDED for
--     the fill-in below), who added it and their name as it was, the room / queue row / letter / comment it came from (plain
--     ids, no foreign keys: a room or letter that goes later just reads as gone), when it started, and when and where it
--     stopped (for jumping back in). Metadata only: never counts, likes, views or ratings.
--     Owner only, by Row Level Security: only they can read, add, change or delete their rows; nobody else, signed in or not;
--     visitors (anon) have no grant; a stream room's guests are shut out. Kept forever (Luke's answer 4B): no cap, no clean-up.
--     Deleted with the account.
--     Adding is refused while history is paused (the same PAUSE as FOR YOU's history, `history_paused()`), and a new row is
--     stamped now. Changing a row may only set where it stopped; everything else stays as written (a trigger).
--   - play_note(...): the one way a browser writes a row, as the person (security invoker, so the rules above decide). The
--     same thing reached the same way within 60 seconds, or the same room queue row within 6 hours (a reload or a return
--     mid-play), is the same play: it returns that row instead of adding another.
--
-- The fill-in (Luke's answer 10B), run once and safe to re-run (it skips rows it already made):
--   - every row of the music bar's listen log (`music_listens`) becomes a song play at its own time, titled from the site's
--     own file lists (`media_items`, `music_tracks`, `profile_song_versions`), marked NOT RECORDED;
--   - every FOR YOU line (`user_history`) for a MEDIA item, a book, or a song the listen log does not already have, that was
--     played, read, finished or skipped, becomes one play at its last time, marked NOT RECORDED.
--   Guest (anonymous) accounts are left out. Neither source table is changed.
--
-- Re-runnable: `if not exists`, `create or replace`, policies and the trigger dropped and recreated, grants revoked first.

create table if not exists public.user_plays (
  id bigint generated always as identity primary key,
  person uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  ref text not null,
  title text not null default '',
  maker text not null default '',
  picture text,
  how text not null,
  where_label text not null default '',
  where_href text,
  added_by uuid references auth.users (id) on delete set null,
  added_by_name text not null default '',
  room_id uuid,
  queue_entry_id uuid,
  letter_id uuid,
  source_ref text,
  played_at timestamptz not null default now(),
  stopped_at timestamptz,
  left_at_seconds integer,
  length_seconds integer,
  constraint user_plays_kind check (kind in ('song', 'video', 'book')),
  constraint user_plays_ref check (char_length(ref) between 1 and 2048),
  constraint user_plays_title check (char_length(title) <= 200),
  constraint user_plays_maker check (char_length(maker) <= 100),
  constraint user_plays_picture check (picture is null or char_length(picture) <= 2048),
  constraint user_plays_how check (how in ('yourself', 'own_queue', 'room', 'letter', 'comment', 'post', 'profile', 'playlist', 'reader', 'not_recorded')),
  constraint user_plays_where_label check (char_length(where_label) <= 100),
  constraint user_plays_where_href check (where_href is null or char_length(where_href) <= 300),
  constraint user_plays_added_by_name check (char_length(added_by_name) <= 100),
  constraint user_plays_source_ref check (source_ref is null or char_length(source_ref) <= 300),
  constraint user_plays_left_at check (left_at_seconds is null or left_at_seconds >= 0),
  constraint user_plays_length check (length_seconds is null or length_seconds >= 0)
);

create index if not exists user_plays_recent on public.user_plays (person, played_at desc);
create index if not exists user_plays_room on public.user_plays (person, room_id, played_at) where room_id is not null;
create index if not exists user_plays_queue_row on public.user_plays (person, queue_entry_id) where queue_entry_id is not null;

alter table public.user_plays enable row level security;

drop policy if exists "own plays readable" on public.user_plays;
create policy "own plays readable" on public.user_plays
  for select to authenticated using (person = auth.uid());

drop policy if exists "own plays addable" on public.user_plays;
create policy "own plays addable" on public.user_plays
  for insert to authenticated
  with check (
    person = auth.uid()
    and not (select public.is_guest())
    and not (select public.history_paused())
    and played_at between now() - interval '1 minute' and now() + interval '1 minute'
  );

drop policy if exists "own plays changeable" on public.user_plays;
create policy "own plays changeable" on public.user_plays
  for update to authenticated
  using (person = auth.uid())
  with check (person = auth.uid() and not (select public.is_guest()));

drop policy if exists "own plays deletable" on public.user_plays;
create policy "own plays deletable" on public.user_plays
  for delete to authenticated using (person = auth.uid());

drop policy if exists "guests stay out" on public.user_plays;
create policy "guests stay out" on public.user_plays as restrictive for select to authenticated using (not (select public.is_guest()));

revoke all on public.user_plays from public, anon, authenticated;
grant select, insert, update, delete on public.user_plays to authenticated;

-- A change may only say where the play stopped: every other column stays as it was written.
create or replace function public.user_plays_keep()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.person := old.person;
  new.kind := old.kind;
  new.ref := old.ref;
  new.title := old.title;
  new.maker := old.maker;
  new.picture := old.picture;
  new.how := old.how;
  new.where_label := old.where_label;
  new.where_href := old.where_href;
  new.added_by := old.added_by;
  new.added_by_name := old.added_by_name;
  new.room_id := old.room_id;
  new.queue_entry_id := old.queue_entry_id;
  new.letter_id := old.letter_id;
  new.source_ref := old.source_ref;
  new.played_at := old.played_at;
  return new;
end;
$$;

drop trigger if exists user_plays_keep on public.user_plays;
create trigger user_plays_keep before update on public.user_plays
  for each row execute function public.user_plays_keep();

-- One play noted: a new row, or the row already made for the same thing reached the same way in the last 60 seconds
-- (or for the same room queue row in the last 6 hours).
-- Returns the row's id (null when nobody is signed in). Security invoker: a guest or a paused history is refused by the
-- rules above, not by this function.
create or replace function public.play_note(
  p_kind text,
  p_ref text,
  p_title text default '',
  p_maker text default '',
  p_picture text default null,
  p_how text default 'yourself',
  p_where_label text default '',
  p_where_href text default null,
  p_added_by uuid default null,
  p_added_by_name text default '',
  p_room uuid default null,
  p_queue_entry uuid default null,
  p_letter uuid default null,
  p_source_ref text default null,
  p_length integer default null
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  found_id bigint;
begin
  if auth.uid() is null then
    return null;
  end if;
  select p.id into found_id
  from public.user_plays p
  where p.person = auth.uid()
    and (
      (p_queue_entry is not null and p.queue_entry_id = p_queue_entry and p.played_at > now() - interval '6 hours')
      or (
        p.kind = p_kind
        and p.ref = left(p_ref, 2048)
        and p.how = p_how
        and p.room_id is not distinct from p_room
        and p.played_at > now() - interval '60 seconds'
      )
    )
  order by p.played_at desc
  limit 1;
  if found_id is not null then
    return found_id;
  end if;
  insert into public.user_plays (
    person, kind, ref, title, maker, picture, how, where_label, where_href, added_by, added_by_name,
    room_id, queue_entry_id, letter_id, source_ref, length_seconds
  )
  values (
    auth.uid(), p_kind, left(p_ref, 2048), left(coalesce(p_title, ''), 200), left(coalesce(p_maker, ''), 100),
    nullif(left(coalesce(p_picture, ''), 2048), ''), p_how, left(coalesce(p_where_label, ''), 100),
    nullif(left(coalesce(p_where_href, ''), 300), ''),
    (select pr.id from public.profiles pr where pr.id = p_added_by),
    left(coalesce(p_added_by_name, ''), 100),
    p_room, p_queue_entry, p_letter, nullif(left(coalesce(p_source_ref, ''), 300), ''),
    case when p_length is null or p_length < 0 then null else p_length end
  )
  returning id into found_id;
  return found_id;
end;
$$;

revoke all on function public.play_note(text, text, text, text, text, text, text, text, uuid, text, uuid, uuid, uuid, text, integer) from public, anon;
grant execute on function public.play_note(text, text, text, text, text, text, text, text, uuid, text, uuid, uuid, uuid, text, integer) to authenticated;

-- The fill-in (10B) ---------------------------------------------------------------------------------------------------

-- 1. The music bar's listen log: one song play per listen, titled from the site's own file lists.
insert into public.user_plays (person, kind, ref, title, maker, how, played_at)
select
  l.user_id,
  'song',
  l.track_src,
  left(coalesce(m.title, t.title, s.title, ''), 200),
  left(coalesce(m.credit, t.credit, s.credit, ''), 100),
  'not_recorded',
  l.listened_at
from public.music_listens l
join auth.users u on u.id = l.user_id and not coalesce(u.is_anonymous, false)
left join lateral (select mi.title, mi.credit from public.media_items mi where mi.src = l.track_src limit 1) m on true
left join lateral (select mt.title, mt.credit from public.music_tracks mt where mt.src = l.track_src limit 1) t on true
left join lateral (
  select ps.title, ps.credit from public.profile_song_versions ps where ps.src = l.track_src order by ps.created_at desc limit 1
) s on true
where not exists (
  select 1 from public.user_plays x
  where x.person = l.user_id and x.how = 'not_recorded' and x.ref = l.track_src and x.played_at = l.listened_at
);

-- 2. FOR YOU's lines for things played or read (one play at the last time; FOR YOU never kept the earlier ones). A song the
-- listen log already gave is left out.
insert into public.user_plays (person, kind, ref, title, maker, how, where_href, played_at)
select
  h.person,
  case h.kind when 'media' then 'video' else h.kind end,
  h.ref,
  h.title,
  h.maker,
  'not_recorded',
  case when h.kind = 'book' then left('/read/' || h.ref, 300) else null end,
  h.last_at
from public.user_history h
join auth.users u on u.id = h.person and not coalesce(u.is_anonymous, false)
where h.kind in ('media', 'book', 'song')
  and h.action in ('played', 'read', 'finished', 'skipped')
  and not (h.kind = 'song' and exists (select 1 from public.music_listens l where l.user_id = h.person and l.track_src = h.ref))
  and not exists (
    select 1 from public.user_plays x
    where x.person = h.person and x.how = 'not_recorded' and x.ref = h.ref and x.played_at = h.last_at
  );
