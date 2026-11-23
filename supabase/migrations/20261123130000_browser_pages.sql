-- BROWSER's kept pages, notes, history and tabs (SPEC-seeing-machine.md, Phase 5; Luke's typed yes, 2026-11-23: "you have the database okays
-- make sure nothing is waiting on me"). In plain words: five new tables and one private file store. Nothing that exists is changed or deleted.
--   seen_pages        the card of a kept page. Everyone reads the ones that aren't private or hidden; its owner adds and deletes; a moderator hides.
--   seen_page_copies  where a page's copy is, and its words. People with an account.
--   seen_notes        MARGINALIA: a note on a passage. People with an account read; its writer adds and deletes; a moderator hides.
--   browse_history    where you have been in BROWSER: you alone, ninety days.   browse_tabs   your open tabs: you alone.
--   seen (files)      the copies, 12 MB each at most, read by people with an account.
-- Stream guests read and make nothing. A deleted account's rows go with it (its files are left unreadable: no card says where they are).
-- Safe to run again.

create table if not exists public.seen_pages (
  id uuid primary key,
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  owner_label text not null default '' check (char_length(owner_label) <= 80),
  address text not null check (char_length(address) <= 2000 and address ~ '^https?://'),
  title text not null check (char_length(title) between 1 and 300),
  description text not null default '' check (char_length(description) <= 300),
  picture text check (picture is null or (char_length(picture) <= 60000 and picture ~ '^data:image/webp;base64,[A-Za-z0-9+/=]+$')),
  language text not null default '' check (char_length(language) <= 20),
  published date,
  tags text[] not null default '{}' check (cardinality(tags) <= 8),
  note text not null default '' check (char_length(note) <= 1000),
  quotes text[] not null default '{}' check (cardinality(quotes) <= 20),
  has_copy boolean not null default false,
  private boolean not null default true,
  hidden_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists seen_pages_newest on public.seen_pages (created_at desc);
create index if not exists seen_pages_owner on public.seen_pages (owner, created_at desc);

create table if not exists public.seen_page_copies (
  page uuid primary key references public.seen_pages (id) on delete cascade,
  path text not null check (char_length(path) <= 100),
  words text not null default '' check (char_length(words) <= 20000)
);

create table if not exists public.browse_history (
  id bigint generated always as identity primary key,
  person uuid not null default auth.uid() references auth.users (id) on delete cascade,
  address text not null check (char_length(address) <= 2000 and address ~ '^https?://'),
  title text not null default '' check (char_length(title) <= 300),
  came_from text check (came_from is null or char_length(came_from) <= 2000),
  at timestamptz not null default now()
);
create index if not exists browse_history_person_at on public.browse_history (person, at desc);

create table if not exists public.browse_tabs (
  person uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  state jsonb not null check (pg_column_size(state) <= 200000),
  updated_at timestamptz not null default now()
);

-- Who keeps a page, its name, when, and that it is not hidden: the database's to say, not the browser's. A day's most is 200.
create or replace function public.seen_pages_own()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in to keep pages' using errcode = '28000'; end if;
  if (select count(*) from public.seen_pages p where p.owner = auth.uid() and p.created_at > now() - interval '1 day') >= 200 then
    raise exception 'that is 200 pages today, the most there is room for' using errcode = '54000';
  end if;
  new.owner := auth.uid();
  new.owner_label := coalesce((select left(p.display_name, 80) from public.profiles p where p.id = auth.uid()), '');
  new.hidden_at := null;
  new.created_at := now();
  if exists (select 1 from unnest(new.quotes) q where char_length(q) > 300) then raise exception 'a quote is too long' using errcode = '22001'; end if;
  if exists (select 1 from unnest(new.tags) t where char_length(t) > 40) then raise exception 'a tag is too long' using errcode = '22001'; end if;
  return new;
end $$;
drop trigger if exists seen_pages_own on public.seen_pages;
create trigger seen_pages_own before insert on public.seen_pages for each row execute function public.seen_pages_own();

-- A moderator's: one function for both, and it says so in the moderators' log.
create or replace function public.seen_hide(kind text, target uuid, hide boolean, why text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare
  author uuid;
  words text;
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if kind = 'page' then
    update public.seen_pages p set hidden_at = case when hide then now() end where p.id = target returning p.owner, p.title into author, words;
  elsif kind = 'note' then
    update public.seen_notes n set hidden_at = case when hide then now() end where n.id = target returning n.owner, n.note into author, words;
  end if;
  if author is null then raise exception 'not found'; end if;
  perform public.moderation_note(case when hide then 'hide' else 'unhide' end, kind, target::text, author, why, words);
  perform public.moderation_beat();
end $$;

-- The days' end: each write to your own history takes away what is past it.
create or replace function public.browse_history_trim()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.browse_history h where h.person = new.person and h.at < now() - interval '90 days';
  return null;
end $$;
drop trigger if exists browse_history_trim on public.browse_history;
create trigger browse_history_trim after insert on public.browse_history for each row execute function public.browse_history_trim();

create table if not exists public.seen_notes (
  id uuid primary key,
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  owner_label text not null default '' check (char_length(owner_label) <= 80),
  page text not null check (char_length(page) <= 2000 and page ~ '^https?://[^#]+$'),
  quote text not null check (char_length(quote) between 1 and 300),
  note text not null check (char_length(note) between 1 and 300),
  hidden_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists seen_notes_page on public.seen_notes (md5(page), created_at desc);
create index if not exists seen_notes_owner on public.seen_notes (owner, created_at desc);

create or replace function public.seen_notes_own()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in to write notes' using errcode = '28000'; end if;
  if (select count(*) from public.seen_notes n where n.owner = auth.uid() and n.created_at > now() - interval '1 day') >= 200 then
    raise exception 'that is 200 notes today, the most there is room for' using errcode = '54000';
  end if;
  new.owner := auth.uid();
  new.owner_label := coalesce((select left(p.display_name, 80) from public.profiles p where p.id = auth.uid()), '');
  new.hidden_at := null;
  new.created_at := now();
  return new;
end $$;
drop trigger if exists seen_notes_own on public.seen_notes;
create trigger seen_notes_own before insert on public.seen_notes for each row execute function public.seen_notes_own();

alter table public.seen_notes enable row level security;
revoke all on public.seen_notes from public, anon, authenticated;
grant select, insert, delete on public.seen_notes to authenticated;
revoke all on function public.seen_notes_own() from public, anon, authenticated;
drop policy if exists "notes readable" on public.seen_notes;
create policy "notes readable" on public.seen_notes for select to authenticated
  using ((hidden_at is null and not public.is_banned(owner)) or owner = (select auth.uid()) or (select public.is_admin()));
drop policy if exists "blocked people's notes" on public.seen_notes;
create policy "blocked people's notes" on public.seen_notes as restrictive for select to authenticated using (not public.blocked_by_me(owner) or (select public.is_admin()));
drop policy if exists "guests stay out" on public.seen_notes;
create policy "guests stay out" on public.seen_notes as restrictive for select to authenticated using (not (select public.is_guest()));
drop policy if exists "write your own notes" on public.seen_notes;
create policy "write your own notes" on public.seen_notes for insert to authenticated with check (owner = (select auth.uid()) and not (select public.is_guest()) and not (select public.is_banned()));
drop policy if exists "delete your own notes" on public.seen_notes;
create policy "delete your own notes" on public.seen_notes for delete to authenticated using (owner = (select auth.uid()));

alter table public.seen_pages enable row level security;
alter table public.seen_page_copies enable row level security;
alter table public.browse_history enable row level security;
alter table public.browse_tabs enable row level security;
revoke all on public.seen_pages, public.seen_page_copies, public.browse_history, public.browse_tabs from public, anon, authenticated;
grant select on public.seen_pages to anon;
grant select, insert, delete on public.seen_pages to authenticated;
grant select, insert on public.seen_page_copies to authenticated;
grant select, insert, delete on public.browse_history to authenticated;
grant select, insert, update, delete on public.browse_tabs to authenticated;
revoke all on function public.seen_pages_own(), public.browse_history_trim() from public, anon, authenticated;
revoke all on function public.seen_hide(text, uuid, boolean, text) from public, anon;
grant execute on function public.seen_hide(text, uuid, boolean, text) to authenticated;

drop policy if exists "kept pages readable" on public.seen_pages;
create policy "kept pages readable" on public.seen_pages for select to anon, authenticated
  using ((not private and hidden_at is null and not public.is_banned(owner)) or owner = (select auth.uid()) or (not private and (select public.is_admin())));
drop policy if exists "blocked people's pages" on public.seen_pages;
create policy "blocked people's pages" on public.seen_pages as restrictive for select to authenticated using (not public.blocked_by_me(owner) or (select public.is_admin()));
drop policy if exists "keep your own" on public.seen_pages;
create policy "keep your own" on public.seen_pages for insert to authenticated with check (owner = (select auth.uid()) and not (select public.is_guest()) and not (select public.is_banned()));
drop policy if exists "delete your own" on public.seen_pages;
create policy "delete your own" on public.seen_pages for delete to authenticated using (owner = (select auth.uid()));
drop policy if exists "guests stay out" on public.seen_pages;
create policy "guests stay out" on public.seen_pages as restrictive for select to authenticated using (not (select public.is_guest()));

-- A copy is read by whoever may read its card (the rule above decides, through the same table), and has an account.
drop policy if exists "copies readable" on public.seen_page_copies;
create policy "copies readable" on public.seen_page_copies for select to authenticated
  using (not (select public.is_guest()) and exists (select 1 from public.seen_pages p where p.id = page));
drop policy if exists "copy of your own" on public.seen_page_copies;
create policy "copy of your own" on public.seen_page_copies for insert to authenticated
  with check (path = (select auth.uid())::text || '/' || page::text and exists (select 1 from public.seen_pages p where p.id = page and p.owner = (select auth.uid())));

drop policy if exists "guests stay out" on public.seen_page_copies;
create policy "guests stay out" on public.seen_page_copies as restrictive for select to authenticated using (not (select public.is_guest()));
drop policy if exists "guests stay out" on public.browse_history;
create policy "guests stay out" on public.browse_history as restrictive for select to authenticated using (not (select public.is_guest()));
drop policy if exists "guests stay out" on public.browse_tabs;
create policy "guests stay out" on public.browse_tabs as restrictive for select to authenticated using (not (select public.is_guest()));
drop policy if exists "own history" on public.browse_history;
create policy "own history" on public.browse_history for all to authenticated
  using (person = (select auth.uid()) and not (select public.is_guest())) with check (person = (select auth.uid()) and not (select public.is_guest()));
drop policy if exists "own tabs" on public.browse_tabs;
create policy "own tabs" on public.browse_tabs for all to authenticated
  using (person = (select auth.uid()) and not (select public.is_guest())) with check (person = (select auth.uid()) and not (select public.is_guest()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('seen', 'seen', false, 12582912, array['application/json'])
on conflict (id) do nothing;

-- `name` bare, never storage.objects (Temp/check-storage-rules.cjs).
drop policy if exists "seen copies readable" on storage.objects;
create policy "seen copies readable" on storage.objects for select to authenticated
  using (bucket_id = 'seen' and not (select public.is_guest()) and exists (select 1 from public.seen_page_copies c where c.path = name));
drop policy if exists "seen copies added" on storage.objects;
create policy "seen copies added" on storage.objects for insert to authenticated
  with check (bucket_id = 'seen' and not (select public.is_guest()) and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.seen_pages p where p.owner = (select auth.uid()) and (p.owner::text || '/' || p.id::text) = name));
drop policy if exists "seen copies removed" on storage.objects;
create policy "seen copies removed" on storage.objects for delete to authenticated
  using (bucket_id = 'seen' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- A copy is sent by its owner's own browser: the site has no database key, so somebody could send one the server did not make. It is drawn only
-- in the sandboxed frame, with no scripts and nowhere to load from. Hiding a page takes its copy with it (the copy's rule asks the card's).
