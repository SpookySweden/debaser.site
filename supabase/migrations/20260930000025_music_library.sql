-- -----------------------------------------------------------------------------
-- A reader's own music: what they liked, and the lists they made
-- -----------------------------------------------------------------------------
-- Paste this whole file into the Supabase SQL editor and run it. It is idempotent: running it twice
-- changes nothing the second time. Nothing here drops or rewrites a row.
--
-- Why: the archive is a shelf anybody can play, and there was nowhere for an account to say *what it
-- thinks of it*. The player's queue is shared, the directory's filters are shared, and a track was
-- either on the shelf or not. A favourite is the first thing on this site that is one account's
-- opinion of another's file - which makes it the first music table with an owner and a policy.
--
-- Two tables, and the split is the two things a reader can do:
--
--   music_likes      one row per (account, track). A like is a fact, so it is a row.
--   music_playlists  one row per list, with its items in a `jsonb` column rather than a join table,
--                    because a playlist is short, ordered and always read whole - a third table would
--                    buy a join and a second round trip for an ordering `jsonb` already gives.
--
-- Nothing here holds a track's title or credit. A like points at `music_tracks.src` (the same key the
-- player queues on), so a file that gets re-titled is not a favourite pointing at a stale name, and a
-- file that is deleted leaves a like the app simply cannot draw (`resolveLikes` drops it).

-- -----------------------------------------------------------------------------
-- 1. What one account liked
-- -----------------------------------------------------------------------------

create table if not exists public.music_likes (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The track's `src`: a storage path, a manifest id, or a slug. Deliberately *not* a foreign key to
  -- `music_tracks`: the shelf is read by listing the bucket, so a file dropped in by hand is a real
  -- track with no row anywhere, and a key would refuse to let anybody like it.
  track_id text not null,
  liked_at timestamptz not null default now(),
  -- One account cannot like the same file twice, which is what makes the heart a switch rather than a
  -- counter. The primary key is the pair, so the database answers "already liked" rather than the app
  -- having to ask first.
  primary key (user_id, track_id)
);

alter table public.music_likes enable row level security;

-- Every policy on this table is the same sentence, and it is the whole rule: this is *your* list.
-- There is no public read, and that is deliberate - what somebody liked is theirs, the same way their
-- messages are. A track's play count would be public; a person's taste is not.
drop policy if exists "likes readable by owner" on public.music_likes;
create policy "likes readable by owner" on public.music_likes
  for select using (auth.uid() = user_id);

drop policy if exists "likes writable by owner" on public.music_likes;
create policy "likes writable by owner" on public.music_likes
  for insert with check (auth.uid() = user_id);

drop policy if exists "likes removable by owner" on public.music_likes;
create policy "likes removable by owner" on public.music_likes
  for delete using (auth.uid() = user_id);

create index if not exists music_likes_user_idx on public.music_likes (user_id, liked_at desc);

-- -----------------------------------------------------------------------------
-- 2. The lists one account made
-- -----------------------------------------------------------------------------

create table if not exists public.music_playlists (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  -- `[{ "trackId": "...", "addedAt": "..." }]`, oldest first. Checked for shape rather than for
  -- contents: the app already refuses to draw a row it cannot resolve a track for, and a constraint
  -- strict enough to validate every item would have to know what the shelf holds.
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint music_playlists_items_is_a_list check (jsonb_typeof(items) = 'array')
);

alter table public.music_playlists enable row level security;

drop policy if exists "playlists readable by owner" on public.music_playlists;
create policy "playlists readable by owner" on public.music_playlists
  for select using (auth.uid() = owner_id);

drop policy if exists "playlists insertable by owner" on public.music_playlists;
create policy "playlists insertable by owner" on public.music_playlists
  for insert with check (auth.uid() = owner_id);

drop policy if exists "playlists updatable by owner" on public.music_playlists;
create policy "playlists updatable by owner" on public.music_playlists
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "playlists removable by owner" on public.music_playlists;
create policy "playlists removable by owner" on public.music_playlists
  for delete using (auth.uid() = owner_id);

create index if not exists music_playlists_owner_idx on public.music_playlists (owner_id, created_at);

-- -----------------------------------------------------------------------------
-- Done. To check it landed:
--   select user_id, track_id, liked_at from public.music_likes order by liked_at desc limit 20;
--   select owner_id, name, jsonb_array_length(items) as items from public.music_playlists;
--
-- And to check the policies are actually on, which is the part worth checking:
--   select tablename, policyname, cmd from pg_policies
--    where tablename in ('music_likes', 'music_playlists') order by tablename, cmd;
-- -----------------------------------------------------------------------------
