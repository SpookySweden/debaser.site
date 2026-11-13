-- Live documents with a file browser (SPEC-live-docs.md, Luke's OK 2026-11-13: "Yes, make it").
--
-- What this adds:
--   - doc_folders: a person's own folders inside MY DOCS (kind 'home', only the owner sees them) and shared folders anyone
--     signed in can make and see (kind 'shared'). LORE is one fixed shared folder with no owner, readable by everyone.
--     A folder may carry a default sharing level for new documents made in it.
--   - docs: one live document each. Owner, folder, title, sharing level ('private', 'shared', 'signed_in', 'public'), the
--     Yjs state (base64) and the same writing as plain text. MY DOCS is not a row: it is a person's documents with no folder.
--   - doc_shares: who a SHARED WITH document is shared with, each CAN EDIT or CAN READ. Only the document's owner changes it.
--   - doc_comments: margin comments and their replies. A comment's place is two Yjs relative positions, so it stays on its
--     words while the text around it changes.
--   - doc_versions: earlier copies of a document, one an hour while it is edited plus every named one, at most 40 a document
--     (the oldest unnamed copy goes first).
--   - Every lore_pages row is copied into docs with the same id and address, PUBLIC, in LORE. lore_pages is left untouched
--     as a backup (it held 0 rows on 2026-11-13; this carries any that exist anyway).
--   - The doc-pictures storage bucket: public reads by an unguessable address (Luke chose unguessable links, 2026-11-13),
--     1 MB a picture, PNG/JPEG/WEBP/GIF, each account files only into its own folder, at most 20 in ten minutes.
--   - Realtime: a document's channel `doc:<id>` is heard only by people who may read it, and only its editors send on it.
--
-- Who may do what:
--   - read: PUBLIC, anyone; ANYONE SIGNED IN, every account; SHARED WITH, the owner and the named people; PRIVATE, the owner.
--   - edit: the owner; accounts on PUBLIC and ANYONE SIGNED IN; CAN EDIT people on SHARED WITH. A banned account only reads.
--   - only the owner changes sharing, moves a document or names who it is shared with; the owner or the admin deletes.
--   - stream guests (anonymous sign-ins) get nothing here.
--
-- Re-runnable: `if not exists`, constraints, triggers and policies dropped and recreated by name, grants revoked first.

-- ---------- folders ----------

create table if not exists public.doc_folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users (id) on delete set null,
  owner_label text not null default '',
  name text not null,
  parent_id uuid references public.doc_folders (id) on delete cascade,
  kind text not null default 'home',
  default_access text,
  created_at timestamptz not null default now()
);

alter table public.doc_folders drop constraint if exists doc_folders_kind_list;
alter table public.doc_folders add constraint doc_folders_kind_list check (kind in ('home', 'shared'));
alter table public.doc_folders drop constraint if exists doc_folders_name_shape;
alter table public.doc_folders add constraint doc_folders_name_shape check (length(btrim(name)) between 1 and 60);
alter table public.doc_folders drop constraint if exists doc_folders_default_list;
alter table public.doc_folders add constraint doc_folders_default_list
  check (default_access is null or default_access in ('private', 'shared', 'signed_in', 'public'));

create index if not exists doc_folders_by_parent on public.doc_folders (parent_id);
create index if not exists doc_folders_by_owner on public.doc_folders (owner_id);

-- LORE: the shared folder the lore pages live in. Fixed id, so the code can name it.
insert into public.doc_folders (id, owner_id, owner_label, name, parent_id, kind, default_access)
values ('00000000-0000-4000-8000-00000000d0c1', null, 'debaser.site', 'LORE', null, 'shared', 'public')
on conflict (id) do nothing;

-- ---------- documents ----------

create table if not exists public.docs (
  id uuid primary key default gen_random_uuid(),
  -- Only lore documents have one: their /lore/<slug> address.
  slug text unique,
  owner_id uuid references auth.users (id) on delete set null,
  owner_label text not null default 'Unknown',
  folder_id uuid references public.doc_folders (id) on delete set null,
  title text not null,
  summary text not null default '',
  access text not null default 'private',
  yjs_state text not null default '',
  body_text text not null default '',
  -- The one board post a document makes when it first goes PUBLIC or ANYONE SIGNED IN.
  board_thread_id uuid,
  created_at timestamptz not null default now(),
  created_by_label text not null default 'Unknown',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_by_label text not null default 'Unknown'
);

