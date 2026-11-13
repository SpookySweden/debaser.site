-- Keeping your place in every book (SPEC-reading-places.md, Luke 2026-11-13): CONTINUE READING and READ on /read, how far
-- through each book you are, and when you finished it.
--
-- What this adds to book_places (still one row per person and book; no new table):
--   - title: the book's title as the reader showed it (300 characters at most), so /read can list it without asking every
--     catalogue. For your own file it is the title written inside the file, never the file's name or any of its text.
--   - progress: how far through the book, 0 to 100.
--   - finished_at: when you reached the last page, or empty. [ NOT FINISHED ] empties it again.
-- A PDF's or a scanned book's page is kept in the `place` column that was already there (unused until now, always 0), so the
-- CFI rule stays as it is. Your own file's ref is `own:<its SHA-256 fingerprint>`, which the book_ref rule already takes.
-- Row Level Security is unchanged: only the owner reads or writes their own rows.
--
-- Re-runnable: columns added if not exists, constraints dropped and recreated by name.

alter table public.book_places add column if not exists title text not null default '';
alter table public.book_places add column if not exists progress smallint not null default 0;
alter table public.book_places add column if not exists finished_at timestamptz;

alter table public.book_places drop constraint if exists book_places_title_length;
alter table public.book_places add constraint book_places_title_length check (length(title) <= 300);

alter table public.book_places drop constraint if exists book_places_progress_range;
alter table public.book_places add constraint book_places_progress_range check (progress between 0 and 100);

-- /read lists a person's books newest first.
create index if not exists book_places_by_person_recent on public.book_places (person, updated_at desc);
