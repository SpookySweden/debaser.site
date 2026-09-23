-- =============================================================================
-- DEBASER.SITE - complete database schema
-- =============================================================================
--
-- Paste this whole file into the Supabase SQL editor (Dashboard -> SQL Editor ->
-- New query -> Run) against the project whose URL and publishable key are in
-- .env.local. It is written to be re-runnable: every table, index, trigger and
-- policy is created with `if not exists` / `drop ... if exists` first, so running
-- it twice is safe and running it after a change only adds what is new.
--
-- What it creates, and which part of the site reads it:
--
--   profiles                  the account's public face: name, name colour, bio,
--                             place line, visibility switches, presence
--   profile_avatar_versions   the append-only picture history (and its comments)
--   profile_tags              tags other accounts gave somebody
--   profile_comments          comments on a profile, and on one picture version
--   forum_threads             the board's posts (app/lib/forum/supabase-repository.ts)
--   forum_comments            replies, including the auto-filed item threads
--   comms_threads/messages/reads  direct messages between two accounts
--
-- It also plants the house account's profile row (debaser.site in dark blue), gives
-- every new account - email or Google - a profile and a name of its own, hands the
-- house account the power to edit or remove anybody's post (`is_admin`), lets it ban
-- an account outright - stopping its writing and hiding what it already wrote
-- (`banned_at`, section 12) - and makes a public storage bucket for uploaded
-- profile pictures.
--
-- After running it:
--   1. Authentication -> Users -> Add user: email admin1212@debaser.site, the
--      password you want for the house account, "Auto Confirm User" on.
--      The trigger creates its profile; section 8 below gives it the dark blue name.
--   2. Authentication -> Providers -> Google: enable it with the client id/secret
--      from Google Cloud, and add your site's /account URL to the redirect list.
--   3. Put the switches in .env.local (see .env.example) and restart.
--
-- Nothing here is dropped or overwritten except policies/triggers of the same name.
-- =============================================================================

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- -----------------------------------------------------------------------------
-- 1. profiles
-- -----------------------------------------------------------------------------
-- One row per account, keyed by the auth user so `auth.uid()` is the ownership
-- test everywhere below. Everything except `last_seen_at` / `is_online` is the
-- owner's own business; those two are read by everybody, which is what the lamp
-- beside a username needs.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Anonymous',
  -- One of the sixteen swatches in app/lib/profile/name-colours.ts, or null for
  -- the page's own black. The check keeps a hand-written colour off a username.
  name_colour text check (name_colour is null or name_colour ~ '^#[0-9a-fA-F]{6}$'),
  bio text not null default '',
  location text not null default '',
  -- What visitors may see. Tags are somebody else's writing about you, so they start
  -- hidden; comments are the reason a profile is a page rather than a card, so they start
  -- open and the owner closes what they would rather not read. The application defaults
  -- match these (`DEFAULT_VISIBILITY` in app/lib/profile/visibility.ts).
  show_tags boolean not null default false,
  show_profile_comments boolean not null default true,
  show_avatar_comments boolean not null default true,
  -- The picture on display. Deliberately not a foreign key: the versions table
  -- points at this one, and a circular pair of keys would make deletes awkward.
  current_version_id uuid,
  -- Presence: written by that account's own browser (heartbeat + goodbye).
  last_seen_at timestamptz default now(),
  is_online boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Public read: the board prints these names on every post, and the mock store
-- behaves the same way. The `show_*` flags are applied when the page is drawn
-- (app/lib/profile/visibility.ts), and the stricter rules for the tables that hang
-- off this one are below.
drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles for select using (true);

drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own" on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "profiles delete own" on public.profiles;
create policy "profiles delete own" on public.profiles for delete using (auth.uid() = id);

-- `updated_at` keeps its own books: one trigger function shared by every table
-- that has the column, rather than each write path remembering to set it.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- 2. profile_avatar_versions
-- -----------------------------------------------------------------------------
-- The picture history is append-only: replacing the drawing, and even restoring an
-- older one, files a new version, so the comments written against a drawing always
-- keep pointing at the drawing they were written against.

create table if not exists public.profile_avatar_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- 1-based and never reused: the number a comment is stamped with.
  version integer not null,
  src text not null,
  alt text not null default '',
  note text not null default '',
  restored_from_version integer,
  created_at timestamptz not null default now(),
  unique (user_id, version)
);

alter table public.profile_avatar_versions enable row level security;

drop policy if exists "avatar versions readable" on public.profile_avatar_versions;
create policy "avatar versions readable" on public.profile_avatar_versions for select using (true);

drop policy if exists "avatar versions insert own" on public.profile_avatar_versions;
create policy "avatar versions insert own" on public.profile_avatar_versions
  for insert with check (auth.uid() = user_id);

-- No update policy: a filed version is never rewritten, which is the whole point
-- of the history. Deleting the account takes the rows with it.

-- -----------------------------------------------------------------------------
-- 3. profile_tags
-- -----------------------------------------------------------------------------
-- Tags are given by other accounts. They are hidden until the owner decides to
-- show them.

create table if not exists public.profile_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  label text not null,
  colour text,
  given_by uuid references auth.users (id) on delete set null,
  -- The giver's name as it was: a snapshot, so a tag never goes anonymous when
  -- somebody deletes their account.
  given_by_label text not null default 'Anonymous',
  given_at timestamptz not null default now(),
  hidden boolean not null default true
);

alter table public.profile_tags enable row level security;

-- A hidden tag is the owner's business: the giver and the owner can read it, and a
-- visible one is public like the rest of the profile.
drop policy if exists "profile tags readable" on public.profile_tags;
create policy "profile tags readable" on public.profile_tags
  for select using (hidden = false or user_id = auth.uid() or given_by = auth.uid());

-- Anybody signed in may give a tag (a guest's tag is filed with no author, which
-- the site shows as Anonymous).
drop policy if exists "profile tags insert" on public.profile_tags;
create policy "profile tags insert" on public.profile_tags
  for insert with check (given_by is null or given_by = auth.uid());

-- Only the owner of the page decides what shows.
drop policy if exists "profile tags update owner" on public.profile_tags;
create policy "profile tags update owner" on public.profile_tags
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The page's owner, or whoever gave it, can take it back off.
drop policy if exists "profile tags delete" on public.profile_tags;
create policy "profile tags delete" on public.profile_tags
  for delete using (user_id = auth.uid() or given_by = auth.uid());

-- -----------------------------------------------------------------------------
-- 4. profile_comments
-- -----------------------------------------------------------------------------
-- Two kinds: on the profile itself, and on one picture version. Private until the
-- owner opens them up.

create table if not exists public.profile_comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('profile', 'avatar')),
  avatar_version_id uuid references public.profile_avatar_versions (id) on delete set null,
  author_id uuid references auth.users (id) on delete set null,
  author_label text not null default 'Anonymous',
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists profile_comments_user_idx on public.profile_comments (user_id, created_at);

