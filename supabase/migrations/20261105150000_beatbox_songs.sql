-- Saved songs for the beat box (app/features/beatbox; Luke's OK 2026-11-05, "Yes, add the table").
--
-- What this adds, and nothing else. No existing table, rule, function or row is altered or deleted:
--   - beatbox_songs: one row per saved song. Its owner, a title of up to 60 characters, the song as BeepBox's own text
--     of up to 100,000 characters, and when it was made and last changed.
--   - Only the owner can read, add, change or delete their own songs. The house account has no way in, and signed-out
--     visitors have no access at all. A song goes when its owner's account goes.
--   - beatbox_songs_cap: at most 100 songs a person, held here rather than trusted to the browser.
--   - beatbox_songs_touch: keeps "last changed" true.
--
-- Sharing a song needs nothing from this table: it is a forum thread holding the song's link, by the person sharing.
--
-- Re-runnable: `if not exists`, `create or replace`, policies and triggers dropped and recreated by name.

create table if not exists public.beatbox_songs (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 60),
  song text not null check (char_length(song) between 1 and 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists beatbox_songs_owner_idx on public.beatbox_songs (owner, updated_at desc);

alter table public.beatbox_songs enable row level security;

drop policy if exists "owner reads their songs" on public.beatbox_songs;
create policy "owner reads their songs" on public.beatbox_songs
  for select to authenticated using (owner = auth.uid());

drop policy if exists "owner adds their songs" on public.beatbox_songs;
create policy "owner adds their songs" on public.beatbox_songs
  for insert to authenticated with check (owner = auth.uid());

drop policy if exists "owner changes their songs" on public.beatbox_songs;
create policy "owner changes their songs" on public.beatbox_songs
  for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

drop policy if exists "owner deletes their songs" on public.beatbox_songs;
create policy "owner deletes their songs" on public.beatbox_songs
  for delete to authenticated using (owner = auth.uid());

revoke all on public.beatbox_songs from public, anon, authenticated;
grant select, insert, update, delete on public.beatbox_songs to authenticated;

-- One person's saves wait for each other, so saves made together can't all read the same count and slip past the cap.
create or replace function public.beatbox_songs_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('beatbox_songs_cap:' || new.owner::text, 0));
  if (select count(*) from public.beatbox_songs s where s.owner = new.owner) >= 100 then
    raise exception 'That is 100 saved songs, the most there is room for. Delete one first.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function public.beatbox_songs_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.beatbox_songs_cap() from public, anon, authenticated;
revoke all on function public.beatbox_songs_touch() from public, anon, authenticated;

drop trigger if exists beatbox_songs_cap on public.beatbox_songs;
create trigger beatbox_songs_cap before insert on public.beatbox_songs
  for each row execute function public.beatbox_songs_cap();

drop trigger if exists beatbox_songs_touch on public.beatbox_songs;
create trigger beatbox_songs_touch before update on public.beatbox_songs
  for each row execute function public.beatbox_songs_touch();
