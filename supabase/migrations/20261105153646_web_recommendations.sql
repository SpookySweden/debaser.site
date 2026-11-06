-- Recommending and DISCOVER presets (SPEC-discover.md; Luke's OK 2026-11-05).
--
-- What this adds, and nothing else. No existing table, rule or row is altered:
--   - web_recommendations: who recommended which item. Only names: a person and a platform and id, as `web_requests` does, so a browser can't
--     put text anywhere. The row's title and addresses are the saved item's own: recommending also asks for the item to be saved into the
--     stream, through the existing web_request_add. You can read and remove only your own rows.
--   - web_recommend_set: one press, on or off. Signed-in people only; at most 200 additions a person a day.
--   - web_recommendations_feed: what the RECOMMENDED list shows, for signed-in people. The kept test accounts and banned people aren't in it.
--   - discover_presets: a person's saved settings for DISCOVER. Owner only, at most 20 a person. The settings are the page's own address
--     query, so they hold nothing the address doesn't.
--   - discover_preset_activate: makes one preset the active one.
--
-- Re-runnable: `if not exists`, `create or replace`, constraint and policy dropped and recreated by name, grants revoked before given.

create table if not exists public.web_recommendations (
  person uuid not null references auth.users (id) on delete cascade,
  platform text not null,
  external_id text not null,
  created_at timestamptz not null default now(),
  primary key (person, platform, external_id)
);

alter table public.web_recommendations drop constraint if exists web_recommendations_platform_values;
alter table public.web_recommendations add constraint web_recommendations_platform_values
  check (platform in ('internet_archive', 'youtube', 'peertube', 'wikimedia_commons', 'openverse', 'vimeo'));
alter table public.web_recommendations drop constraint if exists web_recommendations_external_id_format;
alter table public.web_recommendations add constraint web_recommendations_external_id_format
  check (external_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$');

create index if not exists web_recommendations_newest_idx on public.web_recommendations (created_at desc);

alter table public.web_recommendations enable row level security;

drop policy if exists "own recommendations readable" on public.web_recommendations;
create policy "own recommendations readable" on public.web_recommendations
  for select to authenticated using (person = auth.uid());

drop policy if exists "own recommendations removable" on public.web_recommendations;
create policy "own recommendations removable" on public.web_recommendations
  for delete to authenticated using (person = auth.uid());

revoke all on public.web_recommendations from public, anon, authenticated;
grant select, delete on public.web_recommendations to authenticated;

-- One press. On asks for the item to be saved too, so the row can still be played later; a person over the day's cap is skipped quietly.
create or replace function public.web_recommend_set(p_platform text, p_external_id text, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  if not coalesce(p_on, false) then
    delete from public.web_recommendations r where r.person = me and r.platform = p_platform and r.external_id = p_external_id;
    return;
  end if;
  if p_platform is null
    or p_platform not in ('internet_archive', 'youtube', 'peertube', 'wikimedia_commons', 'openverse', 'vimeo')
    or p_external_id is null
    or p_external_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$' then
    raise exception 'not an item' using errcode = '22023';
  end if;
  if (select count(*) from public.web_recommendations r where r.person = me and r.created_at > now() - interval '1 day') >= 200 then
    return;
  end if;
  insert into public.web_recommendations (person, platform, external_id) values (me, p_platform, p_external_id)
  on conflict (person, platform, external_id) do nothing;
  perform public.web_request_add(p_platform, p_external_id);
end;
$$;

-- Newest first. Not the kept test accounts, and not banned people. A signed-in reader's own go in too, so they see them on the list.
create or replace function public.web_recommendations_feed(p_limit integer)
returns table (person uuid, display_name text, item_id text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  return query
    select r.person, p.display_name, r.platform || ':' || r.external_id, r.created_at
    from public.web_recommendations r
    join public.profiles p on p.id = r.person
    where not p.is_hidden and p.banned_at is null
    order by r.created_at desc, r.person, r.external_id
    limit least(greatest(coalesce(p_limit, 0), 0), 500);
end;
$$;

revoke all on function public.web_recommend_set(text, text, boolean) from public, anon, authenticated;
revoke all on function public.web_recommendations_feed(integer) from public, anon, authenticated;
grant execute on function public.web_recommend_set(text, text, boolean) to authenticated;
grant execute on function public.web_recommendations_feed(integer) to authenticated;

create table if not exists public.discover_presets (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name text not null,
  settings text not null default '',
  active boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.discover_presets drop constraint if exists discover_presets_sizes;
alter table public.discover_presets add constraint discover_presets_sizes
  check (char_length(name) between 1 and 40 and char_length(settings) <= 2000);

create index if not exists discover_presets_owner_idx on public.discover_presets (owner);
create unique index if not exists discover_presets_one_active on public.discover_presets (owner) where active;

alter table public.discover_presets enable row level security;

drop policy if exists "own presets readable" on public.discover_presets;
create policy "own presets readable" on public.discover_presets
  for select to authenticated using (owner = auth.uid());

drop policy if exists "own presets added" on public.discover_presets;
create policy "own presets added" on public.discover_presets
  for insert to authenticated
  with check (owner = auth.uid() and not active and (select count(*) from public.discover_presets d where d.owner = auth.uid()) < 20);

drop policy if exists "own presets changed" on public.discover_presets;
create policy "own presets changed" on public.discover_presets
  for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

drop policy if exists "own presets removed" on public.discover_presets;
create policy "own presets removed" on public.discover_presets
  for delete to authenticated using (owner = auth.uid());

revoke all on public.discover_presets from public, anon, authenticated;
grant select, delete on public.discover_presets to authenticated;
grant insert (name, settings), update (name, settings) on public.discover_presets to authenticated;

-- Makes this one active and the others not, in one step; null makes none active.
create or replace function public.discover_preset_activate(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  update public.discover_presets d set active = false where d.owner = me and d.active;
  if p_id is not null then
    update public.discover_presets d set active = true where d.owner = me and d.id = p_id;
  end if;
end;
$$;

revoke all on function public.discover_preset_activate(uuid) from public, anon, authenticated;
grant execute on function public.discover_preset_activate(uuid) to authenticated;
