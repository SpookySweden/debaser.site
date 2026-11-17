-- Room chat on DISCUSS, private rooms anonymised to outsiders (ROOMCHAT, Luke 2026-11-17: "previous things said in own room
-- are non private by default and appear as comments on the specified media and timestamped, in a public steam room its the
-- same but in a private one its anonymised to anyone but who was in the room").
-- Latest before this: 20261116060106_room_chat_on_discuss.sql. Through db:push:dry, then db:push.
-- Re-runnable: the one function is dropped and made again by name, grants re-said. No table, column or row is changed.
--
-- What changes, line by line (`watch_messages.privacy_at_write`, stamped by the database when the line was said: 'open' when
-- the room was open to anyone then, 'private' for a private or password room):
--   * A line said while the room was open: as before, the speaker's name to everyone (ANON to a signed-out visitor when that
--     person hides their name from visitors, the board's rule).
--   * A line said while the room was private, read by someone who was in the room (its host, the host who started it, a
--     member not REMOVED, or the speaker): the name, as they saw it in the room.
--   * The same line read by anyone else, signed in or not: no name and no id. The label is the speaker's number in that room
--     (`ANON-3`, the number private room outlines already show outsiders), `private_room` and `anonymous` say so, and a
--     guest is not marked GUEST.
--   * Hidden test accounts: left out for everyone outside the room, as before; shown to those in it (who saw them there).
-- Unchanged: both switches (a room's CHAT ON DISCUSSION, a person's MY ROOM CHAT ON DISCUSSION PAGES; off still takes the
-- lines away, past ones included), only lines said while something played, nothing of the room itself, at most 500.

drop function if exists public.discuss_room_chat(uuid, text, text[]);
create function public.discuss_room_chat(p_media_item_id uuid, p_web_ref text, p_urls text[])
returns table (id uuid, said_at timestamptz, author_id uuid, author_label text, body text, media_seconds numeric, guest boolean, private_room boolean, anonymous boolean)
language sql
stable
security definer
set search_path = public
as $$
  with said as (
    select
      m.id,
      m.created_at,
      m.author_id,
      m.author_label,
      m.body,
      m.media_seconds,
      m.privacy_at_write <> 'open' as private_line,
      coalesce(p.show_name_to_visitors, true) as name_to_visitors,
      coalesce(p.is_hidden, false) as hidden,
      w.anon_number,
      -- Who was in the room: the speaker, its host, the host who started it, or a member who was not REMOVED.
      auth.uid() is not null and (
        m.author_id = auth.uid()
        or r.host_id = auth.uid()
        or r.original_host_id = auth.uid()
        or exists (select 1 from public.watch_members v where v.room_id = r.id and v.user_id = auth.uid() and v.removed_at is null)
      ) as insider
    from public.watch_messages m
    join public.watch_queue q on q.id = m.queue_entry_id
    join public.watch_rooms r on r.id = m.room_id
    left join public.profiles p on p.id = m.author_id
    left join public.watch_members w on w.room_id = m.room_id and w.user_id = m.author_id
    where r.chat_on_discuss
      and coalesce(p.room_chat_on_discuss, true)
      and (
        (p_web_ref is not null and q.web_ref = p_web_ref)
        or (p_media_item_id is not null and q.media_item_id = p_media_item_id)
        or (p_urls is not null and q.source_url = any (p_urls))
      )
  ),
  shown as (
    select said.*, said.private_line and not said.insider as hide_name
    from said
    where not said.hidden or said.insider
  )
  select
    s.id,
    s.created_at,
    case
      when s.hide_name then null
      when auth.uid() is null and not s.name_to_visitors then null
      else s.author_id
    end,
    case
      when s.hide_name then coalesce('ANON-' || s.anon_number::text, 'ANON')
      when auth.uid() is null and not s.name_to_visitors then 'ANON'
      else s.author_label
    end,
    s.body,
    s.media_seconds,
    case when s.hide_name then false else s.author_label like '% [GUEST]' end,
    s.private_line,
    s.hide_name
  from shown s
  order by s.created_at
  limit 500
$$;

revoke all on function public.discuss_room_chat(uuid, text, text[]) from public;
grant execute on function public.discuss_room_chat(uuid, text, text[]) to anon, authenticated;

-- Afterwards (read-only):
--   select pg_get_function_result('public.discuss_room_chat(uuid, text, text[])'::regprocedure);
