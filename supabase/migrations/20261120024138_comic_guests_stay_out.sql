-- COMIC's tables shut to stream guests (SPEC-guests.md, decision 2; found by Temp/check-guests.cjs on 2026-11-20).
-- A guest is a stream room's anonymous sign-in: every table but the room's own carries a restrictive "guests stay out" read
-- rule. The comic stays open to visitors (no sign-in) and to every account, exactly as 20261120015329_comic.sql set it.
--
-- What this adds, and nothing else: the same one rule on each of the seven comic tables, and the comic's file read rule
-- recreated in safer words (below). No row, table or other rule changes.
-- Re-runnable: each rule is dropped and recreated by name.

drop policy if exists "guests stay out" on public.comic_volumes;
create policy "guests stay out" on public.comic_volumes as restrictive for select to authenticated using (not (select public.is_guest()));

drop policy if exists "guests stay out" on public.comic_chapters;
create policy "guests stay out" on public.comic_chapters as restrictive for select to authenticated using (not (select public.is_guest()));

drop policy if exists "guests stay out" on public.comic_pages;
create policy "guests stay out" on public.comic_pages as restrictive for select to authenticated using (not (select public.is_guest()));

drop policy if exists "guests stay out" on public.comic_releases;
create policy "guests stay out" on public.comic_releases as restrictive for select to authenticated using (not (select public.is_guest()));

drop policy if exists "guests stay out" on public.comic_panels;
create policy "guests stay out" on public.comic_panels as restrictive for select to authenticated using (not (select public.is_guest()));

drop policy if exists "guests stay out" on public.comic_panel_tags;
create policy "guests stay out" on public.comic_panel_tags as restrictive for select to authenticated using (not (select public.is_guest()));

drop policy if exists "guests stay out" on public.comic_characters;
create policy "guests stay out" on public.comic_characters as restrictive for select to authenticated using (not (select public.is_guest()));

-- The comic's file read rule, the same rule in the house's safe wording: it names the file being checked by its bare `name`
-- (comic_pages has no column of that name), never `storage.objects`, so a rule on storage.objects can never be read as reading
-- storage.objects (Temp/check-storage-rules.cjs: that once refused every upload on the site). What it allows is unchanged:
-- the reading and zoom copies of a released page, to everyone; never an original.
drop policy if exists "comic copies read once released" on storage.objects;
create policy "comic copies read once released" on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'comic'
    and (storage.foldername(name))[1] in ('reading', 'zoom')
    and exists (
      select 1 from public.comic_pages p
       where p.released_at is not null and (p.reading_path = name or p.zoom_path = name)
    )
  );
