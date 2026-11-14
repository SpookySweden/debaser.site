-- An imported YouTube history's summary on the account (Luke's OK, 2026-11-14: "A: Yes, new table"). A person downloads
-- their own watch history from Google Takeout and drops it on MEDIA; the file is read in their browser and never
-- uploaded. Only this summary is kept, so MEDIA leans the same way on their phone and their computer.
--
-- What this adds, and nothing else. No existing table, rule or row is altered:
--   - user_watch_summary: one row a person, deleted with their account. Up to 200 channel names, each with a strength
--     from 1 to 5 (how much and how recently they watched it) and the month it was last watched; up to 60 topic words;
--     and when it was imported. Never the videos, their titles, addresses or times of day.
--     Owner only: only they can read, add, change or delete it. Nobody else can read it, signed in or not; visitors
--     (anon) have no grant, and a stream room's guests are shut out like every account table.
--   - web_forget_old_watch_summary(lock): deletes rows imported more than 12 months ago. Called by the hourly MEDIA
--     fetch with the ingest lock, like the other clean-ups; refuses anyone without it.
--
-- [ REMOVE IMPORT ] and ERASE MY HISTORY are the owner's own delete of their row, through the delete rule.
-- Re-runnable: `if not exists`, policies dropped and recreated by name, grants revoked before given.

create table if not exists public.user_watch_summary (
  person uuid primary key references auth.users (id) on delete cascade,
  -- [{ "name": "...", "strength": 1 to 5, "last": "2026-09" }], at most 200.
  channels jsonb not null default '[]'::jsonb,
  words text[] not null default '{}',
  imported_at timestamptz not null default now(),
  constraint user_watch_summary_channels_shape check (jsonb_typeof(channels) = 'array' and jsonb_array_length(channels) <= 200),
  constraint user_watch_summary_channels_size check (length(channels::text) <= 40000),
  constraint user_watch_summary_words_size check (coalesce(array_length(words, 1), 0) <= 60 and length(array_to_string(words, ' ')) <= 4000)
);

create index if not exists user_watch_summary_old on public.user_watch_summary (imported_at);

alter table public.user_watch_summary enable row level security;

drop policy if exists "own watch summary readable" on public.user_watch_summary;
create policy "own watch summary readable" on public.user_watch_summary
  for select to authenticated using (person = auth.uid());

drop policy if exists "own watch summary addable" on public.user_watch_summary;
create policy "own watch summary addable" on public.user_watch_summary
  for insert to authenticated with check (person = auth.uid() and not (select public.is_guest()));

drop policy if exists "own watch summary changeable" on public.user_watch_summary;
create policy "own watch summary changeable" on public.user_watch_summary
  for update to authenticated using (person = auth.uid()) with check (person = auth.uid() and not (select public.is_guest()));

drop policy if exists "own watch summary deletable" on public.user_watch_summary;
create policy "own watch summary deletable" on public.user_watch_summary
  for delete to authenticated using (person = auth.uid());

drop policy if exists "guests stay out" on public.user_watch_summary;
create policy "guests stay out" on public.user_watch_summary as restrictive for select to authenticated using (not (select public.is_guest()));

revoke all on public.user_watch_summary from public, anon, authenticated;
grant select, insert, update, delete on public.user_watch_summary to authenticated;

-- The 12-month clean-up. Wrong lock: SQLSTATE 28000, as the other ingest functions.
create or replace function public.web_forget_old_watch_summary(p_secret text)
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
  delete from public.user_watch_summary where imported_at < now() - interval '12 months';
  get diagnostics forgotten = row_count;
  return forgotten;
end;
$$;

revoke all on function public.web_forget_old_watch_summary(text) from public, anon, authenticated;
grant execute on function public.web_forget_old_watch_summary(text) to anon;
