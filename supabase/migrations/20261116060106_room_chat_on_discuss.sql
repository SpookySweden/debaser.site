-- Room chat on the DISCUSS page (SPEC-room-chat-discuss.md; Luke's typed OK 2026-11-16: "OK, make it").
-- Through db:push:dry, then db:push.
-- Re-runnable: `if not exists`, functions replaced, grants re-said. No rows are changed or deleted.

-- 1. A room's switch, CHAT ON DISCUSSION, on by default (every room, past ones included). The host's cog turns it off.
--    The host's existing right to change their room's settings covers it; nobody else can.
alter table public.watch_rooms add column if not exists chat_on_discuss boolean not null default true;

-- 2. A person's switch, MY ROOM CHAT ON DISCUSSION PAGES, on by default (every account). Their own profile row, which only
--    they can change already.
alter table public.profiles add column if not exists room_chat_on_discuss boolean not null default true;
-- Profile columns are granted by name (20261105125422): a signed-in person can read their own switch back.
grant select (room_chat_on_discuss) on public.profiles to authenticated;

-- The room switch is the host's. A live room's host could already change their room's row, but an ended room is a record
-- nobody may change, and its host should still be able to take its chat off DISCUSS pages: this one function changes this one
-- column, for the room's host (or the host who started it), live or ended.
create or replace function public.watch_room_chat_on_discuss(room uuid, chat_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  -- (The rooms' guard trigger leaves this column alone and keeps an ended room ended.)
  update public.watch_rooms r set chat_on_discuss = chat_on
    where r.id = room and (r.host_id = auth.uid() or r.original_host_id = auth.uid());
  if not found then raise exception 'only the room''s host can change that'; end if;
end;
$$;
revoke all on function public.watch_room_chat_on_discuss(uuid, boolean) from public, anon;
grant execute on function public.watch_room_chat_on_discuss(uuid, boolean) to authenticated;

-- 3. Which MEDIA or KINO result a queue item came from (its id, e.g. `youtube:abc123` or `kino:603`), written when it is
--    added from a row. Older items have none and are found by their address instead.
alter table public.watch_queue add column if not exists web_ref text;
create index if not exists watch_queue_web_ref on public.watch_queue (web_ref) where web_ref is not null;
create index if not exists watch_queue_source_url on public.watch_queue (source_url) where source_url is not null;

-- 4. The one narrow way in: the chat lines said over one thing, from rooms and people whose switches are on. It returns only
--    what DISCUSS shows (the line's id, when it was sent, the name, the words, where in the video, guest or not) and nothing
--    else of any room: no room id, no queue, no canvas, no members. Hidden test accounts are left out, as from every list.
--    A signed-out visitor sees ANON for anybody who hides their name from visitors (the board's rule).
create or replace function public.discuss_room_chat(p_media_item_id uuid, p_web_ref text, p_urls text[])
returns table (id uuid, said_at timestamptz, author_id uuid, author_label text, body text, media_seconds numeric, guest boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id,
    m.created_at,
    case when auth.uid() is null and coalesce(p.show_name_to_visitors, true) = false then null else m.author_id end,
    case
      when auth.uid() is null and coalesce(p.show_name_to_visitors, true) = false then 'ANON'
      else m.author_label
    end,
    m.body,
    m.media_seconds,
    m.author_label like '% [GUEST]'
  from public.watch_messages m
  join public.watch_queue q on q.id = m.queue_entry_id
  join public.watch_rooms r on r.id = m.room_id
  left join public.profiles p on p.id = m.author_id
  where r.chat_on_discuss
    and coalesce(p.room_chat_on_discuss, true)
    and coalesce(p.is_hidden, false) = false
    and (
      (p_web_ref is not null and q.web_ref = p_web_ref)
      or (p_media_item_id is not null and q.media_item_id = p_media_item_id)
      or (p_urls is not null and q.source_url = any (p_urls))
    )
  order by m.created_at
  limit 500
$$;

revoke all on function public.discuss_room_chat(uuid, text, text[]) from public;
grant execute on function public.discuss_room_chat(uuid, text, text[]) to anon, authenticated;
