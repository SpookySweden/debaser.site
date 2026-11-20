-- COMIC, phase 1 (SPEC-comic.md, Luke's OK to build 2026-11-20: "OK, build phase 1").
-- Luke's comic: volumes > chapters > pages, released by hand, panels on pages, lore pages tagged on panels.
--
-- What this adds, and nothing else. No existing table, rule or row is altered:
--   - comic_volumes, comic_chapters, comic_pages, comic_releases, comic_panels, comic_panel_tags, comic_characters.
--   - comic_release(page ids): the one way a page is released. Luke only (is_admin()). It marks the pages released, writes one
--     comic_releases row, and asks NOTIFY's notify_comic_page for one "new pages" alert, if that function exists yet.
--   - The private `comic` storage bucket: Luke's originals and the reading and zoom copies the site makes of them.
--
-- Who may do what:
--   - Everyone, visitors too, reads a page, its panels and its lore tags once the page is released; a volume or chapter once it
--     holds a released page; the reading and zoom copies of a released page (the site's file route asks as a visitor).
--   - Only the admin (the house account, is_admin()) reads anything unreleased, writes anything, or reads an original.
--   - A page's release columns are changed only by comic_release (they are left out of the write grants).
--
-- Re-runnable: `if not exists`, constraints and policies dropped and recreated by name, grants revoked before given.

-- ---------- volumes ----------

create table if not exists public.comic_volumes (
  id uuid primary key default gen_random_uuid(),
  number integer not null,
  title text not null default '',
  created_at timestamptz not null default now()
);

alter table public.comic_volumes drop constraint if exists comic_volumes_number_shape;
alter table public.comic_volumes add constraint comic_volumes_number_shape check (number between 1 and 9999);
alter table public.comic_volumes drop constraint if exists comic_volumes_title_shape;
alter table public.comic_volumes add constraint comic_volumes_title_shape check (char_length(title) <= 120);
create unique index if not exists comic_volumes_number_unique on public.comic_volumes (number);

-- ---------- releases (before pages, which point at them) ----------

create table if not exists public.comic_releases (
  id uuid primary key default gen_random_uuid(),
  released_at timestamptz not null default now(),
  page_count integer not null,
  first_page_id uuid
);

-- ---------- chapters ----------

create table if not exists public.comic_chapters (
  id uuid primary key default gen_random_uuid(),
  volume_id uuid not null references public.comic_volumes (id) on delete restrict,
  -- Numbered straight through the whole comic, not inside a volume.
  number integer not null,
  title text not null default '',
  cover_page_id uuid,
  created_at timestamptz not null default now()
);

alter table public.comic_chapters drop constraint if exists comic_chapters_number_shape;
alter table public.comic_chapters add constraint comic_chapters_number_shape check (number between 1 and 9999);
alter table public.comic_chapters drop constraint if exists comic_chapters_title_shape;
alter table public.comic_chapters add constraint comic_chapters_title_shape check (char_length(title) <= 120);
create unique index if not exists comic_chapters_number_unique on public.comic_chapters (number);
create index if not exists comic_chapters_volume on public.comic_chapters (volume_id);

-- ---------- pages ----------

create table if not exists public.comic_pages (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.comic_chapters (id) on delete cascade,
  position integer not null default 0,
  is_spread boolean not null default false,
  -- The original's size, and the reading copy's (so the reader reserves each page's box before it loads).
  width integer,
  height integer,
  reading_width integer,
  reading_height integer,
  -- Goes up when Luke replaces the file, so a released copy's address never changes under a cache.
  version integer not null default 1,
  original_path text,
  reading_path text,
  zoom_path text,
  -- WORDS ON THIS PAGE, optional, for screen readers. Readable in the page source: never an ARG answer.
  words text not null default '',
  release_id uuid references public.comic_releases (id) on delete set null,
  released_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.comic_pages drop constraint if exists comic_pages_words_shape;
alter table public.comic_pages add constraint comic_pages_words_shape check (char_length(words) <= 4000);
alter table public.comic_pages drop constraint if exists comic_pages_paths_shape;
alter table public.comic_pages add constraint comic_pages_paths_shape check (
  (original_path is null or original_path like 'original/%')
  and (reading_path is null or reading_path like 'reading/%')
  and (zoom_path is null or zoom_path like 'zoom/%')
);
create index if not exists comic_pages_chapter on public.comic_pages (chapter_id, position);
create index if not exists comic_pages_released on public.comic_pages (released_at) where released_at is not null;

alter table public.comic_chapters drop constraint if exists comic_chapters_cover_page;
alter table public.comic_chapters add constraint comic_chapters_cover_page
  foreign key (cover_page_id) references public.comic_pages (id) on delete set null;

-- ---------- panels ----------

create table if not exists public.comic_panels (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.comic_pages (id) on delete cascade,
  position integer not null default 0,
  -- Fractions of the page, 0 to 1, so a box fits every copy.
  x real not null,
  y real not null,
  w real not null,
  h real not null,
  -- True while the box is the site's guess from the gutters; false once Luke has touched it.
  guessed boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.comic_panels drop constraint if exists comic_panels_box_shape;
alter table public.comic_panels add constraint comic_panels_box_shape check (
  x >= 0 and y >= 0 and w > 0 and h > 0 and x + w <= 1.0001 and y + h <= 1.0001
);
create index if not exists comic_panels_page on public.comic_panels (page_id, position);

-- ---------- lore tags and characters ----------

create table if not exists public.comic_panel_tags (
  panel_id uuid not null references public.comic_panels (id) on delete cascade,
  doc_id uuid not null references public.docs (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (panel_id, doc_id)
);
create index if not exists comic_panel_tags_doc on public.comic_panel_tags (doc_id);

create table if not exists public.comic_characters (
  doc_id uuid primary key references public.docs (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------- who reads ----------

alter table public.comic_volumes enable row level security;
alter table public.comic_chapters enable row level security;
alter table public.comic_pages enable row level security;
alter table public.comic_releases enable row level security;
alter table public.comic_panels enable row level security;
alter table public.comic_panel_tags enable row level security;
alter table public.comic_characters enable row level security;

drop policy if exists "comic pages read once released" on public.comic_pages;
create policy "comic pages read once released" on public.comic_pages
  for select to anon, authenticated
  using (released_at is not null or (select public.is_admin()));

drop policy if exists "comic chapters read once they hold a released page" on public.comic_chapters;
create policy "comic chapters read once they hold a released page" on public.comic_chapters
  for select to anon, authenticated
  using (
    (select public.is_admin())
    or exists (select 1 from public.comic_pages p where p.chapter_id = comic_chapters.id and p.released_at is not null)
  );

drop policy if exists "comic volumes read once they hold a released page" on public.comic_volumes;
create policy "comic volumes read once they hold a released page" on public.comic_volumes
  for select to anon, authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.comic_chapters c join public.comic_pages p on p.chapter_id = c.id
       where c.volume_id = comic_volumes.id and p.released_at is not null
    )
  );

drop policy if exists "comic releases read by everyone" on public.comic_releases;
create policy "comic releases read by everyone" on public.comic_releases
  for select to anon, authenticated using (true);

drop policy if exists "comic panels read once their page is released" on public.comic_panels;
create policy "comic panels read once their page is released" on public.comic_panels
  for select to anon, authenticated
  using (
    (select public.is_admin())
    or exists (select 1 from public.comic_pages p where p.id = comic_panels.page_id and p.released_at is not null)
  );

drop policy if exists "comic tags read once their page is released" on public.comic_panel_tags;
create policy "comic tags read once their page is released" on public.comic_panel_tags
  for select to anon, authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.comic_panels n join public.comic_pages p on p.id = n.page_id
       where n.id = comic_panel_tags.panel_id and p.released_at is not null
    )
  );

drop policy if exists "comic characters read by everyone" on public.comic_characters;
create policy "comic characters read by everyone" on public.comic_characters
  for select to anon, authenticated using (true);

-- ---------- who writes: the admin only ----------

drop policy if exists "comic volumes written by the admin" on public.comic_volumes;
create policy "comic volumes written by the admin" on public.comic_volumes
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "comic chapters written by the admin" on public.comic_chapters;
create policy "comic chapters written by the admin" on public.comic_chapters
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "comic pages written by the admin" on public.comic_pages;
create policy "comic pages written by the admin" on public.comic_pages
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "comic panels written by the admin" on public.comic_panels;
create policy "comic panels written by the admin" on public.comic_panels
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "comic tags written by the admin" on public.comic_panel_tags;
create policy "comic tags written by the admin" on public.comic_panel_tags
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "comic characters written by the admin" on public.comic_characters;
create policy "comic characters written by the admin" on public.comic_characters
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

revoke all on public.comic_volumes, public.comic_chapters, public.comic_pages, public.comic_releases,
  public.comic_panels, public.comic_panel_tags, public.comic_characters from public, anon, authenticated;

grant select on public.comic_volumes, public.comic_chapters, public.comic_pages, public.comic_releases,
  public.comic_panels, public.comic_panel_tags, public.comic_characters to anon, authenticated;

grant insert, update, delete on public.comic_volumes, public.comic_chapters, public.comic_panels,
  public.comic_panel_tags, public.comic_characters to authenticated;

-- Pages: every column but the release ones, which only comic_release sets.
grant insert (id, chapter_id, position, is_spread, width, height, reading_width, reading_height, version,
  original_path, reading_path, zoom_path, words) on public.comic_pages to authenticated;
grant update (chapter_id, position, is_spread, width, height, reading_width, reading_height, version,
  original_path, reading_path, zoom_path, words) on public.comic_pages to authenticated;
grant delete on public.comic_pages to authenticated;

-- ---------- release ----------

create or replace function public.comic_release(p_page_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_release uuid;
  v_count integer;
  v_first uuid;
  v_chapter_id uuid;
  v_chapter_number integer;
  v_chapter_title text;
  v_chapters integer;
  v_page_number integer;
  v_title text;
begin
  if not public.is_admin() then
    raise exception 'only the house account releases pages';
  end if;
  if p_page_ids is null or cardinality(p_page_ids) = 0 then
    raise exception 'pick the pages to release';
  end if;

  -- Only pages not yet out, with their reading copy made.
  select count(*), count(distinct p.chapter_id)
    into v_count, v_chapters
    from public.comic_pages p
   where p.id = any (p_page_ids) and p.released_at is null and p.reading_path is not null and p.zoom_path is not null;
  if v_count = 0 then
    raise exception 'nothing to release';
  end if;

  -- The first page in reading order: lowest chapter number, then position.
  select p.id, c.id, c.number, c.title
    into v_first, v_chapter_id, v_chapter_number, v_chapter_title
    from public.comic_pages p join public.comic_chapters c on c.id = p.chapter_id
   where p.id = any (p_page_ids) and p.released_at is null and p.reading_path is not null and p.zoom_path is not null
   order by c.number, p.position, p.id::text
   limit 1;

  insert into public.comic_releases (page_count, first_page_id) values (v_count, v_first) returning id into v_release;

  update public.comic_pages p
     set released_at = now(), release_id = v_release
   where p.id = any (p_page_ids) and p.released_at is null and p.reading_path is not null and p.zoom_path is not null;

  -- The first page's number inside its chapter, as a reader counts them: released pages, in the reader's order.
  select n into v_page_number from (
    select p.id, row_number() over (order by p.position, p.id::text) as n
      from public.comic_pages p where p.chapter_id = v_chapter_id and p.released_at is not null
  ) ranked where ranked.id = v_first;

  if v_chapters = 1 then
    v_title := case when v_count = 1 then 'NEW PAGE IN CHAPTER ' || v_chapter_number
                    else v_count || ' NEW PAGES IN CHAPTER ' || v_chapter_number end;
  else
    v_title := v_count || ' NEW PAGES';
  end if;

  -- NOTIFY's alert (SPEC-notifications.md), once its function exists; idempotent on the ref.
  if to_regprocedure('public.notify_comic_page(text,text,text,text)') is not null then
    execute 'select public.notify_comic_page($1, $2, $3, $4)'
      using 'comic:release:' || v_release::text, v_title, coalesce(v_chapter_title, ''),
            '/comic/' || v_chapter_number || '/' || v_page_number;
  end if;

  return v_release;
end;
$$;

revoke all on function public.comic_release(uuid[]) from public, anon;
grant execute on function public.comic_release(uuid[]) to authenticated;

-- ---------- storage: the private comic bucket ----------

-- 500 MB a file: Luke's originals are over 30 MB. The PC's storage also has a global cap (FILE_SIZE_LIMIT), raised to match.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comic', 'comic', false, 524288000, array['image/png', 'image/jpeg', 'image/webp', 'image/tiff'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "comic files kept by the admin" on storage.objects;
create policy "comic files kept by the admin" on storage.objects
  for all to authenticated
  using (bucket_id = 'comic' and (select public.is_admin()))
  with check (bucket_id = 'comic' and (select public.is_admin()));

-- The reading and zoom copies of a released page, for the site's file route (which asks as a visitor). Never an original.
drop policy if exists "comic copies read once released" on storage.objects;
create policy "comic copies read once released" on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'comic'
    and (storage.foldername(name))[1] in ('reading', 'zoom')
    and exists (
      select 1 from public.comic_pages p
       where p.released_at is not null and (p.reading_path = storage.objects.name or p.zoom_path = storage.objects.name)
    )
  );

-- Checks after a push (read-only):
--   select id, public, file_size_limit from storage.buckets where id = 'comic';
--   select tablename, policyname from pg_policies where tablename like 'comic_%' order by 1, 2;