alter table public.profile_comments enable row level security;

drop policy if exists "profile comments readable" on public.profile_comments;
create policy "profile comments readable" on public.profile_comments
  for select using (
    user_id = auth.uid()
    or author_id = auth.uid()
    or (kind = 'profile' and exists (
      select 1 from public.profiles p where p.id = user_id and p.show_profile_comments
    ))
    or (kind = 'avatar' and exists (
      select 1 from public.profiles p where p.id = user_id and p.show_avatar_comments
    ))
  );

drop policy if exists "profile comments insert" on public.profile_comments;
create policy "profile comments insert" on public.profile_comments
  for insert with check (author_id is null or author_id = auth.uid());

-- Only the author edits or removes what they wrote.
drop policy if exists "profile comments update author" on public.profile_comments;
create policy "profile comments update author" on public.profile_comments
  for update using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists "profile comments delete author" on public.profile_comments;
create policy "profile comments delete author" on public.profile_comments
  for delete using (author_id = auth.uid() or user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 5. forum_threads / forum_comments  (the board)
-- -----------------------------------------------------------------------------
-- A thread is either written straight onto the board (anchor_kind = 'board') or
-- auto-filed by an item's comment box, in which case (anchor_kind, anchor_id) is
-- that item and only one such thread may exist. Guests post with no author.
-- These are the tables app/lib/forum/supabase-repository.ts reads.

create table if not exists public.forum_threads (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  author_id uuid references auth.users (id) on delete set null,
  author_label text not null default 'Anonymous',
  anchor_kind text not null,
  anchor_id text not null,
  anchor_label text not null,
  tags jsonb not null default '[]'::jsonb,
  media_src text,
  media_alt text,
  media_width integer,
  media_height integer,
  created_at timestamptz not null default now()
);

create table if not exists public.forum_comments (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.forum_threads (id) on delete cascade,
  body text not null,
  author_id uuid references auth.users (id) on delete set null,
  author_label text not null default 'Anonymous',
  tags jsonb not null default '[]'::jsonb,
  -- The reply this one answers, null for a reply to the post itself.
  parent_id uuid references public.forum_comments (id) on delete cascade,
  media_src text,
  media_alt text,
  media_width integer,
  media_height integer,
  created_at timestamptz not null default now()
);

-- One auto-generated thread per asset / text box (the board's own posts are free
-- to repeat an anchor, so the index skips them).
create unique index if not exists forum_threads_anchor_key
  on public.forum_threads (anchor_kind, anchor_id)
  where anchor_kind <> 'board';

create index if not exists forum_comments_thread_idx on public.forum_comments (thread_id, created_at);
create index if not exists forum_threads_created_idx on public.forum_threads (created_at desc);

alter table public.forum_threads enable row level security;
alter table public.forum_comments enable row level security;

-- Public read, but authors may only edit or delete their own rows.
drop policy if exists "forum_threads readable" on public.forum_threads;
create policy "forum_threads readable" on public.forum_threads for select using (true);

drop policy if exists "forum_threads insert own" on public.forum_threads;
create policy "forum_threads insert own" on public.forum_threads
  for insert with check (author_id is null or author_id = auth.uid());

drop policy if exists "forum_threads update own" on public.forum_threads;
create policy "forum_threads update own" on public.forum_threads
  for update using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists "forum_threads delete own" on public.forum_threads;
create policy "forum_threads delete own" on public.forum_threads for delete using (author_id = auth.uid());

drop policy if exists "forum_comments readable" on public.forum_comments;
create policy "forum_comments readable" on public.forum_comments for select using (true);

drop policy if exists "forum_comments insert own" on public.forum_comments;
create policy "forum_comments insert own" on public.forum_comments
  for insert with check (author_id is null or author_id = auth.uid());

drop policy if exists "forum_comments update own" on public.forum_comments;
create policy "forum_comments update own" on public.forum_comments
  for update using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists "forum_comments delete own" on public.forum_comments;
create policy "forum_comments delete own" on public.forum_comments for delete using (author_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 6. comms_threads / comms_messages / comms_reads  (direct messages)
-- -----------------------------------------------------------------------------
-- A conversation is between exactly two accounts, and its id is derived from the
-- pair (`dm:<low id>|<high id>`), so opening one is a lookup rather than a search
-- and both sides agree on it without asking. Read by
-- app/lib/comms/supabase-comms-repository.ts.

create table if not exists public.comms_threads (
  id text primary key,
  participant_a uuid not null references auth.users (id) on delete cascade,
  participant_b uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (participant_a, participant_b),
  check (participant_a <> participant_b)
);

create table if not exists public.comms_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id text not null references public.comms_threads (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  -- The author's name as it was when they wrote it, for a reader who cannot
  -- resolve the account (the console resolves names live where it can).
  author_name text not null default 'Anonymous',
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.comms_reads (
  thread_id text not null references public.comms_threads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create index if not exists comms_messages_thread_idx on public.comms_messages (thread_id, created_at);
create index if not exists comms_threads_updated_idx on public.comms_threads (updated_at desc);

-- `updated_at` is what the conversation list sorts by, so a new message has to
-- bump it - the trigger keeps that from depending on the writer remembering.
drop trigger if exists comms_threads_touch_updated_at on public.comms_threads;
create trigger comms_threads_touch_updated_at
  before update on public.comms_threads
  for each row execute function public.touch_updated_at();

alter table public.comms_threads enable row level security;
alter table public.comms_messages enable row level security;
alter table public.comms_reads enable row level security;

-- A conversation is readable only by the two accounts in it: the rule the mock
-- store keeps by construction, kept here by the database.
drop policy if exists "comms threads readable by participants" on public.comms_threads;
create policy "comms threads readable by participants" on public.comms_threads
  for select using (auth.uid() in (participant_a, participant_b));

drop policy if exists "comms threads insert by participant" on public.comms_threads;
create policy "comms threads insert by participant" on public.comms_threads
  for insert with check (auth.uid() in (participant_a, participant_b));

drop policy if exists "comms threads update by participant" on public.comms_threads;
create policy "comms threads update by participant" on public.comms_threads
  for update using (auth.uid() in (participant_a, participant_b))
  with check (auth.uid() in (participant_a, participant_b));

drop policy if exists "comms messages readable by participants" on public.comms_messages;
create policy "comms messages readable by participants" on public.comms_messages
  for select using (
    exists (
      select 1 from public.comms_threads t
      where t.id = thread_id and auth.uid() in (t.participant_a, t.participant_b)
    )
  );

-- A message can only be written by one of the two, and only signed by its writer.
drop policy if exists "comms messages insert own" on public.comms_messages;
create policy "comms messages insert own" on public.comms_messages
  for insert with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.comms_threads t
      where t.id = thread_id and auth.uid() in (t.participant_a, t.participant_b)
    )
  );

-- A read marker belongs to the account it is about, and to nobody else.
drop policy if exists "comms reads own" on public.comms_reads;
create policy "comms reads own" on public.comms_reads
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 7. every new account gets a profile
-- -----------------------------------------------------------------------------
-- Sign-ups and Google sign-ins both land in auth.users, and both should arrive on
-- the site with a profile already there: the customiser, the board's byline and
-- the directory all read that row. `user_metadata.display_name` is what the sign-up
-- form sends; a Google account brings its own name in `full_name` / `name`, and an
-- account with neither falls back to the part of its address before the @.
--
-- The house account is handled here too, rather than only by the backfill in
-- section 8: it should not matter whether the account is created before or after
-- this script is first run (see app/lib/auth/builtin-account.ts).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  chosen_name text;
  is_house boolean;
begin
  is_house := lower(coalesce(new.email, '')) = 'admin1212@debaser.site';

  chosen_name := case
    when is_house then 'debaser.site'
    else coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Anonymous'
    )
  end;

  insert into public.profiles (id, display_name, name_colour)
  values (new.id, chosen_name, case when is_house then '#000080' else null end)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- The account name a post is *signed* with lives on the account itself, not on the
-- profile row: app/lib/auth/supabase-auth.ts reads `user_metadata.display_name`, and
-- an account made in the dashboard has none, so a post would go out signed with the
-- address. This runs before the row is written, so the house account carries its
-- name from its first moment whatever order things happened in - and section 8
-- below backfills one that already exists.
create or replace function public.claim_house_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(new.email, '')) = 'admin1212@debaser.site' then
    new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object('display_name', 'debaser.site');
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_before on auth.users;
create trigger on_auth_user_created_before
  before insert on auth.users
  for each row execute function public.claim_house_name();

