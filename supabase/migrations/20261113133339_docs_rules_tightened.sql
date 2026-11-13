-- DOCS rules tightened after code review (SPEC-live-docs.md; Luke's OK in chat, 2026-11-13: "Yes, make it").
--
-- What this changes (nothing is deleted; the new tables held no real documents when this ran):
--   1. Named versions: at most 20 a document, on top of the 40 hourly copies. Naming an hourly copy counts as a named one,
--      so it cannot be used to slip past the cap. A 21st is refused; the owner can remove one (the delete rule already lets them).
--   2. Lore addresses: only a document made in the LORE folder keeps a /lore/<slug> address, and a lore page cannot be moved
--      out of LORE. Before this, any account could give a private document a /lore address and block the real page.
--   3. Pictures: at most 100 an account (was 300), still counted inside public.doc_pictures_may_file(), never by a rule
--      reading storage.objects itself (20261113032500_doc_pictures_upload_rule.sql says why).
--
-- Re-runnable: every function is replaced whole; the triggers already point at them.

-- ---------- 1. named versions ----------

create or replace function public.doc_versions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    if new.name is null and exists (
      select 1 from public.doc_versions v
       where v.doc_id = new.doc_id and v.name is null and v.created_at > now() - interval '50 minutes'
    ) then
      raise exception 'a copy was kept less than an hour ago';
    end if;
    if new.name is not null
      and (select count(*) from public.doc_versions v where v.doc_id = new.doc_id and v.name is not null) >= 20 then
      raise exception 'that is 20 named versions - remove one first';
    end if;
  else
    new.doc_id := old.doc_id;
    new.yjs_state := old.yjs_state;
    new.snippet := old.snippet;
    new.created_by := old.created_by;
    new.created_by_label := old.created_by_label;
    new.created_at := old.created_at;
    if old.name is null and new.name is not null
      and (select count(*) from public.doc_versions v where v.doc_id = new.doc_id and v.name is not null) >= 20 then
      raise exception 'that is 20 named versions - remove one first';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.doc_versions_guard() from public, anon, authenticated;

-- ---------- 2. lore addresses ----------

create or replace function public.docs_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  target public.doc_folders%rowtype;
begin
  if tg_op = 'INSERT' then
    if me is not null then
      new.owner_id := me;
      new.updated_by := me;
      if (select count(*) from public.docs d where d.owner_id = me) >= 500 then
        raise exception 'that is 500 documents, the most there is room for';
      end if;
    end if;
    new.board_thread_id := null;
    -- A /lore address only for a page made in LORE.
    if new.folder_id is distinct from '00000000-0000-4000-8000-00000000d0c1'::uuid then
      new.slug := null;
    end if;
  else
    new.id := old.id;
    new.owner_id := old.owner_id;
    new.owner_label := old.owner_label;
    new.slug := old.slug;
    new.created_at := old.created_at;
    new.created_by_label := old.created_by_label;
    if old.slug is not null and new.folder_id is distinct from '00000000-0000-4000-8000-00000000d0c1'::uuid then
      raise exception 'a lore page stays in LORE';
    end if;
    if me is not null then
      new.updated_by := me;
      if me is distinct from old.owner_id then
        if new.access is distinct from old.access
          or new.folder_id is distinct from old.folder_id
          or new.board_thread_id is distinct from old.board_thread_id then
          raise exception 'only the owner changes who can see it, where it is filed, or its board post';
        end if;
      end if;
    end if;
    -- The board post is set once.
    if old.board_thread_id is not null then
      new.board_thread_id := old.board_thread_id;
    end if;
  end if;

  if new.folder_id is not null and (tg_op = 'INSERT' or new.folder_id is distinct from old.folder_id) then
    select * into target from public.doc_folders f where f.id = new.folder_id;
    if target.id is null then
      raise exception 'no such folder';
    end if;
    if target.kind = 'home' and target.owner_id is distinct from new.owner_id then
      raise exception 'that folder is someone else''s';
    end if;
  end if;

  new.title := btrim(new.title);
  return new;
end;
$$;
revoke all on function public.docs_guard() from public, anon, authenticated;

-- ---------- 3. pictures: 100 an account ----------

create or replace function public.doc_pictures_may_file()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from storage.objects o
      where o.bucket_id = 'doc-pictures' and o.owner_id = (auth.uid())::text
        and o.created_at > now() - interval '10 minutes') < 20
    and
    (select count(*) from storage.objects o
      where o.bucket_id = 'doc-pictures' and o.owner_id = (auth.uid())::text) < 100;
$$;
revoke all on function public.doc_pictures_may_file() from public, anon;
grant execute on function public.doc_pictures_may_file() to authenticated, service_role;

-- To check after running:
--   select prosrc like '%< 100%' from pg_proc where proname = 'doc_pictures_may_file';
--   node Temp/check-storage-rules.cjs
