-- LEAGUEBOT (SPEC-leaguebot.md, Luke's 3B, 2026-11-17): your own Riot ID, kept on your account, private.
--
-- What this does, in plain words:
--   - user_league: one row a person: their Riot ID's name and tag, their server, and when they saved it.
--     Owner only: only they can read, add, change or delete their row. Nobody else can read it, signed in or not,
--     and it is never shown on a profile. Deleting the account deletes the row.
--   - Nothing about League games or other players is stored anywhere; LEAGUEBOT reads those live.
--
-- Re-runnable: `if not exists`, constraints and policies dropped and recreated by name, grants revoked before given.

create table if not exists public.user_league (
  person uuid primary key references auth.users (id) on delete cascade,
  riot_name text not null,
  riot_tag text not null,
  region text not null,
  saved_at timestamptz not null default now()
);

alter table public.user_league drop constraint if exists user_league_name_shape;
alter table public.user_league add constraint user_league_name_shape
  check (char_length(riot_name) between 1 and 16 and position('#' in riot_name) = 0);

alter table public.user_league drop constraint if exists user_league_tag_shape;
alter table public.user_league add constraint user_league_tag_shape
  check (char_length(riot_tag) between 2 and 5 and position('#' in riot_tag) = 0);

alter table public.user_league drop constraint if exists user_league_region_known;
alter table public.user_league add constraint user_league_region_known
  check (region in ('EUW','EUNE','NA','KR','BR','LAN','LAS','OCE','TR','RU','JP','PH','SG','TH','TW','VN','ME'));

alter table public.user_league enable row level security;

drop policy if exists "own league readable" on public.user_league;
create policy "own league readable" on public.user_league
  for select to authenticated using (person = auth.uid());

drop policy if exists "own league addable" on public.user_league;
create policy "own league addable" on public.user_league
  for insert to authenticated with check (person = auth.uid());

drop policy if exists "own league changeable" on public.user_league;
create policy "own league changeable" on public.user_league
  for update to authenticated using (person = auth.uid()) with check (person = auth.uid());

drop policy if exists "own league deletable" on public.user_league;
create policy "own league deletable" on public.user_league
  for delete to authenticated using (person = auth.uid());

revoke all on public.user_league from public, anon, authenticated;
grant select, insert, update, delete on public.user_league to authenticated;