-- -----------------------------------------------------------------------------
-- 8. the house account (backfill)
-- -----------------------------------------------------------------------------
-- debaser.site signs the archive's own posts and wears the dark blue swatch, which
-- the trigger above now bakes in for any house account created from here on. This
-- is the backfill for one that was made before that: it only fills in what the
-- trigger left as default, so re-running never undoes a choice the owner has since
-- made by hand.

update public.profiles
set display_name = 'debaser.site',
    name_colour = '#000080',
    updated_at = now()
where id in (select id from auth.users where lower(email) = 'admin1212@debaser.site')
  and (display_name = 'admin1212' or display_name = 'Anonymous' or display_name = '');

-- The same seed for an account that arrived with a name already (a Google sign-in),
-- where only the colour is still missing:
update public.profiles
set name_colour = coalesce(name_colour, '#000080'),
    updated_at = now()
where id in (select id from auth.users where lower(email) = 'admin1212@debaser.site')
  and display_name = 'debaser.site';

-- The name the site *signs posts* with comes from the account itself, not from the
-- profile row: app/lib/auth/supabase-auth.ts reads `user_metadata.display_name`, and
-- an account made in the dashboard has none, so a post would be signed with the
-- address. Google and email sign-ups set it themselves; this is for the house.
update auth.users
set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
  || jsonb_build_object('display_name', 'debaser.site')
where lower(email) = 'admin1212@debaser.site'
  and coalesce(raw_user_meta_data ->> 'display_name', '') <> 'debaser.site';

-- -----------------------------------------------------------------------------
-- 9. realtime
-- -----------------------------------------------------------------------------
-- What makes the board, the conversation list and the lamps move without a
-- reload: the repositories subscribe to `postgres_changes` on exactly these
-- tables. Added one at a time, and only when missing, so this block is safe to
-- re-run.
--
-- Every table a channel is bound to has to be here, and that is not a preference:
-- a table outside the publication does not fail on its own, it takes the whole
-- channel down with it. The channel still reports SUBSCRIBED and then delivers
-- nothing from any of its tables, which looks exactly like "nobody has written to
-- you yet". That is what `comms_reads` did while it was bound but unpublished, and
-- why the comms page used to need a reload to show a message.

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'forum_threads') then
    alter publication supabase_realtime add table public.forum_threads;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'forum_comments') then
    alter publication supabase_realtime add table public.forum_comments;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comms_threads') then
    alter publication supabase_realtime add table public.comms_threads;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comms_messages') then
    alter publication supabase_realtime add table public.comms_messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comms_reads') then
    alter publication supabase_realtime add table public.comms_reads;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles') then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 10. moderation: the house account may edit or remove what anybody filed
-- -----------------------------------------------------------------------------
-- The board takes posts from guests, so somebody has to be able to take one back
-- down without opening the SQL editor. That somebody is the house account, and
-- `is_admin()` is the single answer to "is this visitor the admin" - the policies
-- read it rather than repeating the address. It has to run `security definer`
-- because `auth.users` is not readable by the anon or authenticated roles.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid() and lower(u.email) = 'admin1212@debaser.site'
  );
$$;

-- These are permissive policies, so they OR with the ones above: an author keeps
-- their own rights, and the admin gets everybody's.

drop policy if exists "forum_threads moderate" on public.forum_threads;
create policy "forum_threads moderate" on public.forum_threads
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "forum_threads remove" on public.forum_threads;
create policy "forum_threads remove" on public.forum_threads
  for delete using (public.is_admin());

drop policy if exists "forum_comments moderate" on public.forum_comments;
create policy "forum_comments moderate" on public.forum_comments
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "forum_comments remove" on public.forum_comments;
create policy "forum_comments remove" on public.forum_comments
  for delete using (public.is_admin());

-- A tag or a comment on somebody's profile belongs to them, but abuse on it is
-- still abuse: the admin may take one down, not rewrite it.
drop policy if exists "profile_tags admin remove" on public.profile_tags;
create policy "profile_tags admin remove" on public.profile_tags
  for delete using (public.is_admin());

drop policy if exists "profile_comments admin remove" on public.profile_comments;
create policy "profile_comments admin remove" on public.profile_comments
  for delete using (public.is_admin());

