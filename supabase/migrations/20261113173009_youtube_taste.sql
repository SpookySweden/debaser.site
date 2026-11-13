-- YOUR YOUTUBE on the account (Luke's OK, 2026-11-13: "Yes, add it"; plan in docs/youtube-link-setup.md and
-- app/lib/web/youtube-taste.ts): the channels a person subscribes to and the topics YouTube files them under, kept on
-- their account so MEDIA leans the same way on their phone and their computer.
--
-- What this adds, and nothing else. No existing table, rule or row is altered:
--   - user_youtube_taste: one row a person, deleted with their account. Up to 50 channels (YouTube id and name), up to
--     30 topic words, and when it was read. No counts, no videos, and never Google's token.
--     Owner only: only they can read, add, change or delete it. Nobody else can read it, signed in or not; visitors
--     (anon) have no grant, and a stream room's guests are shut out like every account table.
--   - web_forget_old_youtube_taste(lock): deletes rows not refreshed for 30 days (YouTube's terms: refresh or remove
--     stored data within 30 days). Called by the hourly MEDIA fetch with the ingest lock, like the other ingest functions;
--     refuses anyone without it.
--
-- Re-runnable: `if not exists`, policies dropped and recreated by name, grants revoked before given.

create table if not exists public.user_youtube_taste (
  person uuid primary key references auth.users (id) on delete cascade,
  -- [{ "id": "UC...", "name": "..." }], at most 50.
  channels jsonb not null default '[]'::jsonb,
  topics text[] not null default '{}',
  updated_at timestamptz not null default now(),
  constraint user_youtube_taste_channels_shape check (jsonb_typeof(channels) = 'array' and jsonb_array_length(channels) <= 50),
  constraint user_youtube_taste_channels_size check (pg_column_size(channels) <= 16384),
  constraint user_youtube_taste_topics_size check (coalesce(array_length(topics, 1), 0) <= 30)
);

alter table public.user_youtube_taste enable row level security;

drop policy if exists "own youtube taste readable" on public.user_youtube_taste;
create policy "own youtube taste readable" on public.user_youtube_taste
  for select to authenticated using (person = auth.uid());

drop policy if exists "own youtube taste addable" on public.user_youtube_taste;
create policy "own youtube taste addable" on public.user_youtube_taste
  for insert to authenticated with check (person = auth.uid() and not (select public.is_guest()));

drop policy if exists "own youtube taste changeable" on public.user_youtube_taste;
create policy "own youtube taste changeable" on public.user_youtube_taste
  for update to authenticated using (person = auth.uid()) with check (person = auth.uid() and not (select public.is_guest()));

drop policy if exists "own youtube taste deletable" on public.user_youtube_taste;
create policy "own youtube taste deletable" on public.user_youtube_taste
  for delete to authenticated using (person = auth.uid());

drop policy if exists "guests stay out" on public.user_youtube_taste;
create policy "guests stay out" on public.user_youtube_taste as restrictive for select to authenticated using (not (select public.is_guest()));

revoke all on public.user_youtube_taste from public, anon, authenticated;
grant select, insert, update, delete on public.user_youtube_taste to authenticated;

-- The 30-day clean-up. Wrong lock: SQLSTATE 28000, which the route treats like the other ingest refusals.
create or replace function public.web_forget_old_youtube_taste(p_secret text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  forgotten integer;
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  delete from public.user_youtube_taste where updated_at < now() - interval '30 days';
  get diagnostics forgotten = row_count;
  return forgotten;
end;
$$;

revoke all on function public.web_forget_old_youtube_taste(text) from public, anon, authenticated;
grant execute on function public.web_forget_old_youtube_taste(text) to anon;
