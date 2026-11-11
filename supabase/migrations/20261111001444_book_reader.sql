-- The DEBASER reader (SPEC-reader.md, Luke's OK 2026-11-11): the book is Project Gutenberg's EPUB now, so a spot in it is
-- an EPUB CFI (the standard address of a place in an e-book), not a paragraph of the plain text.
--
-- What this adds:
--   - book_highlights.cfi: where the highlight is, as a CFI. The old paragraph fields (place, start_at, end_at) stay, so a
--     highlight made before keeps working (there were none when this ran: 0 rows, counted 2026-11-11).
--   - book_highlights.colour: one of five colours, picked when highlighting. The owner may change it.
--   - book_places.cfi: where each person is in each book, as a CFI. Still only its owner reads or writes it.
--   - book_bookmarks: a person's bookmarks in a book (the book, the CFI, a short name, when). Owner only, like book_places;
--     at most 200 a person in one book; stream guests make and read none.
--   - book_reader_settings: each person's look settings for the reader (text size, spacing, margins, font, paper), one small
--     row a person. Owner only.
--   Nothing from a book is stored but the short quote a highlight already keeps (300 characters at most).
--
-- Re-runnable: `if not exists`, constraints and policies dropped and recreated by name, grants revoked before given.

-- ---------- book_highlights: a CFI and a colour ----------

alter table public.book_highlights add column if not exists cfi text;
alter table public.book_highlights add column if not exists colour text not null default 'yellow';

alter table public.book_highlights drop constraint if exists book_highlights_cfi_shape;
alter table public.book_highlights add constraint book_highlights_cfi_shape
  check (cfi is null or (length(cfi) between 10 and 600 and cfi like 'epubcfi(%)'));

alter table public.book_highlights drop constraint if exists book_highlights_colour_list;
alter table public.book_highlights add constraint book_highlights_colour_list
  check (colour in ('yellow', 'pink', 'green', 'blue', 'red'));

-- A CFI highlight has no paragraph: place defaults to 0 for it.
alter table public.book_highlights alter column place set default 0;

revoke update on public.book_highlights from authenticated;
grant update (comment, is_locked, forum_comment_id, colour) on public.book_highlights to authenticated;

-- ---------- book_places: a CFI ----------

alter table public.book_places add column if not exists cfi text;

alter table public.book_places drop constraint if exists book_places_cfi_shape;
alter table public.book_places add constraint book_places_cfi_shape
  check (cfi is null or (length(cfi) between 10 and 600 and cfi like 'epubcfi(%)'));

-- ---------- book_bookmarks ----------

create table if not exists public.book_bookmarks (
  id uuid primary key default gen_random_uuid(),
  person uuid not null default auth.uid(),
  book_ref text not null check (book_ref ~ '^[a-z][a-z0-9_]{0,40}:[A-Za-z0-9][A-Za-z0-9._-]{0,200}$'),
  cfi text not null check (length(cfi) between 10 and 600 and cfi like 'epubcfi(%)'),
  label text not null default '' check (length(label) <= 120),
  created_at timestamptz not null default now(),
  unique (person, book_ref, cfi)
);
create index if not exists book_bookmarks_by_person on public.book_bookmarks (person, book_ref, created_at);

-- The cap, and nobody's bookmark moving to someone else's name or another book.
create or replace function public.book_bookmarks_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.book_bookmarks b where b.person = new.person and b.book_ref = new.book_ref) >= 200 then
      raise exception 'that is 200 bookmarks in this book, the most there is room for';
    end if;
  else
    new.person := old.person;
    new.book_ref := old.book_ref;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
revoke all on function public.book_bookmarks_guard() from public, anon, authenticated;

drop trigger if exists book_bookmarks_guard on public.book_bookmarks;
create trigger book_bookmarks_guard before insert or update on public.book_bookmarks
  for each row execute function public.book_bookmarks_guard();

alter table public.book_bookmarks enable row level security;

drop policy if exists "own book bookmarks" on public.book_bookmarks;
create policy "own book bookmarks" on public.book_bookmarks
  for all to authenticated
  using (person = (select auth.uid()))
  with check (person = (select auth.uid()) and not (select public.is_guest()) and not public.is_banned());

drop policy if exists "guests stay out" on public.book_bookmarks;
create policy "guests stay out" on public.book_bookmarks as restrictive for select to authenticated using (not (select public.is_guest()));

revoke all on public.book_bookmarks from public, anon, authenticated;
grant select, insert, delete on public.book_bookmarks to authenticated;
grant update (label) on public.book_bookmarks to authenticated;

-- ---------- book_reader_settings ----------

create table if not exists public.book_reader_settings (
  person uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.book_reader_settings drop constraint if exists book_reader_settings_shape;
alter table public.book_reader_settings add constraint book_reader_settings_shape
  check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) < 1024);

alter table public.book_reader_settings enable row level security;

drop policy if exists "own reader settings" on public.book_reader_settings;
create policy "own reader settings" on public.book_reader_settings
  for all to authenticated
  using (person = (select auth.uid()))
  with check (person = (select auth.uid()) and not (select public.is_guest()));

drop policy if exists "guests stay out" on public.book_reader_settings;
create policy "guests stay out" on public.book_reader_settings as restrictive for select to authenticated using (not (select public.is_guest()));

revoke all on public.book_reader_settings from public, anon, authenticated;
grant select, insert, update, delete on public.book_reader_settings to authenticated;
