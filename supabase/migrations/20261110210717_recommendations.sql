-- Recommendations (Luke, 2026-11-10; SPEC-recommendations.md): a queue of things from around the site, sent to chosen people
-- or posted publicly, with a message that is its title.
--
-- What this adds:
--   - recommendations: one row per sent recommendation (sender, message, title, public or not, its forum thread if public).
--   - recommendation_items: its things, in order, as references (kind, which one, title, picture), like letter items.
--   - recommendation_to: who it was sent to, and when they opened it (the NEW count on the sidebar key).
--   - recommendation_plays: who pressed WATCH, LISTEN or READ inside it, once each (the faces beside its title).
--   - recommendation_send(): the only way to send one. It checks the sender (an account, not a guest, not banned), 1-50
--     things, at most 20 people and never yourself, at most 50 sends a day, writes the title by Luke's rule, and writes the
--     rows and the recipients' notifications in one go.
--   - forum_notifications gets the kind 'recommend' and a link to the recommendation.
--   - web_recommendations_feed() (MEDIA's RECOMMENDED filter) now reads people's picks from public recommendations' MEDIA
--     things as well as from the old table, which stays as it is (empty, unused by the site from now on).
-- Who sees what: a recommendation to chosen people is readable by its sender and those people only; a public one by anyone.
-- Lists come through recommendations_list(), which gives a visitor or a stream guest no names, as RECOMMENDED does.
-- Only the sender deletes one. Recommendations by the site's hidden test accounts don't appear under PUBLIC.
--
-- Re-runnable: `if not exists`, functions replaced, policies dropped and recreated by name, grants revoked before given.

create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null,
  message text not null default '' check (length(message) <= 200),
  title text not null check (length(title) between 1 and 220),
  is_public boolean not null default false,
  forum_thread_id uuid references public.forum_threads (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists recommendations_by_sender on public.recommendations (sender, created_at desc);
create index if not exists recommendations_public on public.recommendations (created_at desc) where is_public;

create table if not exists public.recommendation_items (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references public.recommendations (id) on delete cascade,
  position smallint not null check (position between 0 and 49),
  kind text not null check (kind in ('web', 'media', 'kino', 'thread', 'post', 'lore', 'file', 'song', 'profile', 'link', 'highlight')),
  ref text not null check (length(ref) between 1 and 500),
  title text not null default '' check (length(title) <= 200),
  picture text check (length(picture) <= 500 and (picture like 'https://%' or picture like '/%')),
  unique (recommendation_id, position)
);

create table if not exists public.recommendation_to (
  recommendation_id uuid not null references public.recommendations (id) on delete cascade,
  person uuid not null,
  read_at timestamptz,
  primary key (recommendation_id, person)
);
create index if not exists recommendation_to_by_person on public.recommendation_to (person, read_at);

create table if not exists public.recommendation_plays (
  recommendation_id uuid not null references public.recommendations (id) on delete cascade,
  person uuid not null,
  played_at timestamptz not null default now(),
  primary key (recommendation_id, person)
);

-- ---------- who may read one (definer, so the policies don't read each other's tables in a loop) ----------

create or replace function public.recommendation_readable(rec uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.recommendations r
    where r.id = rec
      and (
        r.is_public
        or r.sender = (select auth.uid())
        or exists (select 1 from public.recommendation_to t where t.recommendation_id = r.id and t.person = (select auth.uid()))
      )
  );
$$;
revoke all on function public.recommendation_readable(uuid) from public, anon, authenticated;
grant execute on function public.recommendation_readable(uuid) to anon, authenticated;

create or replace function public.recommendation_is_mine(rec uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.recommendations r where r.id = rec and r.sender = (select auth.uid()));
$$;
revoke all on function public.recommendation_is_mine(uuid) from public, anon, authenticated;
grant execute on function public.recommendation_is_mine(uuid) to authenticated;

-- ---------- recommendations ----------

alter table public.recommendations enable row level security;

drop policy if exists "recommendations readable by sender, recipients or anyone if public" on public.recommendations;
create policy "recommendations readable by sender, recipients or anyone if public" on public.recommendations
  for select to authenticated using (public.recommendation_readable(id));

drop policy if exists "own recommendations removable" on public.recommendations;
create policy "own recommendations removable" on public.recommendations
  for delete to authenticated using (sender = (select auth.uid()));

drop policy if exists "guests stay out" on public.recommendations;
create policy "guests stay out" on public.recommendations as restrictive for select to authenticated using (not (select public.is_guest()));

revoke all on public.recommendations from public, anon, authenticated;
grant select, delete on public.recommendations to authenticated;

-- ---------- recommendation_items: read with their recommendation (visitors too, for a public one: no names in them) ----------

alter table public.recommendation_items enable row level security;

drop policy if exists "recommendation items readable with it" on public.recommendation_items;
create policy "recommendation items readable with it" on public.recommendation_items
  for select to anon, authenticated using (public.recommendation_readable(recommendation_id));

drop policy if exists "guests stay out" on public.recommendation_items;
create policy "guests stay out" on public.recommendation_items as restrictive for select to authenticated using (not (select public.is_guest()));

revoke all on public.recommendation_items from public, anon, authenticated;
grant select on public.recommendation_items to anon, authenticated;

-- ---------- recommendation_to: a recipient sees and marks their own; the sender sees who it went to ----------

alter table public.recommendation_to enable row level security;

drop policy if exists "recommendation recipients readable" on public.recommendation_to;
create policy "recommendation recipients readable" on public.recommendation_to
  for select to authenticated using (person = (select auth.uid()) or public.recommendation_is_mine(recommendation_id));

drop policy if exists "own recommendation marked opened" on public.recommendation_to;
create policy "own recommendation marked opened" on public.recommendation_to
  for update to authenticated using (person = (select auth.uid())) with check (person = (select auth.uid()));

drop policy if exists "guests stay out" on public.recommendation_to;
create policy "guests stay out" on public.recommendation_to as restrictive for select to authenticated using (not (select public.is_guest()));

revoke all on public.recommendation_to from public, anon, authenticated;
grant select on public.recommendation_to to authenticated;
grant update (read_at) on public.recommendation_to to authenticated;

-- ---------- recommendation_plays: the faces, for signed-in people who may read it ----------

alter table public.recommendation_plays enable row level security;

drop policy if exists "recommendation plays readable with it" on public.recommendation_plays;
create policy "recommendation plays readable with it" on public.recommendation_plays
  for select to authenticated using (public.recommendation_readable(recommendation_id));

drop policy if exists "guests stay out" on public.recommendation_plays;
create policy "guests stay out" on public.recommendation_plays as restrictive for select to authenticated using (not (select public.is_guest()));

revoke all on public.recommendation_plays from public, anon, authenticated;
grant select on public.recommendation_plays to authenticated;

-- ---------- notifications: the new kind, and which recommendation ----------

alter table public.forum_notifications add column if not exists recommendation_id uuid;
alter table public.forum_notifications drop constraint if exists forum_notifications_recommendation_id_fkey;
alter table public.forum_notifications
  add constraint forum_notifications_recommendation_id_fkey
  foreign key (recommendation_id) references public.recommendations (id) on delete cascade;
alter table public.forum_notifications drop constraint if exists forum_notifications_kind_check;
alter table public.forum_notifications
  add constraint forum_notifications_kind_check check (kind in ('tag', 'reply', 'invite', 'recommend'));

-- ---------- sending ----------

create or replace function public.recommendation_send(p_message text, p_public boolean, p_items jsonb, p_to uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  my_name text;
  message text := btrim(coalesce(p_message, ''));
  people uuid[] := coalesce((select array_agg(distinct x) from unnest(coalesce(p_to, '{}'::uuid[])) as x where x is not null), '{}'::uuid[]);
  n integer := coalesce(jsonb_array_length(p_items), 0);
  first_title text;
  title text;
  rec uuid;
  item jsonb;
  at integer := 0;
begin
  if me is null or coalesce(public.is_guest(), false) then
    raise exception 'sign in to recommend';
  end if;
  if public.is_banned() then
    raise exception 'this account cannot recommend';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or n < 1 or n > 50 then
    raise exception 'a recommendation holds 1 to 50 things';
  end if;
  if length(message) > 200 then
    raise exception 'the message is too long';
  end if;
  if not coalesce(p_public, false) and cardinality(people) = 0 then
    raise exception 'send it to someone, or post it publicly';
  end if;
  if cardinality(people) > 20 then
    raise exception 'at most 20 people';
  end if;
  if me = any (people) then
    raise exception 'not to yourself';
  end if;
  if exists (select 1 from unnest(people) as x where not exists (select 1 from public.profiles p where p.id = x)) then
    raise exception 'someone in that list is not on the site';
  end if;
  if (select count(*) from public.recommendations r where r.sender = me and r.created_at > now() - interval '1 day') >= 50 then
    raise exception 'that is 50 recommendations today, the most there is room for';
  end if;

  first_title := left(btrim(coalesce(p_items -> 0 ->> 'title', '')), 200);
  if first_title = '' then
    first_title := 'SOMETHING';
  end if;
  -- Luke's rule: the message is the title; one thing, or no message, and the thing's own title is.
  title := case
    when n = 1 then first_title
    when message <> '' then message
    else first_title || ' AND ' || (n - 1) || ' MORE'
  end;

  insert into public.recommendations (sender, message, title, is_public)
  values (me, message, title, coalesce(p_public, false))
  returning id into rec;

  for item in select value from jsonb_array_elements(p_items)
  loop
    insert into public.recommendation_items (recommendation_id, position, kind, ref, title, picture)
    values (rec, at, item ->> 'kind', item ->> 'ref', left(coalesce(item ->> 'title', ''), 200), nullif(item ->> 'picture', ''));
    at := at + 1;
  end loop;

  if cardinality(people) > 0 then
    insert into public.recommendation_to (recommendation_id, person) select rec, x from unnest(people) as x;
    select coalesce(p.display_name, 'Anonymous') into my_name from public.profiles p where p.id = me;
    insert into public.forum_notifications (user_id, kind, actor_id, actor_name, thread_id, thread_title, body, recommendation_id)
    select x, 'recommend', me, coalesce(my_name, 'Anonymous'), null, title, message, rec from unnest(people) as x;
  end if;

  return rec;
end;
$$;
revoke all on function public.recommendation_send(text, boolean, jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.recommendation_send(text, boolean, jsonb, uuid[]) to authenticated;

-- A public recommendation's forum thread, made by its sender, linked back to it.
create or replace function public.recommendation_attach_thread(p_rec uuid, p_thread uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.recommendations r
  set forum_thread_id = p_thread
  where r.id = p_rec
    and r.sender = auth.uid()
    and r.is_public
    and exists (select 1 from public.forum_threads t where t.id = p_thread and t.author_id = auth.uid());
end;
$$;
revoke all on function public.recommendation_attach_thread(uuid, uuid) from public, anon, authenticated;
grant execute on function public.recommendation_attach_thread(uuid, uuid) to authenticated;

-- WATCH, LISTEN or READ pressed inside a recommendation: the presser's face goes beside its title (once).
create or replace function public.recommendation_played(p_rec uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or coalesce(public.is_guest(), false) or not public.recommendation_readable(p_rec) then
    return;
  end if;
  insert into public.recommendation_plays (recommendation_id, person) values (p_rec, auth.uid()) on conflict do nothing;
end;
$$;
revoke all on function public.recommendation_played(uuid) from public, anon, authenticated;
grant execute on function public.recommendation_played(uuid) to authenticated;

-- ---------- the lists: PUBLIC, FOR YOU, SENT; names only for signed-in people who aren't stream guests ----------

create or replace function public.recommendations_list(p_tab text, p_limit integer)
returns table (
  id uuid, sender uuid, sender_name text, title text, message text, is_public boolean, forum_thread_id uuid,
  created_at timestamptz, read_at timestamptz, item_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  named boolean := auth.uid() is not null and not coalesce(public.is_guest(), false);
  most integer := least(greatest(coalesce(p_limit, 0), 0), 200);
begin
  if p_tab = 'public' then
    return query
      select r.id, case when named then r.sender end, case when named then p.display_name end, r.title, r.message, r.is_public,
             r.forum_thread_id, r.created_at, null::timestamptz, (select count(*)::integer from public.recommendation_items i where i.recommendation_id = r.id)
      from public.recommendations r
      join public.profiles p on p.id = r.sender
      where r.is_public and not p.is_hidden and p.banned_at is null
      order by r.created_at desc
      limit most;
  elsif p_tab = 'for_me' and named then
    return query
      select r.id, r.sender, p.display_name, r.title, r.message, r.is_public, r.forum_thread_id, r.created_at, t.read_at,
             (select count(*)::integer from public.recommendation_items i where i.recommendation_id = r.id)
      from public.recommendation_to t
      join public.recommendations r on r.id = t.recommendation_id
      join public.profiles p on p.id = r.sender
      where t.person = me
      order by r.created_at desc
      limit most;
  elsif p_tab = 'sent' and named then
    return query
      select r.id, r.sender, p.display_name, r.title, r.message, r.is_public, r.forum_thread_id, r.created_at, null::timestamptz,
             (select count(*)::integer from public.recommendation_items i where i.recommendation_id = r.id)
      from public.recommendations r
      join public.profiles p on p.id = r.sender
      where r.sender = me
      order by r.created_at desc
      limit most;
  end if;
end;
$$;
revoke all on function public.recommendations_list(text, integer) from public, anon, authenticated;
grant execute on function public.recommendations_list(text, integer) to anon, authenticated;

-- ---------- MEDIA's RECOMMENDED filter: people's picks now come from public recommendations' MEDIA things too ----------

create or replace function public.web_recommendations_feed(p_limit integer)
returns table (person uuid, display_name text, item_id text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  named boolean := auth.uid() is not null and not coalesce(public.is_guest(), false);
begin
  return query
    select case when named then picks.person end, case when named then p.display_name end, picks.item_id, picks.created_at
    from (
      select r.person, r.platform || ':' || r.external_id as item_id, r.created_at from public.web_recommendations r
      union all
      select rec.sender, i.ref, rec.created_at
      from public.recommendations rec
      join public.recommendation_items i on i.recommendation_id = rec.id
      where rec.is_public and i.kind = 'web'
    ) picks
    join public.profiles p on p.id = picks.person
    where not p.is_hidden and p.banned_at is null
    order by picks.created_at desc, picks.person, picks.item_id
    limit least(greatest(coalesce(p_limit, 0), 0), 500);
end;
$$;
revoke all on function public.web_recommendations_feed(integer) from public, anon, authenticated;
grant execute on function public.web_recommendations_feed(integer) to anon, authenticated;