-- -----------------------------------------------------------------------------
-- 11. profile pictures: a storage bucket for the drawings
-- -----------------------------------------------------------------------------
-- Uploaded drawings live in Supabase Storage rather than on the site's disk, so
-- they survive a deploy and work on a host with a read-only filesystem. The bucket
-- is public - a profile picture is shown to everybody who can see the profile -
-- served from /storage/v1/object/public/avatars/...
--
-- The path carries the owner's id (`<user id>/avatar-v3-....png`) and every write
-- policy reads that first segment, which is what keeps one account out of another
-- account's folder. Account ids are uuids, so the folder name is safe as a path.
--
-- The size limit and the accepted types mirror what the site itself insists on
-- before it will send anything (`MAX_AVATAR_BYTES` and the type list in
-- app/lib/profile/avatar-catalogue.ts, checked by ./lib/profile/avatar-upload.ts),
-- so the browser refuses an oversized drawing with a plain message and the bucket
-- only ever sees files the site has already accepted. Keep the two in step: the
-- scratch check asserts this number matches the constant.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars readable" on storage.objects;
create policy "avatars readable" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars filed by owner" on storage.objects;
create policy "avatars filed by owner" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars replaced by owner" on storage.objects;
create policy "avatars replaced by owner" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars removed by owner or admin" on storage.objects;
create policy "avatars removed by owner or admin" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- -----------------------------------------------------------------------------
-- 12. banning an account
-- -----------------------------------------------------------------------------
-- The board takes posts from guests, so a bad one has to be stoppable without
-- deleting the account behind it. A ban is three stamps on the profile row:
-- `banned_at` (when), `banned_reason` (the admin's own words) and `banned_by` (who
-- did it). Only the house account may set them - the policy at the end of this
-- section - so nothing else in the site can write a ban.
--
-- A ban does two things at once:
--
--   * it stops the account writing anywhere: posts, replies, profile edits,
--     picture uploads, tags, comments and messages. Every write policy below is its
--     own earlier definition with `not public.is_banned()` added, re-created by
--     name, so the refusal happens in the database rather than in the UI;
--   * it hides what the account already wrote. The two board policies that were
--     `using (true)` now skip rows whose author is banned, so existing posts and
--     replies disappear for everybody. The house account is exempt from that half
--     on purpose: it still sees them (the board marks them `[ BANNED ]`), which is
--     what makes an unban or a cleanup possible at all.
--
-- The columns are added rather than created, so this section is safe to re-run on
-- a database that already holds profiles and posts.

alter table public.profiles add column if not exists banned_at timestamptz;
alter table public.profiles add column if not exists banned_reason text not null default '';
alter table public.profiles add column if not exists banned_by uuid references auth.users (id) on delete set null;

-- Who is banned: `is_banned()` asks about whoever is calling, `is_banned(<id>)`
-- about somebody else, which is what the read policies need. Definer and stable,
-- like `is_admin()`, so it answers the same whoever asks - and so a policy on
-- profiles can call it without recursing through profiles' own policies.
create or replace function public.is_banned(user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = user_id and p.banned_at is not null
  );
$$;

-- The house account may write anybody's profile row; that is how a ban is set and
-- lifted. Permissive, like the section above, so it ORs with the owner's own access.
drop policy if exists "profiles moderated by admin" on public.profiles;
create policy "profiles moderated by admin" on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- 12a. writing is refused to a banned account, everywhere
-- -----------------------------------------------------------------------------
-- Each of these is the policy as its own section defined it, with the ban check
-- added, re-created by name. Re-running the script therefore leaves the board,
-- profiles, tags, comments, messages and the picture bucket all saying the same
-- thing: a banned account may still read, and may write nothing.
--
-- The house account is not exempt here, and does not need to be: it keeps its own
-- rights through the `is_admin()` policies in section 10, which are permissive, so
-- a banned admin could still moderate (and would still be able to unban itself).

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
  for update using (auth.uid() = id and not public.is_banned())
  with check (auth.uid() = id);

drop policy if exists "avatar versions insert own" on public.profile_avatar_versions;
create policy "avatar versions insert own" on public.profile_avatar_versions
  for insert with check (auth.uid() = user_id and not public.is_banned());

drop policy if exists "profile tags insert" on public.profile_tags;
create policy "profile tags insert" on public.profile_tags
  for insert with check ((given_by is null or given_by = auth.uid()) and not public.is_banned());

drop policy if exists "profile comments insert" on public.profile_comments;
create policy "profile comments insert" on public.profile_comments
  for insert with check ((author_id is null or author_id = auth.uid()) and not public.is_banned());

drop policy if exists "forum_threads insert own" on public.forum_threads;
create policy "forum_threads insert own" on public.forum_threads
  for insert with check ((author_id is null or author_id = auth.uid()) and not public.is_banned());

drop policy if exists "forum_threads update own" on public.forum_threads;
create policy "forum_threads update own" on public.forum_threads
  for update using (author_id = auth.uid() and not public.is_banned())
  with check (author_id = auth.uid());

drop policy if exists "forum_comments insert own" on public.forum_comments;
create policy "forum_comments insert own" on public.forum_comments
  for insert with check ((author_id is null or author_id = auth.uid()) and not public.is_banned());

drop policy if exists "forum_comments update own" on public.forum_comments;
create policy "forum_comments update own" on public.forum_comments
  for update using (author_id = auth.uid() and not public.is_banned())
  with check (author_id = auth.uid());

drop policy if exists "comms threads insert by participant" on public.comms_threads;
create policy "comms threads insert by participant" on public.comms_threads
  for insert with check (auth.uid() in (participant_a, participant_b) and not public.is_banned());

drop policy if exists "comms threads update by participant" on public.comms_threads;
create policy "comms threads update by participant" on public.comms_threads
  for update using (auth.uid() in (participant_a, participant_b) and not public.is_banned())
  with check (auth.uid() in (participant_a, participant_b));

drop policy if exists "comms messages insert own" on public.comms_messages;
create policy "comms messages insert own" on public.comms_messages
  for insert with check (
    author_id = auth.uid()
    and not public.is_banned()
    and exists (
      select 1 from public.comms_threads t
      where t.id = thread_id and auth.uid() in (t.participant_a, t.participant_b)
    )
  );

drop policy if exists "avatars filed by owner" on storage.objects;
create policy "avatars filed by owner" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not public.is_banned()
  );

drop policy if exists "avatars replaced by owner" on storage.objects;
create policy "avatars replaced by owner" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not public.is_banned()
  )
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- 12b. reading hides a banned author's posts and replies
-- -----------------------------------------------------------------------------
-- The half that makes a ban more than a locked door: what the account already filed
-- stops being shown to anybody. Guests write with no author id at all, so their
-- rows are never caught by this.
--
-- Realtime note: a page that is already open keeps the rows it has until it
-- reloads, because the ban is an update to a profile row and the board is watching
-- the posts. Nothing new arrives from that account, and the next load is clean.

drop policy if exists "forum_threads readable" on public.forum_threads;
create policy "forum_threads readable" on public.forum_threads
  for select using ((author_id is null or not public.is_banned(author_id)) or public.is_admin());

drop policy if exists "forum_comments readable" on public.forum_comments;
create policy "forum_comments readable" on public.forum_comments
  for select using ((author_id is null or not public.is_banned(author_id)) or public.is_admin());

-- -----------------------------------------------------------------------------
-- 13. group conversations
-- -----------------------------------------------------------------------------
-- Direct messages are a pair of accounts, and the thread id is derived from the pair
-- so both sides agree on it without a lookup. A group is everything else: any number
-- of accounts, a name, and whoever is in it decides who else is. Rather than a second
-- set of tables, `comms_threads` grew a `kind` and a membership table, so one screen
-- and one repository read both.
--
-- `participant_a` / `participant_b` stay, and stay the rule for a conversation of two
-- (`dm:` threads keep their derived id and their unique pair); they are simply empty
-- on a group, which is what `drop not null` is for. Every conversation that already
-- exists is written into the membership table too, so membership answers for both
-- kinds from here on - and the policies accept either, so nothing already stored
-- stops working.

