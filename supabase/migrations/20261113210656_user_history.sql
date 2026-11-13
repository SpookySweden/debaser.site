-- FOR YOU's private history (SPEC-recommender.md; Luke's OK, 2026-11-13: "Yes, add them"): what a person opened, played
-- or read on the site, so their picks follow them between machines.
--
-- What this adds, and nothing else. No existing table, rule or row is altered:
--   - user_history: one row per person per thing (media, song, book, thread, room, letter, lore, person): which one (its
--     site address), its title and maker as shown, up to 12 describing words, what was done (opened, played, read,
--     finished, NOT FOR ME), first and last time. Doing it again only moves the last time (a stronger action replaces a
--     weaker one; NOT FOR ME stays until the row is deleted). Owner only: only they can read, add, change or delete their
--     rows; nobody else, signed in or not; visitors (anon) have no grant and stream-room guests are shut out. At most 3,000
--     rows a person, the oldest going first. Deleted with the account. No counts, no DM text, nothing from Google.
--   - user_history_settings: one row per person: history paused or not, and when it changed. Owner only, guests out.
--     While paused, the rule on user_history itself refuses new rows and changes.
--   - web_forget_old_history(lock): deletes rows untouched for 90 days. Called by the hourly MEDIA fetch with the ingest
--     lock (like web_forget_old_youtube_taste); refuses anyone without it.
--   - history_note(...): the one way a browser writes a row, as the person (security invoker, so the rules above apply).
--
-- ERASE MY HISTORY is the owner's own delete of their rows, through the delete rule.
-- Re-runnable: `if not exists`, `create or replace`, policies and triggers dropped and recreated, grants revoked first.

create table if not exists public.user_history_settings (
  person uuid primary key references auth.users (id) on delete cascade,
  paused boolean not null default false,
  changed_at timestamptz not null default now()
);

create table if not exists public.user_history (
  person uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  ref text not null,
  title text not null default '',
  maker text not null default '',
  words text[] not null default '{}',
  action text not null,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (person, kind, ref),
  constraint user_history_kind check (kind in ('media', 'song', 'book', 'thread', 'room', 'letter', 'lore', 'person')),
  constraint user_history_ref check (char_length(ref) between 1 and 300),
  constraint user_history_title check (char_length(title) <= 200),
  constraint user_history_maker check (char_length(maker) <= 100),
  constraint user_history_words check (coalesce(array_length(words, 1), 0) <= 12),
  constraint user_history_action check (action in ('opened', 'played', 'read', 'finished', 'not_for_me'))
);

create index if not exists user_history_recent on public.user_history (person, last_at desc);
create index if not exists user_history_old on public.user_history (last_at);

-- History is paused for the person asking.
create or replace function public.history_paused()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((select s.paused from public.user_history_settings s where s.person = auth.uid()), false);
$$;

alter table public.user_history enable row level security;
alter table public.user_history_settings enable row level security;

drop policy if exists "own history readable" on public.user_history;
create policy "own history readable" on public.user_history
  for select to authenticated using (person = auth.uid());

drop policy if exists "own history addable" on public.user_history;
create policy "own history addable" on public.user_history
  for insert to authenticated
  with check (person = auth.uid() and not (select public.is_guest()) and not (select public.history_paused()));

drop policy if exists "own history changeable" on public.user_history;
create policy "own history changeable" on public.user_history
  for update to authenticated
  using (person = auth.uid())
  with check (person = auth.uid() and not (select public.is_guest()) and not (select public.history_paused()));

drop policy if exists "own history deletable" on public.user_history;
create policy "own history deletable" on public.user_history
  for delete to authenticated using (person = auth.uid());

drop policy if exists "guests stay out" on public.user_history;
create policy "guests stay out" on public.user_history as restrictive for select to authenticated using (not (select public.is_guest()));

drop policy if exists "own history settings readable" on public.user_history_settings;
create policy "own history settings readable" on public.user_history_settings
  for select to authenticated using (person = auth.uid());

drop policy if exists "own history settings addable" on public.user_history_settings;
create policy "own history settings addable" on public.user_history_settings
  for insert to authenticated with check (person = auth.uid() and not (select public.is_guest()));

drop policy if exists "own history settings changeable" on public.user_history_settings;
create policy "own history settings changeable" on public.user_history_settings
  for update to authenticated using (person = auth.uid()) with check (person = auth.uid() and not (select public.is_guest()));

drop policy if exists "guests stay out" on public.user_history_settings;
create policy "guests stay out" on public.user_history_settings as restrictive for select to authenticated using (not (select public.is_guest()));

revoke all on public.user_history from public, anon, authenticated;
revoke all on public.user_history_settings from public, anon, authenticated;
grant select, insert, update, delete on public.user_history to authenticated;
grant select, insert, update on public.user_history_settings to authenticated;

-- The 3,000-row cap: after a new row, the person's oldest past 3,000 go. Runs as the person (their delete rule applies).
create or replace function public.user_history_cap()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.user_history h
  where h.person = new.person
    and (h.kind, h.ref) in (
      select o.kind, o.ref from public.user_history o
      where o.person = new.person
      order by o.last_at desc
      offset 3000
    );
  return null;
end;
$$;

drop trigger if exists user_history_cap on public.user_history;
create trigger user_history_cap after insert on public.user_history
  for each row execute function public.user_history_cap();

-- One thing opened, played or read: a new row, or the existing one's last time moved on. A stronger action replaces a
-- weaker one (opened < played = read < finished); NOT FOR ME stays. Security invoker: the rules above decide, so a paused
-- history or a guest is refused by the database, not by this function.
create or replace function public.history_note(
  p_kind text, p_ref text, p_title text, p_maker text, p_words text[], p_action text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  rank_of constant jsonb := '{"opened": 1, "played": 2, "read": 2, "finished": 3, "not_for_me": 9}';
begin
  if auth.uid() is null then
    return;
  end if;
  insert into public.user_history as h (person, kind, ref, title, maker, words, action)
  values (
    auth.uid(), p_kind, p_ref, left(coalesce(p_title, ''), 200), left(coalesce(p_maker, ''), 100),
    coalesce(p_words[1:12], '{}'), p_action
  )
  on conflict (person, kind, ref) do update set
    last_at = now(),
    title = excluded.title,
    maker = excluded.maker,
    words = case when coalesce(array_length(excluded.words, 1), 0) > 0 then excluded.words else h.words end,
    action = case
      when (rank_of ->> excluded.action)::int > (rank_of ->> h.action)::int then excluded.action
      else h.action
    end;
end;
$$;

revoke all on function public.history_note(text, text, text, text, text[], text) from public, anon;
grant execute on function public.history_note(text, text, text, text, text[], text) to authenticated;

-- The 90-day clean-up. Wrong lock: SQLSTATE 28000, as the other ingest functions.
create or replace function public.web_forget_old_history(p_secret text)
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
  delete from public.user_history where last_at < now() - interval '90 days';
  get diagnostics forgotten = row_count;
  return forgotten;
end;
$$;

revoke all on function public.web_forget_old_history(text) from public, anon, authenticated;
grant execute on function public.web_forget_old_history(text) to anon;
