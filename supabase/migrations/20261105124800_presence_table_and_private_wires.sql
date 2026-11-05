-- Privacy plan, phase 0, first half (Luke's OK in chat, 2026-11-05). Only adds things, so the site keeps working before
-- and after the code that uses them. The second half, 20261105*_profile_columns_and_authors.sql, follows once that code is live.
--
--   1. profile_presence: the online stamp in a table of its own, read by signed-in people.
--   2. account_list(): the list of accounts for the directory and the name pickers.
--   3. Rules for the private live channels, on the model of the canvas channel (20261103205948_stream-art-safety.sql).
--   4. A fixed search path on the four functions the security advisor names.
--
-- Nothing is deleted. Re-runnable: `if not exists`, `on conflict`, and policies dropped and recreated by name.

-- 1. The online stamp -------------------------------------------------------------------------------------------------
create table if not exists public.profile_presence (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  last_seen_at timestamptz,
  is_online boolean not null default false
);

alter table public.profile_presence enable row level security;

revoke all on public.profile_presence from public, anon;
grant select, insert, update on public.profile_presence to authenticated;

drop policy if exists "presence readable by accounts" on public.profile_presence;
create policy "presence readable by accounts" on public.profile_presence
  for select to authenticated
  using (true);

drop policy if exists "presence stamped by its owner" on public.profile_presence;
create policy "presence stamped by its owner" on public.profile_presence
  for insert to authenticated
  with check (user_id = auth.uid() and not public.is_banned());

drop policy if exists "presence restamped by its owner" on public.profile_presence;
create policy "presence restamped by its owner" on public.profile_presence
  for update to authenticated
  using (user_id = auth.uid() and not public.is_banned())
  with check (user_id = auth.uid() and not public.is_banned());

insert into public.profile_presence (user_id, last_seen_at, is_online)
  select id, last_seen_at, is_online from public.profiles
  on conflict (user_id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profile_presence'
  ) then
    alter publication supabase_realtime add table public.profile_presence;
  end if;
end $$;

-- 2. The list of accounts ---------------------------------------------------------------------------------------------
-- Everybody except the test accounts. A test account and the house account also get the test accounts, flagged, because
-- they are the ones who need those names to resolve.
create or replace function public.account_list()
returns table (id uuid, display_name text, created_at timestamptz, banned_at timestamptz, hidden boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with viewer as (
    select public.is_admin() or coalesce((select p.is_hidden from public.profiles p where p.id = auth.uid()), false) as sees_all
  )
  select p.id, p.display_name, p.created_at, p.banned_at, p.is_hidden
  from public.profiles p, viewer
  where not p.is_hidden or viewer.sees_all
  order by p.created_at;
$$;

revoke all on function public.account_list() from public;
grant execute on function public.account_list() to anon, authenticated, service_role;

-- 3. The private live channels ----------------------------------------------------------------------------------------
-- Who is online, and who is watching what: accounts only.
drop policy if exists "site presence heard by accounts" on realtime.messages;
create policy "site presence heard by accounts" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'presence'
    and realtime.topic() in ('site-presence', 'site-watching')
    and not public.is_banned()
  );

drop policy if exists "site presence said by accounts" on realtime.messages;
create policy "site presence said by accounts" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and realtime.topic() in ('site-presence', 'site-watching')
    and not public.is_banned()
  );

-- A stream room's people: while it is live, and every room is open to a signed-out watcher until private rooms exist.
drop policy if exists "room presence heard while live" on realtime.messages;
create policy "room presence heard while live" on realtime.messages
  for select to anon, authenticated
  using (
    realtime.messages.extension = 'presence'
    and realtime.topic() like 'watch:%'
    and not public.is_banned()
    and exists (select 1 from public.watch_rooms r where r.id::text = substr(realtime.topic(), 7) and r.ended_at is null)
  );

drop policy if exists "room presence said while live" on realtime.messages;
create policy "room presence said while live" on realtime.messages
  for insert to anon, authenticated
  with check (
    realtime.messages.extension = 'presence'
    and realtime.topic() like 'watch:%'
    and not public.is_banned()
    and exists (select 1 from public.watch_rooms r where r.id::text = substr(realtime.topic(), 7) and r.ended_at is null)
  );

-- A lore page's edits: anyone reading the page can listen, accounts send.
drop policy if exists "lore edits heard by readers" on realtime.messages;
create policy "lore edits heard by readers" on realtime.messages
  for select to anon, authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() like 'lore:%'
  );

drop policy if exists "lore edits sent by accounts" on realtime.messages;
create policy "lore edits sent by accounts" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() like 'lore:%'
    and not public.is_banned()
  );

-- A game: its two players.
drop policy if exists "game moves heard by the players" on realtime.messages;
create policy "game moves heard by the players" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() like 'match:%'
    and not public.is_banned()
    and exists (
      select 1 from public.game_invites i
      where i.id::text = substr(realtime.topic(), 7) and auth.uid() in (i.from_user, i.to_user)
    )
  );

drop policy if exists "game moves sent by the players" on realtime.messages;
create policy "game moves sent by the players" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() like 'match:%'
    and not public.is_banned()
    and exists (
      select 1 from public.game_invites i
      where i.id::text = substr(realtime.topic(), 7) and auth.uid() in (i.from_user, i.to_user)
    )
  );

-- 4. A fixed search path ----------------------------------------------------------------------------------------------
alter function public.touch_updated_at() set search_path = public;
alter function public.touch_music_queue() set search_path = public;
alter function public.music_follows_guard() set search_path = public;
alter function public.touch_music_song_notes() set search_path = public;