alter table public.comms_threads add column if not exists kind text not null default 'dm';
alter table public.comms_threads add column if not exists name text not null default '';
alter table public.comms_threads add column if not exists created_by uuid references auth.users (id) on delete set null;
alter table public.comms_threads alter column participant_a drop not null;
alter table public.comms_threads alter column participant_b drop not null;

alter table public.comms_threads drop constraint if exists comms_threads_kind_check;
alter table public.comms_threads add constraint comms_threads_kind_check check (kind in ('dm', 'group'));

create table if not exists public.comms_members (
  thread_id text not null references public.comms_threads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create index if not exists comms_members_user_idx on public.comms_members (user_id);

alter table public.comms_members enable row level security;

-- Who is in a conversation. Definer and stable, so a policy on comms_members - or on
-- the messages - can ask it without recursing through comms_members' own policy.
create or replace function public.is_comms_member(thread text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.comms_members m
    where m.thread_id = thread and m.user_id = auth.uid()
  );
$$;

-- Every conversation that already existed becomes a membership row per side.
insert into public.comms_members (thread_id, user_id)
  select id, participant_a from public.comms_threads where participant_a is not null
  on conflict do nothing;

insert into public.comms_members (thread_id, user_id)
  select id, participant_b from public.comms_threads where participant_b is not null
  on conflict do nothing;

-- Reading a conversation: you are in it (membership), or you are one of its pair - a
-- dm: filed before the membership table existed, or by a client that predates it.
drop policy if exists "comms threads readable by participants" on public.comms_threads;
create policy "comms threads readable by participants" on public.comms_threads
  for select using (
    auth.uid() in (participant_a, participant_b) or public.is_comms_member(id)
  );

drop policy if exists "comms threads insert by participant" on public.comms_threads;
create policy "comms threads insert by participant" on public.comms_threads
  for insert with check (
    not public.is_banned()
    and (auth.uid() in (participant_a, participant_b) or created_by = auth.uid())
  );

drop policy if exists "comms threads update by participant" on public.comms_threads;
create policy "comms threads update by participant" on public.comms_threads
  for update using (
    not public.is_banned()
    and (auth.uid() in (participant_a, participant_b) or public.is_comms_member(id))
  )
  with check (auth.uid() in (participant_a, participant_b) or public.is_comms_member(id));

-- The member list: readable by the people in it, and only they may change it. Adding
-- yourself is how a group is created; adding anybody else needs you to be in it.
drop policy if exists "comms members readable by members" on public.comms_members;
create policy "comms members readable by members" on public.comms_members
  for select using (public.is_comms_member(thread_id) or user_id = auth.uid());

drop policy if exists "comms members added by members" on public.comms_members;
create policy "comms members added by members" on public.comms_members
  for insert with check (
    not public.is_banned()
    and (user_id = auth.uid() or public.is_comms_member(thread_id))
  );

drop policy if exists "comms members leave" on public.comms_members;
create policy "comms members leave" on public.comms_members
  for delete using (user_id = auth.uid());

-- Closing a group: whoever opened it can take it down (messages cascade), and either
-- side of a dm can clear the conversation they are in.
drop policy if exists "comms threads deleted by the creator" on public.comms_threads;
create policy "comms threads deleted by the creator" on public.comms_threads
  for delete using (created_by = auth.uid() or auth.uid() in (participant_a, participant_b));

-- Messages follow the same rule, with the ban check section 12 added.
drop policy if exists "comms messages readable by participants" on public.comms_messages;
create policy "comms messages readable by participants" on public.comms_messages
  for select using (
    exists (
      select 1 from public.comms_threads t
      where t.id = thread_id
        and (auth.uid() in (t.participant_a, t.participant_b) or public.is_comms_member(t.id))
    )
  );

drop policy if exists "comms messages insert own" on public.comms_messages;
create policy "comms messages insert own" on public.comms_messages
  for insert with check (
    author_id = auth.uid()
    and not public.is_banned()
    and exists (
      select 1 from public.comms_threads t
      where t.id = thread_id
        and (auth.uid() in (t.participant_a, t.participant_b) or public.is_comms_member(t.id))
    )
  );

drop policy if exists "comms reads own" on public.comms_reads;
create policy "comms reads own" on public.comms_reads
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Realtime: a group you are added to should appear without a reload.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comms_members'
  ) then
    alter publication supabase_realtime add table public.comms_members;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 14. the music shelf: the mp3 bucket, and the tracks filed on it
-- -----------------------------------------------------------------------------
-- Tracks live in Supabase Storage, so they survive a deploy and play on a host with a
-- read-only disk. The bucket is public - a track on the shelf is played by everybody
-- who can open the page - served from /storage/v1/object/public/mp3/...
--
-- The path carries the owner's id (`<user id>/song-v3-....mp3`, and the music page's
-- own uploads beside it) and every write policy reads that first segment, which is what
-- keeps one account out of another account's folder. The 20MB limit and the types
-- mirror MAX_TRACK_BYTES and the list in app/lib/audio/catalogue.ts.
--
-- The player reads the *bucket*, not this table: a file dropped in by hand is on the
-- shelf the moment it lands, and `music_tracks` is what gives a file its title and its
-- credit. Keep the two in step.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mp3', 'mp3', true, 20971520, array['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/flac'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "mp3 readable" on storage.objects;
create policy "mp3 readable" on storage.objects
  for select using (bucket_id = 'mp3');

drop policy if exists "mp3 filed by owner" on storage.objects;
create policy "mp3 filed by owner" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'mp3' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "mp3 replaced by owner" on storage.objects;
create policy "mp3 replaced by owner" on storage.objects
  for update to authenticated
  using (bucket_id = 'mp3' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'mp3' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "mp3 removed by owner or admin" on storage.objects;
create policy "mp3 removed by owner or admin" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'mp3'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

create table if not exists public.music_tracks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  credit text not null default '',
  kind text not null default 'UPLOADED TO THE SHELF',
  -- The public URL, which is what a row and a bucket listing are matched on.
  src text not null unique,
  length text not null default '',
  uploaded_by uuid references auth.users (id) on delete set null,
  uploaded_by_label text not null default 'Unknown',
  created_at timestamptz not null default now()
);

create index if not exists music_tracks_created_idx on public.music_tracks (created_at desc);

alter table public.music_tracks enable row level security;

drop policy if exists "music tracks readable" on public.music_tracks;
create policy "music tracks readable" on public.music_tracks for select using (true);

