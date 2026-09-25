-- -----------------------------------------------------------------------------
-- The queues people broadcast: what one account is listening to, and who may listen too
-- -----------------------------------------------------------------------------
-- Run this whole file with `npm run db:push`. It is idempotent: running it twice changes nothing the
-- second time, and it drops no row.
--
-- Why: the player's queue was one account's own business and nowhere else. The board could show what
-- somebody *posted*; nothing could show what they were *listening to*. This is the table that makes a
-- queue shareable - and the note below is the part worth reading before the columns, because what it
-- does is narrower than "streaming".
--
-- **This is not streaming.** Nobody's audio leaves their machine. Every track already lives at a public
-- URL in the `mp3` bucket, so a shared queue is a *list of those URLs plus a position and a timestamp*,
-- and every listener's own browser fetches the same files and seeks to roughly the same place. That is
-- what makes the feature possible with no media server, no WebRTC and no `getUserMedia` - none of which
-- this repository has, and none of which a static site on Vercel could host anyway.
--
-- Two consequences, both of them the app's business rather than the schema's, but both decided here:
--
--   LIVE   the listener's position is within a few seconds of where the host *should* be. Worked out
--          from `position_seconds` plus the age of `updated_at`, so it needs no clock agreement between
--          two machines - which is the whole reason the position is stored as a pair rather than as one
--          absolute instant.
--   DELAY  anything behind that. `CATCH UP` is then `playbackRate` above 1 until the listener is back
--          inside the window, which is a real mechanism rather than a pretence: the audio speeds up and
--          settles down, exactly as a tape would.
--
-- One row per account, because a person is listening to one thing at a time. `user_id` is therefore the
-- primary key and not a surrogate id, which also means "go public" is an upsert and cannot leave two
-- queues behind for one account.

-- -----------------------------------------------------------------------------
-- 1. What one account is playing, when it is public
-- -----------------------------------------------------------------------------

create table if not exists public.music_queues (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- The track's `src`, exactly as `music_likes.track_id` and the player's own queue key it: a storage
  -- path, a manifest id or a slug. Not a foreign key, for the reason the likes table gives - the shelf
  -- is read by listing the bucket, so a hand-dropped file is a real track with no row anywhere.
  track_id text not null,
  -- Which file in the account's own queue it is, so a listener can be told "3 of 12" rather than only
  -- what is on now. An index rather than the whole list: the listener does not follow the host's queue
  -- order, it follows *what the host is playing*, and the list itself is already on the shelf.
  track_index integer not null default 0,
  track_total integer not null default 1,
  -- Where in that track the host was, and when they were there. Stored as a pair rather than as one
  -- absolute instant so that no two machines have to agree on the time.
  position_seconds numeric not null default 0,
  -- True while the account is choosing to be public. The row survives going private so that coming back
  -- does not lose the track - but a private row is readable by nobody but its owner, so "public" is a
  -- real switch and not a label.
  is_public boolean not null default false,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint music_queues_position_not_negative check (position_seconds >= 0),
  constraint music_queues_counts_sane check (track_total >= 1 and track_index >= 0 and track_index < track_total)
);

alter table public.music_queues enable row level security;

-- The read rule is the feature. A public queue is readable by anybody - that is what broadcasting means
-- and it is what the Queues tab lists. A private one is the owner's alone, the same as a like.
--
-- `auth.uid()` is null for a guest, so `user_id = auth.uid()` is false rather than an error, and a
-- signed-out reader sees exactly the public rows and nothing else.
drop policy if exists "queues readable when public or own" on public.music_queues;
create policy "queues readable when public or own" on public.music_queues
  for select using (is_public or auth.uid() = user_id);

-- One's own queue is one's own to publish, retract and move along.
drop policy if exists "queues insertable by owner" on public.music_queues;
create policy "queues insertable by owner" on public.music_queues
  for insert with check (auth.uid() = user_id);

drop policy if exists "queues updatable by owner" on public.music_queues;
create policy "queues updatable by owner" on public.music_queues
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "queues removable by owner" on public.music_queues;
create policy "queues removable by owner" on public.music_queues
  for delete using (auth.uid() = user_id);

-- The browser asks for the public ones, most recently moved first. Partial, because a private row is
-- never in that list and an index over rows nobody reads is a cost with no reader.
create index if not exists music_queues_public_idx
  on public.music_queues (updated_at desc) where is_public;

-- -----------------------------------------------------------------------------
-- 2. A move stamps `updated_at` without the app having to remember to
-- -----------------------------------------------------------------------------
-- The listener's idea of "live" is worked out from `updated_at`, so it has to be the database's clock
-- and not a browser's. A trigger rather than a default, because `on update` is not a thing a default
-- can do - and rather than a column the app sets, because a missed write there would silently make
-- every listener think the host had stopped.

create or replace function public.touch_music_queue()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists music_queues_touch on public.music_queues;
create trigger music_queues_touch
  before update on public.music_queues
  for each row execute function public.touch_music_queue();

-- -----------------------------------------------------------------------------
-- 3. The realtime wire
-- -----------------------------------------------------------------------------
-- The Queues tab is a list that has to move on its own: somebody going public, changing track or
-- stopping should appear without a reload. That needs the table in the publication, and a channel bound
-- to a table that is *not* in it reports SUBSCRIBED and then delivers nothing at all - the silent
-- failure `supabase/README.md` describes at length under Realtime.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'music_queues'
  ) then
    alter publication supabase_realtime add table public.music_queues;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Done. To check it landed:
--   select user_id, track_id, is_public, position_seconds, updated_at from public.music_queues;
--
-- And the policies, which are the part worth checking - a queue that is readable while it is private is
-- the whole feature broken in the direction that matters:
--   select policyname, cmd, qual from pg_policies where tablename = 'music_queues' order by cmd;
--
-- And that the publication took, because its failure is silent:
--   select tablename from pg_publication_tables where pubname = 'supabase_realtime'
--    and tablename = 'music_queues';
-- -----------------------------------------------------------------------------
