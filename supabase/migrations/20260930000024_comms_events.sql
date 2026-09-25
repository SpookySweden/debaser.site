-- -----------------------------------------------------------------------------
-- Game challenges, recorded in the conversation they belong to
-- -----------------------------------------------------------------------------
-- Paste this whole file into the Supabase SQL editor and run it. It is idempotent: running it twice
-- changes nothing the second time. Nothing here drops or rewrites a row.
--
-- Why: a challenge between two accounts already raised a notification (the bell) and lived in the
-- arcade's own store (`lib/games`), but it left no trace in the conversation between those two
-- accounts. So "who asked me for a game, and what did I say" was answerable only from the arcade, and
-- the DM - which is where the two of them already talk - read as though nothing had happened.
--
-- A challenge is news between two accounts, so it is filed as a *message*: same table, same ordering,
-- same read markers, same realtime. Three nullable columns say when a line is an event rather than
-- something typed. Existing rows are untouched - null `event_kind` is "a message like any other", which
-- is exactly what they are.

alter table public.comms_messages
  add column if not exists event_kind text,
  add column if not exists game_id text,
  add column if not exists invite_id text;

-- The three are a set: an event that cannot name its game is not worth drawing as one, and a plate
-- reading `CHALLENGED :: ` has lost the one thing it was there to say. The app drops a partial row
-- rather than rendering half of it (`toMessage` in app/lib/comms/supabase-comms-repository.ts); this
-- constraint is what stops the partial row being written in the first place.
--
-- Added in a guarded block because `add constraint` has no `if not exists`, and re-running this file
-- has to be safe.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'comms_messages_event_is_whole'
  ) then
    alter table public.comms_messages
      add constraint comms_messages_event_is_whole check (
        (event_kind is null and game_id is null and invite_id is null)
        or (event_kind is not null and game_id is not null and invite_id is not null)
      );
  end if;
end
$$;

-- The kinds a build understands. A *later* build may add a fourth, so the app treats an unfamiliar
-- kind as an ordinary message rather than inventing a plate for it; this list is what stops a typo
-- being filed as an event nobody can draw.
--
-- Dropped and re-added rather than guarded, because widening a check constraint is the one change this
-- file might need to make in future and `drop ... if exists` makes that a one-line edit.
alter table public.comms_messages
  drop constraint if exists comms_messages_event_kind_known;

alter table public.comms_messages
  add constraint comms_messages_event_kind_known check (
    event_kind is null or event_kind in ('invite', 'answer', 'cancel')
  );

-- No new policy and no new grant. A message is already insertable only by a participant and only
-- signed by themselves (`author_id = auth.uid()`), and an event *is* a message - so the rule that
-- stops an account writing into somebody else's conversation is the rule that stops it filing a
-- challenge there too. Adding a policy here would be adding a second answer to a question already
-- answered.

-- -----------------------------------------------------------------------------
-- Done. To check it landed:
--   select thread_id, author_name, event_kind, game_id, created_at
--     from public.comms_messages
--    where event_kind is not null
--    order by created_at desc;
-- -----------------------------------------------------------------------------