drop policy if exists "music tracks filed by uploader" on public.music_tracks;
create policy "music tracks filed by uploader" on public.music_tracks
  for insert with check (
    not public.is_banned()
    and (uploaded_by is null or uploaded_by = auth.uid())
  );

drop policy if exists "music tracks removed by uploader or admin" on public.music_tracks;
create policy "music tracks removed by uploader or admin" on public.music_tracks
  for delete using (uploaded_by = auth.uid() or public.is_admin());

-- -----------------------------------------------------------------------------
-- 15. profile songs: the one track beside a picture
-- -----------------------------------------------------------------------------
-- One track per account, with the same append-only history the drawings keep: filing
-- a new one adds a version, and restoring an older one files a version that copies it -
-- so a comment about a mix always keeps pointing at that mix. The file itself lives in
-- the `mp3` bucket above, under the owner's own folder.
--
-- `song_version_id` on `profile_comments` is the track's answer to `avatar_version_id`,
-- and `kind` grows a third value; the read policy gains the matching case so a track's
-- comments obey the same switch the picture's do (`show_song_comments`).

alter table public.profiles add column if not exists show_song_comments boolean not null default true;
-- Deliberately not a foreign key, for the same reason `current_version_id` is not: the
-- versions table already points at the profile, and a circular pair would make deletes
-- awkward.
alter table public.profiles add column if not exists current_song_version_id uuid;

-- Comments on by default, for the databases that were created when they were off.
--
-- The defaults above only decide what a *new* profile row gets, and every row that already
-- exists kept `false` - which is why a page could say "comments held back by the owner"
-- without the owner ever having chosen it. Setting the column default fixes accounts made
-- from here on; the second statement is the one that matters for an archive that is already
-- running, and it is deliberately a separate statement so it can be left out.
alter table public.profiles alter column show_profile_comments set default true;
alter table public.profiles alter column show_avatar_comments set default true;

update public.profiles set show_profile_comments = true where show_profile_comments is not true;

create table if not exists public.profile_song_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  version integer not null,
  src text not null,
  title text not null default '',
  credit text not null default '',
  note text not null default '',
  restored_from_version integer,
  created_at timestamptz not null default now(),
  unique (user_id, version)
);

alter table public.profile_song_versions enable row level security;

drop policy if exists "song versions readable" on public.profile_song_versions;
create policy "song versions readable" on public.profile_song_versions for select using (true);

drop policy if exists "song versions insert own" on public.profile_song_versions;
create policy "song versions insert own" on public.profile_song_versions
  for insert with check (not public.is_banned() and auth.uid() = user_id);

-- No update policy: a filed track is never rewritten, which is the point of the
-- history. Deleting the account takes the rows with it.

alter table public.profile_comments
  add column if not exists song_version_id uuid references public.profile_song_versions (id) on delete set null;

alter table public.profile_comments drop constraint if exists profile_comments_kind_check;
alter table public.profile_comments add constraint profile_comments_kind_check
  check (kind in ('profile', 'avatar', 'song'));

drop policy if exists "profile comments readable" on public.profile_comments;
create policy "profile comments readable" on public.profile_comments
  for select using (
    user_id = auth.uid()
    or author_id = auth.uid()
    or (kind = 'profile' and exists (
      select 1 from public.profiles p where p.id = user_id and p.show_profile_comments
    ))
    or (kind = 'avatar' and exists (
      select 1 from public.profiles p where p.id = user_id and p.show_avatar_comments
    ))
    or (kind = 'song' and exists (
      select 1 from public.profiles p where p.id = user_id and p.show_song_comments
    ))
  );

-- Nothing subscribes to `music_tracks` or `profile_song_versions` over realtime: filing
-- a song also updates `profiles`, which the profile channel already watches, and that is
-- what makes a track appear on an open page.



-- -----------------------------------------------------------------------------
-- 16. check it landed
-- -----------------------------------------------------------------------------
-- Run these on their own after the script; each should answer without an error.
--
--   select tablename, rowsecurity from pg_tables
--     where schemaname = 'public' order by tablename;
--   select tablename, policyname, cmd from pg_policies
--     where schemaname = 'public' order by tablename, policyname;
--   select id, display_name, name_colour, banned_at from public.profiles;
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets;
--   select policyname, cmd from pg_policies
--     where schemaname = 'storage' order by policyname;
--   -- which policies carry the ban check (should be seventeen: fifteen writes and
--   -- the two board read policies):
--   select policyname, cmd from pg_policies
--     where schemaname in ('public', 'storage')
--       and coalesce(qual, '') || coalesce(with_check, '') like '%is_banned%'
--     order by policyname;

-- 16. A group belongs to whoever opened it.
--
-- The report: somebody invited to a group renamed it and claimed it as his own. Both are a
-- direct write to `public.comms_threads` - `name` and `created_by` - and the update policy
-- said yes to either, because it asked only "are you in this conversation". Confirmed against
-- this project before the fix, as a member, writing the values that were already there:
--
--   a member writes the group name            ALLOWED :: 1 row(s) written
--   a member writes the ownership column      ALLOWED :: 1 row(s) written
--
-- The same policy let a member add *himself* to any group he could name ("adding yourself" was
-- allowed for its own sake, so the creator could get into a group they had just made), which
-- is a reading hole as well as an ownership one: being in a group is what makes its messages
-- readable.
--
-- Three layers, in the order they can be trusted:
--
--   1. the client may write exactly one column, `updated_at` - the stamp `sendMessage` puts on
--      a conversation. Every other column is granted away, so a PATCH of `name` is refused by
--      the table itself, before a policy is consulted at all;
--   2. a trigger refuses a change to the metadata unless the caller is the owner (or the house
--      account, which repairs what it must). A policy re-created by hand later cannot quietly
--      re-open the hole;
--   3. the changes that should happen go through functions that check first - `rename_group`,
--      `transfer_group_ownership`, `remove_group_member`, `leave_group` - and ownership only
--      moves two ways: the owner hands it over, or the owner leaves and it passes to whoever
--      has been in the group longest.
--
-- Re-running this file is safe: every statement replaces what it finds.

-- 1. One column of a thread belongs to the client.

revoke update on public.comms_threads from anon, authenticated;
grant update (updated_at) on public.comms_threads to authenticated;

-- 2. Groups can be opened at all: section 12 re-created this policy without the `created_by`
--    case, and a group has no pair to be "in" - its members cannot exist before it does.

drop policy if exists "comms threads insert by participant" on public.comms_threads;
create policy "comms threads insert by participant" on public.comms_threads
  for insert with check (
    not public.is_banned()
    and (auth.uid() in (participant_a, participant_b) or created_by = auth.uid())
  );

-- Who owns a conversation: the account that opened it, or either side of a dm. Definer and
-- stable, like `is_comms_member`, so a policy can ask it without recursing through the
-- threads' own policies.

create or replace function public.is_comms_owner(thread text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.comms_threads t
    where t.id = thread
      and (t.created_by = auth.uid() or auth.uid() in (t.participant_a, t.participant_b))
  );
