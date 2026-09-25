-- -----------------------------------------------------------------------------
-- 20. Forum MP3s, and the audio tags the file directory filters on.
-- -----------------------------------------------------------------------------
-- Run this whole file in the Supabase SQL Editor on a project that has already had
-- `supabase/schema.sql` run against it. Re-running it is safe: every column here is
-- `if not exists` and nothing is dropped.
--
-- Two halves of the same feature:
--
--   1. `forum_threads.track` / `forum_comments.track` - the MP3 filed with a post or a
--      reply, as { src, title, credit, tags, length }. jsonb rather than four columns
--      because the player and the /music directory read it as one thing
--      (app/lib/forum/types.ts, `ForumTrack`), and a row written before this column
--      existed is simply null - no post has to change.
--
--   2. `music_tracks.tags` - how a track sounds (`HIP HOP`, `LO FI`, `AMBIENT`). The
--      tags are what the file directory filters on, and what the inline player prints
--      under a track in a thread (app/lib/audio/tags.ts spells and caps them, so the
--      site and the table agree on what a tag is).
--
-- Nothing here needs a new policy: the audio goes into the `mp3` bucket, whose
-- policies (schema.sql, section 14) already keep one account out of another account's
-- folder, and a post's `track` column is written through the same insert/update
-- policies the post itself uses - it is part of what the row says, not a separate
-- store. No new table, no new bucket, and no realtime subscription: a post arriving
-- over the board's existing channel brings its track with it.

-- 1. The MP3 filed with a post, and with a reply.

alter table public.forum_threads add column if not exists track jsonb;
alter table public.forum_comments add column if not exists track jsonb;

-- 2. Audio tags on the shelf's rows.

alter table public.music_tracks add column if not exists tags jsonb not null default '[]'::jsonb;

-- 3. Check it landed.

--   select column_name, data_type from information_schema.columns
--     where table_schema = 'public' and table_name in ('forum_threads', 'forum_comments', 'music_tracks')
--       and column_name in ('track', 'tags');
--   select id, title, tags from public.music_tracks order by created_at desc limit 20;
