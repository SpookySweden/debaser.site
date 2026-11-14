-- FOR YOU's private history learns three more things a person can do, and one more kind of thing (Luke's OK,
-- 2026-11-14: "A: Yes, add them"), so YOUR YOUTUBE and FOR YOU follow what they watch:
--   - "what was done" may also be: skipped (a video started and closed within 30 seconds), more (MORE LIKE THIS) and
--     less (SHOW LESS FROM THIS CHANNEL), pressed on a result's feedback key.
--   - a new kind of row, maker: a YouTube channel or other maker by name, used only by SHOW LESS FROM THIS CHANNEL
--     (a maker row always says less, and nothing else does).
--
-- Nothing else changes, and no existing row is touched: only the owner can read, add, change or delete their rows; guests
-- and visitors are shut out; rows go after 90 days; 3,000 rows at most; PAUSE refuses new ones; ERASE removes them.
-- This replaces two check rules on user_history, adds one, and replaces history_note.
--
-- Which note wins on one row: opened < played = read < skipped < finished, a stronger one replacing a weaker one. The
-- three a person presses (more, less, not_for_me) replace anything, and only another press replaces a press.
-- Re-runnable: rules dropped and added by name, `create or replace`.

alter table public.user_history drop constraint if exists user_history_kind;
alter table public.user_history add constraint user_history_kind
  check (kind in ('media', 'song', 'book', 'thread', 'room', 'letter', 'lore', 'person', 'maker'));

alter table public.user_history drop constraint if exists user_history_action;
alter table public.user_history add constraint user_history_action
  check (action in ('opened', 'played', 'read', 'finished', 'not_for_me', 'skipped', 'more', 'less'));

alter table public.user_history drop constraint if exists user_history_maker_less;
alter table public.user_history add constraint user_history_maker_less
  check ((kind = 'maker') = (action = 'less'));

create or replace function public.history_note(
  p_kind text, p_ref text, p_title text, p_maker text, p_words text[], p_action text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  rank_of constant jsonb := '{"opened": 1, "played": 2, "read": 2, "skipped": 3, "finished": 4}';
  pressed constant text[] := array['more', 'less', 'not_for_me'];
begin
  if auth.uid() is null then
    return;
  end if;
  insert into public.user_history as h (person, kind, ref, title, maker, words, action)
  values (
    auth.uid(), p_kind, p_ref, left(coalesce(p_title, ''), 200), left(coalesce(p_maker, ''), 100),
    coalesce(p_words[1:12], '{}'), p_action
  )
  on conflict (person, kind, ref) do update set
    last_at = now(),
    title = excluded.title,
    maker = excluded.maker,
    words = case when coalesce(array_length(excluded.words, 1), 0) > 0 then excluded.words else h.words end,
    action = case
      when excluded.action = any (pressed) then excluded.action
      when h.action = any (pressed) then h.action
      when (rank_of ->> excluded.action)::int > (rank_of ->> h.action)::int then excluded.action
      else h.action
    end;
end;
$$;

revoke all on function public.history_note(text, text, text, text, text[], text) from public, anon;
grant execute on function public.history_note(text, text, text, text, text[], text) to authenticated;
