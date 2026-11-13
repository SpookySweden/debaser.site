-- Every copy of a book counts as that book (Luke, 2026-11-13: "make sure that when someone uploads a pdf to read, that any
-- highlights or comments and their place are saved and related to the book listing and seen in the forum", and "for
-- situations where there are many copies of a book, it still shows you the ones related stuff from another copy").
--
-- One book can be read from many copies: Project Gutenberg's EPUB, an Internet Archive EPUB, PDF or scan, a book on IPFS,
-- or a reader's own PDF or EPUB. Each copy keeps its own ref as before (`books:OL85892W-pg345`, `internet_archive:<id>`,
-- `ipfs:<CID>`, `own:<SHA-256>`); this adds which Open Library work it is a copy of, so they can be gathered together.
--
-- What this adds:
--   - book_places.work_ref: the work this copy of the book is (`books:OL85892W`), or `none` when the reader said their own
--     file is [ NOT LISTED ], or empty when nobody knows yet. For your own file it is your match: the same file on another
--     device finds it here. Still only its owner reads or writes it.
--   - book_highlights.work_ref: the work the copy a highlight was made in is, or empty. Set when the highlight is made, and
--     never changed after (it isn't in the columns anyone may update).
--   - book_readers(): a book's page counts the public highlights made in any copy of its work, not only that one ref.
-- A PDF's highlight needs no new shape: its page goes in `cfi` as the page's own short address (`epubcfi(/6/24)`, already
-- allowed) and the characters within the page's words in the `start_at` and `end_at` columns that were already there.
-- No rows are changed and no table is made. Row Level Security is as it was: owners write their own; signed-in people read
-- unlocked highlights; a visitor reads none.
--
-- Re-runnable: columns added if not exists, constraints and indexes dropped or made by name, the function replaced.

alter table public.book_places add column if not exists work_ref text;
alter table public.book_places drop constraint if exists book_places_work_ref_shape;
alter table public.book_places add constraint book_places_work_ref_shape
  check (work_ref is null or work_ref ~ '^(books:OL[1-9][0-9]{0,11}W|none)$');
create index if not exists book_places_by_person_work on public.book_places (person, work_ref) where work_ref is not null;

alter table public.book_highlights add column if not exists work_ref text;
alter table public.book_highlights drop constraint if exists book_highlights_work_ref_shape;
alter table public.book_highlights add constraint book_highlights_work_ref_shape
  check (work_ref is null or work_ref ~ '^books:OL[1-9][0-9]{0,11}W$');
create index if not exists book_highlights_by_work on public.book_highlights (work_ref, created_at) where work_ref is not null and not is_locked;

-- Nobody moves a highlight to another work after it is made (the update grant already leaves the column out; this holds
-- it for anyone who could).
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
    new.work_ref := old.work_ref;
  end if;
  return new;
end;
$$;
revoke all on function public.book_highlights_guard() from public, anon, authenticated;

-- A book's readers: public highlights in this ref, or in any copy of the same work (a Gutenberg ref names its work in
-- itself: `books:OL85892W-pg345` is a copy of `books:OL85892W`).
create or replace function public.book_readers(p_ref text)
returns table (person uuid, display_name text, highlights integer, latest timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  named boolean := auth.uid() is not null and not coalesce(public.is_guest(), false);
  work text := substring(p_ref from '^(books:OL[1-9][0-9]{0,11}W)');
begin
  return query
    select case when named then h.person end, case when named then p.display_name end, count(*)::integer, max(h.created_at)
    from public.book_highlights h
    join public.profiles p on p.id = h.person
    where (
        h.book_ref = p_ref
        or (work is not null and (h.work_ref = work or h.book_ref = work or h.book_ref like work || '-pg%'))
      )
      and not h.is_locked and not p.is_hidden and p.banned_at is null
    group by h.person, p.display_name
    order by max(h.created_at) desc
    limit 200;
end;
$$;
revoke all on function public.book_readers(text) from public, anon, authenticated;
grant execute on function public.book_readers(text) to anon, authenticated;
