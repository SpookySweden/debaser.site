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
-- house account the power to edit or remove anybody's post (`is_admin`), and makes
-- a public storage bucket for uploaded profile pictures.
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
  -- What visitors may see. Private by default, exactly like the mock store.
  show_tags boolean not null default false,
  show_profile_comments boolean not null default false,
  show_avatar_comments boolean not null default false,
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
-- 12. check it landed
-- -----------------------------------------------------------------------------
-- Run these on their own after the script; each should answer without an error.
--
--   select tablename, rowsecurity from pg_tables
--     where schemaname = 'public' order by tablename;
--   select tablename, policyname, cmd from pg_policies
--     where schemaname = 'public' order by tablename, policyname;
--   select id, display_name, name_colour from public.profiles;
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets;
--   select policyname, cmd from pg_policies
--     where schemaname = 'storage' order by policyname;
