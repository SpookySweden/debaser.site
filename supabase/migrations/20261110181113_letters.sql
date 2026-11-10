-- Letters (Luke, 2026-11-10; SPEC-letters.md): a person's small canvases of things from around the site, like playlists.
--
-- What this adds, and nothing else. No existing table, rule or row is altered:
--   - letters: one row per letter. Its owner adds, changes and deletes it. Anyone, signed out too, reads a public one; a private
--     one is its owner's alone. At most 100 a person.
--   - letter_items: the things on a letter, as references (what kind of thing, which one) with the title and picture address
--     saved when added, and where the card sits on the canvas. Read and written as its letter is. At most 200 a letter.
--   Stamp pictures go into the existing `images` bucket under the owner's own folder (its rules already allow exactly that).
--   Stream guests make no letters and read none, as with every table (`guests stay out`).
--
-- Re-runnable: `if not exists`, triggers and policies dropped and recreated by name, grants revoked before given.

create table if not exists public.letters (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid(),
  name text not null check (length(name) between 1 and 40),
  description text not null default '' check (length(description) <= 200),
  text_colour text check (text_colour ~ '^#[0-9a-fA-F]{6}$'),
  stamp_url text check (length(stamp_url) <= 500 and (stamp_url like 'https://%' or stamp_url like '/%')),
  stamp_opacity smallint not null default 30 check (stamp_opacity between 0 and 100),
  stamp_density smallint not null default 4 check (stamp_density between 1 and 10),
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists letters_by_owner on public.letters (owner, created_at);

create table if not exists public.letter_items (
  id uuid primary key default gen_random_uuid(),
  letter_id uuid not null references public.letters (id) on delete cascade,
  kind text not null check (kind in ('web', 'media', 'kino', 'thread', 'post', 'lore', 'file', 'song', 'profile', 'link', 'highlight')),
  ref text not null check (length(ref) between 1 and 500),
  title text not null default '' check (length(title) <= 200),
  picture text check (length(picture) <= 500 and (picture like 'https://%' or picture like '/%')),
  x real not null default 0.5 check (x between 0 and 1),
  y real not null default 0.5 check (y between 0 and 1),
  turn smallint not null default 0 check (turn between -15 and 15),
  added_at timestamptz not null default now(),
  unique (letter_id, kind, ref)
);

create index if not exists letter_items_by_letter on public.letter_items (letter_id, added_at);

-- The caps, and the letter's changed time moving on.
create or replace function public.letters_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and (select count(*) from public.letters l where l.owner = new.owner) >= 100 then
    raise exception 'too many letters';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.letters_guard() from public, anon, authenticated;

drop trigger if exists letters_guard on public.letters;
create trigger letters_guard before insert or update on public.letters
  for each row execute function public.letters_guard();

create or replace function public.letter_items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.letter_items i where i.letter_id = new.letter_id) >= 200 then
    raise exception 'too many things in this letter';
  end if;
  return new;
end;
$$;
revoke all on function public.letter_items_guard() from public, anon, authenticated;

drop trigger if exists letter_items_guard on public.letter_items;
create trigger letter_items_guard before insert on public.letter_items
  for each row execute function public.letter_items_guard();

-- ---------- letters ----------

alter table public.letters enable row level security;

drop policy if exists "letters public or own readable" on public.letters;
create policy "letters public or own readable" on public.letters
  for select to anon, authenticated using (is_public or owner = (select auth.uid()));

drop policy if exists "own letters addable" on public.letters;
create policy "own letters addable" on public.letters
  for insert to authenticated with check (owner = (select auth.uid()) and not (select public.is_guest()));

drop policy if exists "own letters changeable" on public.letters;
create policy "own letters changeable" on public.letters
  for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

drop policy if exists "own letters removable" on public.letters;
create policy "own letters removable" on public.letters
  for delete to authenticated using (owner = (select auth.uid()));

drop policy if exists "guests stay out" on public.letters;
create policy "guests stay out" on public.letters as restrictive for select to authenticated using (not (select public.is_guest()));

revoke all on public.letters from public, anon, authenticated;
grant select on public.letters to anon;
grant select, insert, update, delete on public.letters to authenticated;

-- ---------- letter_items ----------

alter table public.letter_items enable row level security;

drop policy if exists "letter items readable with their letter" on public.letter_items;
create policy "letter items readable with their letter" on public.letter_items
  for select to anon, authenticated using (
    exists (select 1 from public.letters l where l.id = letter_id and (l.is_public or l.owner = (select auth.uid())))
  );

drop policy if exists "own letter items addable" on public.letter_items;
create policy "own letter items addable" on public.letter_items
  for insert to authenticated with check (
    exists (select 1 from public.letters l where l.id = letter_id and l.owner = (select auth.uid()))
  );

drop policy if exists "own letter items changeable" on public.letter_items;
create policy "own letter items changeable" on public.letter_items
  for update to authenticated
  using (exists (select 1 from public.letters l where l.id = letter_id and l.owner = (select auth.uid())))
  with check (exists (select 1 from public.letters l where l.id = letter_id and l.owner = (select auth.uid())));

drop policy if exists "own letter items removable" on public.letter_items;
create policy "own letter items removable" on public.letter_items
  for delete to authenticated using (
    exists (select 1 from public.letters l where l.id = letter_id and l.owner = (select auth.uid()))
  );

drop policy if exists "guests stay out" on public.letter_items;
create policy "guests stay out" on public.letter_items as restrictive for select to authenticated using (not (select public.is_guest()));

revoke all on public.letter_items from public, anon, authenticated;
grant select on public.letter_items to anon;
grant select, insert, update, delete on public.letter_items to authenticated;
