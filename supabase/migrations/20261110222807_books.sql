-- Books (Luke, 2026-11-10; SPEC-books.md): highlights in the site's reader, where each person is in a book, and who has read
-- what for a book's page. The book text itself is never stored anywhere (it passes through /api/web/book, as subtitles do).
--
-- What this adds:
--   - book_highlights: one row per highlight: its owner, the book (a MEDIA item id, e.g. books:gutenberg-345) and its title,
--     where in the book (a paragraph and the characters within it), the quoted words (300 characters at most), the comment,
--     a lock, the forum post it became (when public), and when it was made. The owner adds, changes, locks and deletes their
--     own; signed-in people read unlocked ones; a visitor reads none. At most 500 a person in one book.
--   - book_places: where each person is in each book (a paragraph number). Only its owner reads or writes it.
--   - book_readers(): for a book's page, who has public highlights in it and how many, leaving out the hidden test
--     accounts and banned ones, with no names for visitors or stream guests (as RECOMMENDED does).
--   Stream guests make none and read none (`guests stay out`).
--
-- Re-runnable: `if not exists`, functions replaced, policies dropped and recreated by name, grants revoked before given.

create table if not exists public.book_highlights (
  id uuid primary key default gen_random_uuid(),
  person uuid not null default auth.uid(),
  book_ref text not null check (book_ref ~ '^[a-z][a-z0-9_]{0,40}:[A-Za-z0-9][A-Za-z0-9._-]{0,200}$'),
  book_title text not null default '' check (length(book_title) <= 300),
  place integer not null check (place between 0 and 1000000),
  start_at integer not null default 0 check (start_at between 0 and 100000),
  end_at integer not null default 0 check (end_at between 0 and 100000 and end_at >= start_at),
  quote text not null check (length(quote) between 1 and 300),
  comment text not null default '' check (length(comment) <= 1000),
  is_locked boolean not null default false,
  forum_comment_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists book_highlights_by_book on public.book_highlights (book_ref, created_at) where not is_locked;
create index if not exists book_highlights_by_person on public.book_highlights (person, book_ref, place);

create table if not exists public.book_places (
  person uuid not null default auth.uid(),
  book_ref text not null check (book_ref ~ '^[a-z][a-z0-9_]{0,40}:[A-Za-z0-9][A-Za-z0-9._-]{0,200}$'),
  place integer not null default 0 check (place between 0 and 1000000),
  updated_at timestamptz not null default now(),
  primary key (person, book_ref)
);

-- The cap, and nobody's highlight moving to someone else's name or another book.
create or replace function public.book_highlights_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.book_highlights h where h.person = new.person and h.book_ref = new.book_ref) >= 500 then
      raise exception 'that is 500 highlights in this book, the most there is room for';
    end if;
  else
    new.person := old.person;
    new.book_ref := old.book_ref;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
revoke all on function public.book_highlights_guard() from public, anon, authenticated;

drop trigger if exists book_highlights_guard on public.book_highlights;
create trigger book_highlights_guard before insert or update on public.book_highlights
  for each row execute function public.book_highlights_guard();

-- ---------- book_highlights ----------

alter table public.book_highlights enable row level security;

drop policy if exists "book highlights readable when unlocked or own" on public.book_highlights;
create policy "book highlights readable when unlocked or own" on public.book_highlights
  for select to authenticated using (not is_locked or person = (select auth.uid()));

drop policy if exists "own book highlights addable" on public.book_highlights;
create policy "own book highlights addable" on public.book_highlights
  for insert to authenticated with check (person = (select auth.uid()) and not (select public.is_guest()) and not public.is_banned());

drop policy if exists "own book highlights changeable" on public.book_highlights;
create policy "own book highlights changeable" on public.book_highlights
  for update to authenticated using (person = (select auth.uid())) with check (person = (select auth.uid()));

drop policy if exists "own book highlights removable" on public.book_highlights;
create policy "own book highlights removable" on public.book_highlights
  for delete to authenticated using (person = (select auth.uid()));

drop policy if exists "guests stay out" on public.book_highlights;
create policy "guests stay out" on public.book_highlights as restrictive for select to authenticated using (not (select public.is_guest()));

revoke all on public.book_highlights from public, anon, authenticated;
grant select, insert, delete on public.book_highlights to authenticated;
grant update (comment, is_locked, forum_comment_id) on public.book_highlights to authenticated;

-- ---------- book_places ----------

alter table public.book_places enable row level security;

drop policy if exists "own book places" on public.book_places;
create policy "own book places" on public.book_places
  for all to authenticated using (person = (select auth.uid())) with check (person = (select auth.uid()) and not (select public.is_guest()));

revoke all on public.book_places from public, anon, authenticated;
grant select, insert, update, delete on public.book_places to authenticated;

-- ---------- a book's readers ----------

create or replace function public.book_readers(p_ref text)
returns table (person uuid, display_name text, highlights integer, latest timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  named boolean := auth.uid() is not null and not coalesce(public.is_guest(), false);
begin
  return query
    select case when named then h.person end, case when named then p.display_name end, count(*)::integer, max(h.created_at)
    from public.book_highlights h
    join public.profiles p on p.id = h.person
    where h.book_ref = p_ref and not h.is_locked and not p.is_hidden and p.banned_at is null
    group by h.person, p.display_name
    order by max(h.created_at) desc
    limit 200;
end;
$$;
revoke all on function public.book_readers(text) from public, anon, authenticated;
grant execute on function public.book_readers(text) to anon, authenticated;