$$;

-- 3. Adding people: anybody in it may add somebody else; adding *yourself* only works in a
--    conversation you opened, which is what gets a new group's creator into their own group.

drop policy if exists "comms members added by members" on public.comms_members;
create policy "comms members added by members" on public.comms_members
  for insert with check (
    not public.is_banned()
    and (
      (user_id = auth.uid() and public.is_comms_owner(thread_id))
      or public.is_comms_member(thread_id)
    )
  );

-- 4. The guard: nothing touches a conversation's metadata but its owner. `auth.uid()` inside a
--    trigger is still the caller's, whoever's privileges the function body runs with, so this
--    holds for a definer function, a policy and a console session alike. A null caller is the
--    SQL editor or the service role - the way a repair is made - and is left alone.

create or replace function public.comms_threads_guard_metadata()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if new.created_by is distinct from old.created_by and new.created_by is not null then
    if not exists (
      select 1 from public.comms_members m
      where m.thread_id = new.id and m.user_id = new.created_by
    ) then
      raise exception 'the owner of a conversation has to be in it' using errcode = 'check_violation';
    end if;
  end if;

  if new.name is distinct from old.name
     or new.kind is distinct from old.kind
     or new.created_by is distinct from old.created_by
     or new.participant_a is distinct from old.participant_a
     or new.participant_b is distinct from old.participant_b then
    if caller is not null and caller is distinct from old.created_by and not public.is_admin() then
      raise exception 'only the owner of a group may change it' using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists comms_threads_guard_metadata on public.comms_threads;
create trigger comms_threads_guard_metadata
  before update on public.comms_threads
  for each row execute function public.comms_threads_guard_metadata();


-- 5. The four things that may change a group, each checking for itself. They are definer
--    functions so that the column grant above cannot stand in their way, and they are the only
--    door: the app calls these rather than writing the table.

-- Renaming: the owner's, or the house account's when something has to be put right.
create or replace function public.rename_group(thread text, new_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  trimmed text := btrim(coalesce(new_name, ''));
begin
  if not (public.is_comms_owner(thread) or public.is_admin()) then
    raise exception 'only the owner may rename a group' using errcode = 'insufficient_privilege';
  end if;

  if trimmed = '' or length(trimmed) > 40 then
    raise exception 'a group name is between 1 and 40 characters' using errcode = 'check_violation';
  end if;

  update public.comms_threads set name = trimmed where id = thread and kind = 'group';
end;
$$;

-- Handing it over: the owner's choice, to somebody already in the group.
create or replace function public.transfer_group_ownership(thread text, to_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_comms_owner(thread) or public.is_admin()) then
    raise exception 'only the owner may hand a group over' using errcode = 'insufficient_privilege';
  end if;

  if to_user is null
     or not exists (select 1 from public.comms_members m where m.thread_id = thread and m.user_id = to_user) then
    raise exception 'a group can only be handed to somebody in it' using errcode = 'check_violation';
  end if;

  if public.is_banned(to_user) then
    raise exception 'that account is banned' using errcode = 'check_violation';
  end if;

  update public.comms_threads set created_by = to_user where id = thread and kind = 'group';
end;
$$;

-- Leaving: anybody in it. The owner leaving passes the group to whoever has been in it longest,
-- and the last member out takes the group with them - a group nobody is in cannot be read by
-- anybody, so leaving it behind would only be litter.
create or replace function public.leave_group(thread text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  leaver uuid := auth.uid();
  successor uuid;
begin
  if leaver is null then
    raise exception 'leaving needs a signed-in account' using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.comms_members m where m.thread_id = thread and m.user_id = leaver
  ) then
    raise exception 'you are not in this conversation' using errcode = 'check_violation';
  end if;

  delete from public.comms_members m where m.thread_id = thread and m.user_id = leaver;

  if exists (select 1 from public.comms_threads t where t.id = thread and t.created_by = leaver) then
    select m.user_id into successor
    from public.comms_members m
    where m.thread_id = thread
    order by m.joined_at, m.user_id
    limit 1;

    if successor is null then
      delete from public.comms_threads t where t.id = thread;
    else
      update public.comms_threads set created_by = successor where id = thread;
    end if;
  end if;
end;
$$;

-- Taking somebody else out: the owner's (or the house account's). You can always take yourself
-- out by leaving.
create or replace function public.remove_group_member(thread text, user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_comms_owner(thread) or public.is_admin()) then
    raise exception 'only the owner may remove a member' using errcode = 'insufficient_privilege';
  end if;

  if user_id = auth.uid() then
    perform public.leave_group(thread);
    return;
  end if;

  delete from public.comms_members m where m.thread_id = thread and m.user_id = user_id;
end;
$$;

-- The app reaches these with the signed-in role, and nothing else may.
revoke all on function public.rename_group(text, text) from public, anon;
revoke all on function public.transfer_group_ownership(text, uuid) from public, anon;
revoke all on function public.leave_group(text) from public, anon;
revoke all on function public.remove_group_member(text, uuid) from public, anon;

grant execute on function public.rename_group(text, text) to authenticated;
grant execute on function public.transfer_group_ownership(text, uuid) to authenticated;
grant execute on function public.leave_group(text) to authenticated;
grant execute on function public.remove_group_member(text, uuid) to authenticated;

-- 6. Putting right what was taken.
--
-- Ownership on this project reads correctly for the group in the report
-- (`grp:3f7e8deb-bb01-4424-8692-14e252d10409` is owned by 640d9861..., the account that opened
-- it), so nothing needs repairing today. If a group was taken, the owner is one statement away -
-- the SQL editor is not a client, so the guard above steps aside for it:
--
--   update public.comms_threads
--      set created_by = '<the account that opened it>'
--    where id = 'grp:...' and kind = 'group';
--
-- The house account can also do it from the app once this file is in, through
-- `transfer_group_ownership()`, which accepts it as the moderator.

-- -----------------------------------------------------------------------------
-- 17. Notifications: who was tagged, and who was answered.
-- -----------------------------------------------------------------------------
-- Also shipped on its own as supabase/migrations/20260923_notifications.sql, for a project that
-- has already had the rest of this file run against it.
--
-- One table, `public.forum_notifications`, one row per account told: a post that names somebody
-- with `@name` files a `'tag'`, and a reply files a `'reply'` for whoever wrote the post or the
-- comment it answers. The row carries enough to draw the whole menu - who did it, which post, a
-- snippet of the words, and when - so the bell never has to read the board to explain itself.
--
-- Why it is its own table rather than a column on the board: a post is read by everybody, a
-- notification is read by one account. A tag has to be a row that exactly one account can list,
-- mark seen and delete - which is what RLS is for. Read by
-- app/lib/notifications/supabase-notifications-repository.ts.

