-- The listen log (SPEC-vanity.md step 3): who played which file, and when. It feeds public play counts,
-- recommendations and MIRROR later. Plus `profiles.hide_listening`, the opt-out.
--
-- Privacy, as decided by Luke on 2026-10-31:
--   - you write only your own plays, and read only your own (your ON REPEAT row);
--   - nobody can read anyone else's timeline: other people's plays reach the site only as totals, through
--     `music_play_counts`, which leaves out hidden test accounts and anyone who turned listening off;
--   - loop spam: at most 3 plays per person per song per day count towards those totals.
--
-- Re-runnable: `if not exists`, `create or replace`, policies and the trigger dropped and recreated.

alter table public.profiles add column if not exists hide_listening boolean not null default false;

create table if not exists public.music_listens (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The file's address, the key BARR uses too: the same song on every route.
  track_src text not null,
  listened_at timestamptz not null default now(),
  constraint music_listens_src_length check (char_length(track_src) between 1 and 2048)
);

alter table public.music_listens enable row level security;

-- Your own plays only, stamped now (no back- or forward-dating).
drop policy if exists "listens insertable by owner" on public.music_listens;
create policy "listens insertable by owner" on public.music_listens
  for insert with check (
    auth.uid() = user_id
    and listened_at between now() - interval '1 minute' and now() + interval '1 minute'
  );

drop policy if exists "listens readable by owner" on public.music_listens;
create policy "listens readable by owner" on public.music_listens
  for select using (auth.uid() = user_id);

drop policy if exists "listens removable by owner" on public.music_listens;
create policy "listens removable by owner" on public.music_listens
  for delete using (auth.uid() = user_id);

create index if not exists music_listens_src_idx on public.music_listens (track_src);
create index if not exists music_listens_user_idx on public.music_listens (user_id, listened_at desc);

-- A play counts after ~30 seconds of listening, so the same person logging the same file again within
-- 20 seconds is a fault or a script, not a listen: refused, which keeps the table from filling with spam.
create or replace function public.music_listens_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.music_listens
    where user_id = new.user_id
      and track_src = new.track_src
      and listened_at > now() - interval '20 seconds'
  ) then
    raise exception 'listen logged too soon after the last one' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists music_listens_guard on public.music_listens;
create trigger music_listens_guard
  before insert on public.music_listens
  for each row execute function public.music_listens_guard();

-- Public play counts: numbers only, no names. Each person's plays of a song count at most 3 per day
-- (UTC), and hidden accounts and anyone with listening hidden are left out. `srcs` null = every file.
create or replace function public.music_play_counts(srcs text[] default null)
returns table (track_src text, plays bigint)
language sql
stable
security definer
set search_path = public
as $$
  with capped as (
    select l.track_src, l.user_id, (l.listened_at at time zone 'utc')::date as day, least(count(*), 3) as n
    from public.music_listens l
    join public.profiles p on p.id = l.user_id
    where not p.is_hidden
      and not p.hide_listening
      and (srcs is null or l.track_src = any (srcs))
    group by l.track_src, l.user_id, day
  )
  select capped.track_src, sum(capped.n)::bigint as plays
  from capped
  group by capped.track_src;
$$;

revoke all on function public.music_play_counts(text[]) from public;
grant execute on function public.music_play_counts(text[]) to anon, authenticated;
