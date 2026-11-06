-- Saved characters move somewhere safer than one browser (Luke, 2026-11-06: "the characters need to be saved somewhere safer").
--
-- What this adds, and nothing else. No existing table, rule or row is altered:
--   - user_characters: one row per saved figure. Only its owner can read, add or change it; nobody else can read it, signed in or not.
--
-- Three things make it safer than the last place people's work lived. `person` has no link to auth.users, so losing an account can't
-- take the characters with it (it took everything else on 2026-11-06). `email` is kept beside it, filled in here and never by the browser,
-- so they can be found again under a new account. And there is no delete at all: removing a character marks it, so a mistake can be undone.
--
-- Re-runnable: `if not exists`, triggers and policies dropped and recreated by name, grants revoked before given.

create table if not exists public.user_characters (
  person uuid not null,
  id text not null check (length(id) between 1 and 80),
  email text,
  name text not null check (length(name) between 1 and 24),
  preset_id text not null check (length(preset_id) <= 40),
  figure jsonb not null check (jsonb_typeof(figure) = 'object' and pg_column_size(figure) < 65536),
  saved_at timestamptz not null,
  deleted_at timestamptz,
  primary key (person, id)
);

create or replace function public.user_characters_fill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.email := (select lower(u.email) from auth.users u where u.id = new.person);
  if tg_op = 'INSERT' and (select count(*) from public.user_characters c where c.person = new.person) >= 400 then
    raise exception 'too many saved characters';
  end if;
  return new;
end;
$$;
revoke all on function public.user_characters_fill() from public, anon, authenticated;

drop trigger if exists user_characters_fill on public.user_characters;
create trigger user_characters_fill before insert or update on public.user_characters
  for each row execute function public.user_characters_fill();

alter table public.user_characters enable row level security;

drop policy if exists "own characters readable" on public.user_characters;
create policy "own characters readable" on public.user_characters
  for select to authenticated using (person = auth.uid());

drop policy if exists "own characters addable" on public.user_characters;
create policy "own characters addable" on public.user_characters
  for insert to authenticated with check (person = auth.uid());

drop policy if exists "own characters changeable" on public.user_characters;
create policy "own characters changeable" on public.user_characters
  for update to authenticated using (person = auth.uid()) with check (person = auth.uid());

drop policy if exists "guests stay out" on public.user_characters;
create policy "guests stay out" on public.user_characters as restrictive for select to authenticated using (not (select public.is_guest()));

revoke all on public.user_characters from public, anon, authenticated;
grant select, insert, update on public.user_characters to authenticated;