create table if not exists public.forum_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 'tag': somebody named them. 'reply': somebody answered them.
  kind text not null check (kind in ('tag', 'reply')),
  actor_id uuid references auth.users (id) on delete set null,
  actor_name text not null default 'Anonymous',
  thread_id uuid references public.forum_threads (id) on delete cascade,
  thread_title text not null default '',
  body text not null default '',
  created_at timestamptz not null default now(),
  -- Null while unread: that is the dot on the bell, and the row that draws white.
  read_at timestamptz
);

create index if not exists forum_notifications_user_idx
  on public.forum_notifications (user_id, created_at desc);

alter table public.forum_notifications enable row level security;

drop policy if exists "forum_notifications readable by recipient" on public.forum_notifications;
create policy "forum_notifications readable by recipient" on public.forum_notifications
  for select using (user_id = auth.uid());

drop policy if exists "forum_notifications inserted by actor" on public.forum_notifications;
create policy "forum_notifications inserted by actor" on public.forum_notifications
  for insert with check (
    not public.is_banned()
    and actor_id = auth.uid()
    and user_id <> auth.uid()
  );

drop policy if exists "forum_notifications marked read by recipient" on public.forum_notifications;
create policy "forum_notifications marked read by recipient" on public.forum_notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "forum_notifications deleted by recipient" on public.forum_notifications;
create policy "forum_notifications deleted by recipient" on public.forum_notifications
  for delete using (user_id = auth.uid());

-- Realtime, guarded the way section 9 does it, so this block stays safe to re-run.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'forum_notifications'
  ) then
    alter publication supabase_realtime add table public.forum_notifications;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 18. Pinned posts: the moderator's mark, and how long it lasts.
-- -----------------------------------------------------------------------------
-- Also shipped on its own as supabase/migrations/20260924_forum_pins.sql, for a project that has
-- already had the rest of this file run against it.
--
-- A pin holds one post at the top of the board and leads the wire, until a set time runs out or
-- forever. It is a row of its own rather than a column on the thread because it is not part of
-- what was written - it is the archive's decision about somebody's post. `expires_at` null means
-- forever; nothing sweeps a lapsed pin up, the client simply stops counting it
-- (app/lib/forum/pins.ts), so a pin does not depend on a scheduled job to stop working.
--
-- Who may pin: the house account, and only it - the same `is_admin()` that lets it edit or remove
-- a post - and the row is signed with the account that took it. Read by
-- app/lib/forum/supabase-repository.ts.

create table if not exists public.forum_pins (
  thread_id uuid primary key references public.forum_threads (id) on delete cascade,
  pinned_by uuid references auth.users (id) on delete set null,
  pinned_by_label text not null default 'debaser.site',
  pinned_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists forum_pins_active_idx on public.forum_pins (pinned_at desc);

alter table public.forum_pins enable row level security;

drop policy if exists "forum_pins readable" on public.forum_pins;
create policy "forum_pins readable" on public.forum_pins
  for select using (true);

drop policy if exists "forum_pins pinned by admin" on public.forum_pins;
create policy "forum_pins pinned by admin" on public.forum_pins
  for insert with check (public.is_admin() and pinned_by = auth.uid());

drop policy if exists "forum_pins changed by admin" on public.forum_pins;
create policy "forum_pins changed by admin" on public.forum_pins
  for update using (public.is_admin()) with check (public.is_admin() and pinned_by = auth.uid());

drop policy if exists "forum_pins removed by admin" on public.forum_pins;
create policy "forum_pins removed by admin" on public.forum_pins
  for delete using (public.is_admin());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'forum_pins'
  ) then
    alter publication supabase_realtime add table public.forum_pins;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 19. Pinned comments on a profile: the owner's mark, and what it may not touch.
-- -----------------------------------------------------------------------------
-- Also shipped on its own as supabase/migrations/20260926_profile_comment_pins.sql, for a
-- project that has already had the rest of this file run against it.
--
-- The board's pin in miniature, and without a deadline. Pinning a comment on your own profile does
-- one thing: it takes the leading row of every run of three on that profile's wire
-- (app/lib/profile/feed.ts), so a remark the page wants read keeps coming back round as the strip
-- goes past. Nothing sweeps a pin up - it stays until the owner takes it off.
--
-- It is a pair of columns on the comment rather than a table of its own, which is the opposite of
-- what `forum_pins` does above, deliberately. A board pin is the *archive's* decision about
-- somebody else's post and outlives edits to it, while a profile pin is the page owner's own mark
-- on a comment that lives on that page and dies with it: one row per comment, two columns, nothing
-- to join. `pinned_at` is there because pins lead the wire in turn and the newest takes the first
-- turn.
--
-- Who may pin: the profile's owner, on any comment their page carries - the remarks on the profile
-- itself, and the ones left on the picture and the track, because the feed that runs under the
-- columns carries all three (app/lib/profile/feed.ts). The update policy below is what lets that
-- write through, and the guard trigger is what keeps it a pin rather than an edit - a policy
-- cannot say which columns a write may touch, and without the trigger the owner could rewrite what
-- somebody said about them.

alter table public.profile_comments
  add column if not exists pinned boolean not null default false;

alter table public.profile_comments
  add column if not exists pinned_at timestamptz;

-- The wire reads a profile's comments with the pinned ones to hand, newest pin first.
create index if not exists profile_comments_pinned_idx
  on public.profile_comments (user_id, pinned_at desc) where pinned;

drop policy if exists "profile comments pinned by owner" on public.profile_comments;
create policy "profile comments pinned by owner" on public.profile_comments
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- The guard. `auth.uid()` inside a trigger is still the caller's, whoever's privileges the body
-- runs with (the same note section 16 makes), and a null caller is the SQL editor or the service
-- role - the way a repair is made - and is left alone.
create or replace function public.profile_comments_guard_pin()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if new.user_id is distinct from old.user_id
     or new.kind is distinct from old.kind
     or new.author_id is distinct from old.author_id
     or new.author_label is distinct from old.author_label
     or new.body is distinct from old.body
     or new.created_at is distinct from old.created_at
     or new.avatar_version_id is distinct from old.avatar_version_id
     or new.song_version_id is distinct from old.song_version_id then
    if caller is not null and caller is distinct from old.author_id then
      raise exception 'only the author may change a comment - the profile owner may take its pin on and off'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profile_comments_guard_pin on public.profile_comments;
create trigger profile_comments_guard_pin
  before update on public.profile_comments
  for each row execute function public.profile_comments_guard_pin();

-- `profile_comments` had never been published, so a comment on a profile has never appeared on an
-- open page without a reload - the profile channel subscribes to it
-- (app/lib/profile/supabase-profile-repository.ts) and a channel bound to a table that is not in
-- the publication reports SUBSCRIBED and then delivers nothing. Guarded like every other entry, so
-- this stays re-runnable.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profile_comments'
  ) then
    alter publication supabase_realtime add table public.profile_comments;
  end if;
end $$;