alter table public.docs drop constraint if exists docs_access_list;
alter table public.docs add constraint docs_access_list check (access in ('private', 'shared', 'signed_in', 'public'));
alter table public.docs drop constraint if exists docs_slug_shape;
alter table public.docs add constraint docs_slug_shape check (slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
alter table public.docs drop constraint if exists docs_title_shape;
alter table public.docs add constraint docs_title_shape check (length(btrim(title)) between 1 and 120);
alter table public.docs drop constraint if exists docs_summary_shape;
alter table public.docs add constraint docs_summary_shape check (length(summary) <= 300);
-- About 1.5 MB of document. Pictures are addresses, not bytes, so a long document stays far below this.
alter table public.docs drop constraint if exists docs_state_size;
alter table public.docs add constraint docs_state_size check (length(yjs_state) <= 2000000 and length(body_text) <= 1000000);

create index if not exists docs_by_folder on public.docs (folder_id, updated_at desc);
create index if not exists docs_by_owner on public.docs (owner_id, updated_at desc);
create index if not exists docs_by_access on public.docs (access, updated_at desc);

create table if not exists public.doc_shares (
  doc_id uuid not null references public.docs (id) on delete cascade,
  person_id uuid not null references auth.users (id) on delete cascade,
  person_label text not null default '',
  can_edit boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (doc_id, person_id)
);
create index if not exists doc_shares_by_person on public.doc_shares (person_id);

-- ---------- who may read or edit ----------

-- 'owner', 'edit', 'read', or null. Security definer so the policies below can ask without reading through each other's rules.
create or replace function public.doc_role(target uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  is_account boolean := auth.uid() is not null and not public.is_guest();
  row_access text;
  row_owner uuid;
  shared_edit boolean;
  can_write boolean;
begin
  select d.access, d.owner_id into row_access, row_owner from public.docs d where d.id = target;
  if row_access is null then
    return null;
  end if;

  can_write := is_account and not public.is_banned();

  if is_account and row_owner = me then
    return case when can_write then 'owner' else 'read' end;
  end if;

  if row_access = 'public' then
    return case when can_write then 'edit' else 'read' end;
  end if;

  if row_access = 'signed_in' and is_account then
    return case when can_write then 'edit' else 'read' end;
  end if;

  if row_access = 'shared' and is_account then
    select s.can_edit into shared_edit from public.doc_shares s where s.doc_id = target and s.person_id = me;
    if shared_edit is not null then
      return case when shared_edit and can_write then 'edit' else 'read' end;
    end if;
  end if;

  return null;
end;
$$;

create or replace function public.can_read_doc(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.doc_role(target) is not null;
$$;

create or replace function public.can_edit_doc(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.doc_role(target) in ('owner', 'edit'), false);
$$;

-- A realtime topic `doc:<uuid>` read safely: anything else is no document.
create or replace function public.doc_topic_id(topic text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when topic ~ '^doc:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then substr(topic, 5)::uuid
    else null
  end;
$$;

create or replace function public.doc_owner(target uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.owner_id from public.docs d where d.id = target;
$$;

grant execute on function public.doc_role(uuid) to anon, authenticated;
grant execute on function public.can_read_doc(uuid) to anon, authenticated;
grant execute on function public.can_edit_doc(uuid) to anon, authenticated;
grant execute on function public.doc_topic_id(text) to anon, authenticated;
grant execute on function public.doc_owner(uuid) to anon, authenticated;

-- ---------- guards ----------

-- Folders: a home folder sits in its owner's MY DOCS (or another of their home folders); a shared folder sits at the top or
-- in another shared folder. LORE is never removed or renamed. At most 200 folders an account.
create or replace function public.doc_folders_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent public.doc_folders%rowtype;
begin
  if tg_op = 'DELETE' then
    if old.id = '00000000-0000-4000-8000-00000000d0c1' then
      raise exception 'LORE stays';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.owner_id := auth.uid();
      if (select count(*) from public.doc_folders f where f.owner_id = new.owner_id) >= 200 then
        raise exception 'that is 200 folders, the most there is room for';
      end if;
    end if;
  else
    new.owner_id := old.owner_id;
    new.kind := old.kind;
    new.created_at := old.created_at;
    if old.id = '00000000-0000-4000-8000-00000000d0c1' then
      new.name := old.name;
      new.parent_id := old.parent_id;
    end if;
  end if;

  new.name := upper(btrim(new.name));

  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'a folder cannot sit inside itself';
    end if;
    select * into parent from public.doc_folders f where f.id = new.parent_id;
    if parent.id is null then
      raise exception 'no such folder';
    end if;
    if parent.kind <> new.kind then
      raise exception 'a home folder goes in MY DOCS, a shared folder in a shared folder';
    end if;
    if new.kind = 'home' and parent.owner_id is distinct from new.owner_id then
      raise exception 'that folder is someone else''s';
    end if;
  end if;

  return new;
end;
$$;
revoke all on function public.doc_folders_guard() from public, anon, authenticated;

drop trigger if exists doc_folders_guard on public.doc_folders;
create trigger doc_folders_guard before insert or update or delete on public.doc_folders
  for each row execute function public.doc_folders_guard();

-- Documents: editors change the writing and the title; only the owner changes sharing, the folder or the board post; nobody
-- changes the owner or the address. At most 500 documents an account.
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
  else
    new.id := old.id;
    new.owner_id := old.owner_id;
    new.owner_label := old.owner_label;
    new.slug := old.slug;
    new.created_at := old.created_at;
    new.created_by_label := old.created_by_label;
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

drop trigger if exists docs_guard on public.docs;
create trigger docs_guard before insert or update on public.docs
  for each row execute function public.docs_guard();

-- Shares: only for real accounts, never the owner themselves, at most 50 a document.
create or replace function public.doc_shares_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.person_id = public.doc_owner(new.doc_id) then
      raise exception 'the owner already has it';
    end if;
    if (select count(*) from public.doc_shares s where s.doc_id = new.doc_id) >= 50 then
      raise exception 'that is 50 people, the most there is room for';
    end if;
  else
    new.doc_id := old.doc_id;
    new.person_id := old.person_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
revoke all on function public.doc_shares_guard() from public, anon, authenticated;

drop trigger if exists doc_shares_guard on public.doc_shares;
create trigger doc_shares_guard before insert or update on public.doc_shares
  for each row execute function public.doc_shares_guard();

-- ---------- row level security: folders, documents, shares ----------

alter table public.doc_folders enable row level security;
alter table public.docs enable row level security;
alter table public.doc_shares enable row level security;

revoke all on public.doc_folders from public, anon, authenticated;
revoke all on public.docs from public, anon, authenticated;
revoke all on public.doc_shares from public, anon, authenticated;

grant select on public.doc_folders to anon, authenticated;
grant insert (name, parent_id, kind, default_access, owner_label) on public.doc_folders to authenticated;
grant update (name, parent_id, default_access) on public.doc_folders to authenticated;
grant delete on public.doc_folders to authenticated;

grant select on public.docs to anon, authenticated;
grant insert (title, summary, access, folder_id, yjs_state, body_text, owner_label, created_by_label, updated_by_label, slug)
  on public.docs to authenticated;
grant update (title, summary, access, folder_id, yjs_state, body_text, updated_at, updated_by_label, board_thread_id)
  on public.docs to authenticated;
grant delete on public.docs to authenticated;

grant select on public.doc_shares to authenticated;
grant insert (doc_id, person_id, person_label, can_edit) on public.doc_shares to authenticated;
grant update (can_edit, person_label) on public.doc_shares to authenticated;
grant delete on public.doc_shares to authenticated;

-- Folders: LORE for everyone, shared folders for accounts, home folders for their owner.
drop policy if exists "doc folders seen" on public.doc_folders;
create policy "doc folders seen" on public.doc_folders
  for select using (
    id = '00000000-0000-4000-8000-00000000d0c1'
    or (kind = 'shared' and auth.uid() is not null and not public.is_guest())
    or (kind = 'home' and owner_id = auth.uid() and not public.is_guest())
  );

drop policy if exists "doc folders made by accounts" on public.doc_folders;
create policy "doc folders made by accounts" on public.doc_folders
  for insert to authenticated
  with check (not public.is_guest() and not public.is_banned());

drop policy if exists "doc folders changed by their maker" on public.doc_folders;
create policy "doc folders changed by their maker" on public.doc_folders
  for update to authenticated
  using (not public.is_guest() and not public.is_banned() and (owner_id = auth.uid() or public.is_admin()))
  with check (not public.is_guest() and not public.is_banned() and (owner_id = auth.uid() or public.is_admin()));

drop policy if exists "doc folders removed by their maker or admin" on public.doc_folders;
create policy "doc folders removed by their maker or admin" on public.doc_folders
  for delete to authenticated
  using (not public.is_guest() and (owner_id = auth.uid() or public.is_admin()));

-- Documents.
drop policy if exists "docs read by who may" on public.docs;
create policy "docs read by who may" on public.docs
  -- The owner and PUBLIC are read off the row itself, so a document just made can be handed back by the same insert (the
  -- function reads the table as it stood before the statement, when the new row was not there yet).
  for select using (
    access = 'public'
    or (owner_id = auth.uid() and not public.is_guest())
    or public.can_read_doc(id)
  );

drop policy if exists "docs made by accounts" on public.docs;
create policy "docs made by accounts" on public.docs
  for insert to authenticated
  with check (not public.is_guest() and not public.is_banned());

drop policy if exists "docs edited by editors" on public.docs;
create policy "docs edited by editors" on public.docs
  for update to authenticated
  using (public.can_edit_doc(id))
  with check (not public.is_guest() and not public.is_banned());

drop policy if exists "docs removed by owner or admin" on public.docs;
create policy "docs removed by owner or admin" on public.docs
  for delete to authenticated
  using (not public.is_guest() and (owner_id = auth.uid() or public.is_admin()));

-- Shares: the owner sees and changes them; each person sees their own.
drop policy if exists "doc shares seen by owner and person" on public.doc_shares;
create policy "doc shares seen by owner and person" on public.doc_shares
  for select to authenticated
  using (not public.is_guest() and (person_id = auth.uid() or public.doc_owner(doc_id) = auth.uid()));

drop policy if exists "doc shares given by owner" on public.doc_shares;
create policy "doc shares given by owner" on public.doc_shares
  for insert to authenticated
  with check (not public.is_guest() and not public.is_banned() and public.doc_owner(doc_id) = auth.uid());

drop policy if exists "doc shares changed by owner" on public.doc_shares;
create policy "doc shares changed by owner" on public.doc_shares
  for update to authenticated
  using (not public.is_guest() and public.doc_owner(doc_id) = auth.uid())
  with check (not public.is_guest() and public.doc_owner(doc_id) = auth.uid());

drop policy if exists "doc shares taken back by owner" on public.doc_shares;
create policy "doc shares taken back by owner" on public.doc_shares
  for delete to authenticated
  using (not public.is_guest() and public.doc_owner(doc_id) = auth.uid());

-- ---------- margin comments ----------

create table if not exists public.doc_comments (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references public.docs (id) on delete cascade,
  parent_id uuid references public.doc_comments (id) on delete cascade,
  author_id uuid default auth.uid() references auth.users (id) on delete set null,
  author_label text not null default 'Unknown',
  body text not null,
  -- The words it was left on, as base64 Yjs relative positions, and what they said then. A reply has none.
  anchor_from text,
  anchor_to text,
  quote text not null default '',
  resolved boolean not null default false,
  resolved_by_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.doc_comments drop constraint if exists doc_comments_body_shape;
alter table public.doc_comments add constraint doc_comments_body_shape check (length(btrim(body)) between 1 and 2000);
alter table public.doc_comments drop constraint if exists doc_comments_anchor_shape;
alter table public.doc_comments add constraint doc_comments_anchor_shape
  check (coalesce(length(anchor_from), 0) <= 500 and coalesce(length(anchor_to), 0) <= 500 and length(quote) <= 300);

create index if not exists doc_comments_by_doc on public.doc_comments (doc_id, created_at);

create or replace function public.doc_comments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
    new.resolved := false;
    new.resolved_by_label := null;
    if (select count(*) from public.doc_comments c where c.doc_id = new.doc_id) >= 500 then
      raise exception 'that is 500 comments on this document, the most there is room for';
    end if;
    if new.parent_id is not null
      and not exists (select 1 from public.doc_comments p where p.id = new.parent_id and p.doc_id = new.doc_id) then
      raise exception 'that reply has nothing to answer';
    end if;
  else
    new.doc_id := old.doc_id;
    new.parent_id := old.parent_id;
    new.author_id := old.author_id;
    new.author_label := old.author_label;
    new.anchor_from := old.anchor_from;
    new.anchor_to := old.anchor_to;
    new.quote := old.quote;
    new.created_at := old.created_at;
    if new.body is distinct from old.body and auth.uid() is distinct from old.author_id then
      raise exception 'only its author changes what a comment says';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.doc_comments_guard() from public, anon, authenticated;

drop trigger if exists doc_comments_guard on public.doc_comments;
create trigger doc_comments_guard before insert or update on public.doc_comments
  for each row execute function public.doc_comments_guard();

alter table public.doc_comments enable row level security;
revoke all on public.doc_comments from public, anon, authenticated;
grant select on public.doc_comments to anon, authenticated;
grant insert (doc_id, parent_id, author_label, body, anchor_from, anchor_to, quote) on public.doc_comments to authenticated;
grant update (body, resolved, resolved_by_label) on public.doc_comments to authenticated;
grant delete on public.doc_comments to authenticated;

drop policy if exists "doc comments read with the doc" on public.doc_comments;
create policy "doc comments read with the doc" on public.doc_comments
  for select using (public.can_read_doc(doc_id));

drop policy if exists "doc comments left by editors" on public.doc_comments;
create policy "doc comments left by editors" on public.doc_comments
  for insert to authenticated
  with check (not public.is_guest() and public.can_edit_doc(doc_id));

drop policy if exists "doc comments changed by author or editors" on public.doc_comments;
create policy "doc comments changed by author or editors" on public.doc_comments
  for update to authenticated
  using (not public.is_guest() and (author_id = auth.uid() or public.can_edit_doc(doc_id)))
  with check (not public.is_guest() and not public.is_banned());

drop policy if exists "doc comments removed by author, owner or admin" on public.doc_comments;
create policy "doc comments removed by author, owner or admin" on public.doc_comments
  for delete to authenticated
  using (not public.is_guest() and (author_id = auth.uid() or public.doc_owner(doc_id) = auth.uid() or public.is_admin()));

-- ---------- versions ----------

create table if not exists public.doc_versions (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references public.docs (id) on delete cascade,
  yjs_state text not null,
  snippet text not null default '',
  name text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_by_label text not null default 'Unknown',
  created_at timestamptz not null default now()
);

alter table public.doc_versions drop constraint if exists doc_versions_shape;
alter table public.doc_versions add constraint doc_versions_shape
  check (length(yjs_state) <= 2000000 and length(snippet) <= 200 and (name is null or length(btrim(name)) between 1 and 80));

create index if not exists doc_versions_by_doc on public.doc_versions (doc_id, created_at desc);

-- One unnamed copy in any 50 minutes (the hourly copy), and after each insert the oldest unnamed copies beyond 40 go.
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
  else
    new.doc_id := old.doc_id;
    new.yjs_state := old.yjs_state;
    new.snippet := old.snippet;
    new.created_by := old.created_by;
    new.created_by_label := old.created_by_label;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
revoke all on function public.doc_versions_guard() from public, anon, authenticated;

drop trigger if exists doc_versions_guard on public.doc_versions;
create trigger doc_versions_guard before insert or update on public.doc_versions
  for each row execute function public.doc_versions_guard();

create or replace function public.doc_versions_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.doc_versions v
   where v.doc_id = new.doc_id
     and v.id in (
       select o.id from public.doc_versions o
        where o.doc_id = new.doc_id and o.name is null
        order by o.created_at desc
        offset 40
     );
  return null;
end;
$$;
revoke all on function public.doc_versions_cap() from public, anon, authenticated;

drop trigger if exists doc_versions_cap on public.doc_versions;
create trigger doc_versions_cap after insert on public.doc_versions
  for each row execute function public.doc_versions_cap();

alter table public.doc_versions enable row level security;
revoke all on public.doc_versions from public, anon, authenticated;
grant select on public.doc_versions to anon, authenticated;
grant insert (doc_id, yjs_state, snippet, name, created_by_label) on public.doc_versions to authenticated;
grant update (name) on public.doc_versions to authenticated;
grant delete on public.doc_versions to authenticated;

drop policy if exists "doc versions read with the doc" on public.doc_versions;
create policy "doc versions read with the doc" on public.doc_versions
  for select using (public.can_read_doc(doc_id));

drop policy if exists "doc versions kept by editors" on public.doc_versions;
create policy "doc versions kept by editors" on public.doc_versions
  for insert to authenticated
  with check (not public.is_guest() and public.can_edit_doc(doc_id));

drop policy if exists "doc versions named by editors" on public.doc_versions;
create policy "doc versions named by editors" on public.doc_versions
  for update to authenticated
  using (not public.is_guest() and public.can_edit_doc(doc_id))
  with check (not public.is_guest() and public.can_edit_doc(doc_id));

drop policy if exists "doc versions removed by owner" on public.doc_versions;
create policy "doc versions removed by owner" on public.doc_versions
  for delete to authenticated
  using (not public.is_guest() and public.doc_owner(doc_id) = auth.uid());

-- ---------- stream guests stay out (as every other table, 20261106194444_guests_in_streams.sql) ----------

do $$
declare
  t text;
begin
  foreach t in array array['doc_folders', 'docs', 'doc_shares', 'doc_comments', 'doc_versions'] loop
    execute format('drop policy if exists "guests stay out" on public.%I', t);
    execute format('create policy "guests stay out" on public.%I as restrictive for select to authenticated using (not (select public.is_guest()))', t);
  end loop;
end $$;

-- ---------- lore pages become documents in LORE ----------

insert into public.docs (
  id, slug, owner_id, owner_label, folder_id, title, summary, access, yjs_state, body_text,
  created_at, created_by_label, updated_at, updated_by, updated_by_label
)
select
  l.id, l.slug, l.created_by, l.created_by_label, '00000000-0000-4000-8000-00000000d0c1',
  left(coalesce(nullif(btrim(l.title), ''), upper(replace(l.slug, '-', ' '))), 120), left(l.summary, 300), 'public',
  l.yjs_state, l.body_text, l.created_at, l.created_by_label, l.updated_at, l.updated_by, l.updated_by_label
from public.lore_pages l
on conflict (id) do nothing;

-- ---------- pictures ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('doc-pictures', 'doc-pictures', true, 1048576, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Filed only into the account's own folder, at most 20 in ten minutes and 300 in all; never replaced; removed by their filer.
drop policy if exists "doc pictures filed by accounts" on storage.objects;
create policy "doc pictures filed by accounts" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'doc-pictures'
    and not public.is_guest()
    and not public.is_banned()
    and (storage.foldername(name))[1] = auth.uid()::text
    and (
      select count(*) from storage.objects o
       where o.bucket_id = 'doc-pictures' and o.owner_id = auth.uid()::text and o.created_at > now() - interval '10 minutes'
    ) < 20
    and (
      select count(*) from storage.objects o
       where o.bucket_id = 'doc-pictures' and o.owner_id = auth.uid()::text
    ) < 300
  );

drop policy if exists "doc pictures removed by their filer" on storage.objects;
create policy "doc pictures removed by their filer" on storage.objects
  for delete to authenticated
  using (bucket_id = 'doc-pictures' and owner_id = auth.uid()::text);

-- ---------- realtime: a document's channel ----------

drop policy if exists "doc edits heard by readers" on realtime.messages;
create policy "doc edits heard by readers" on realtime.messages
  for select to anon, authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() like 'doc:%'
    and public.can_read_doc(public.doc_topic_id(realtime.topic()))
  );

drop policy if exists "doc edits sent by editors" on realtime.messages;
create policy "doc edits sent by editors" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() like 'doc:%'
    and public.can_edit_doc(public.doc_topic_id(realtime.topic()))
  );

-- To check after running:
--   select count(*) from public.docs where folder_id = '00000000-0000-4000-8000-00000000d0c1';  -- as many as lore_pages
--   select id, public, file_size_limit from storage.buckets where id = 'doc-pictures';
