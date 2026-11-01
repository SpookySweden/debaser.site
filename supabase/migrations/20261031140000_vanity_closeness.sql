-- VANITY step 5 (SPEC-vanity.md): profile visits, the listen-along log, and FOR YOU's scoring function.
--
-- Privacy, as decided by Luke on 2026-10-31:
--   - profile visits are one row per pair (visitor, profile) with a count, never a list; nobody can read the
--     table, not even its own rows - it only feeds the score inside `music_for_you`;
--   - the listen-along log (who followed whose broadcast, for how long) is readable only by the listener;
--   - `music_for_you` answers only for the person asking: their closest visible people, why, and what each
--     of them played (capped at 3 a day per song). Hidden accounts and people with listening hidden are
--     never in it.
--
-- Re-runnable: `if not exists`, `create or replace`, policies and triggers dropped and recreated.

-- Profile visits ---------------------------------------------------------------------------------------

create table if not exists public.profile_visits (
  visitor_id uuid not null references auth.users (id) on delete cascade,
  profile_id uuid not null references auth.users (id) on delete cascade,
  visits integer not null default 1,
  last_visit timestamptz not null default now(),
  primary key (visitor_id, profile_id),
  constraint profile_visits_not_self check (visitor_id <> profile_id)
);

-- RLS on with no policies: nobody reads or writes this table directly. Only the two functions below do.
alter table public.profile_visits enable row level security;

-- One visit counted per pair per 30 minutes, so reloading a profile does not inflate it. Your own profile,
-- and accounts that do not exist, are ignored.
create or replace function public.record_profile_visit(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or target is null or target = auth.uid() then
    return;
  end if;
  if not exists (select 1 from public.profiles where id = target) then
    return;
  end if;

  insert into public.profile_visits (visitor_id, profile_id)
  values (auth.uid(), target)
  on conflict (visitor_id, profile_id) do update
    set visits = public.profile_visits.visits + 1, last_visit = now()
    where public.profile_visits.last_visit < now() - interval '30 minutes';
end;
$$;

revoke all on function public.record_profile_visit(uuid) from public;
grant execute on function public.record_profile_visit(uuid) to authenticated;

-- Listen-along log -------------------------------------------------------------------------------------

create table if not exists public.music_follows_log (
  id bigint generated always as identity primary key,
  listener_id uuid not null references auth.users (id) on delete cascade,
  host_id uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint music_follows_not_self check (listener_id <> host_id),
  constraint music_follows_order check (ended_at is null or ended_at >= started_at)
);

alter table public.music_follows_log enable row level security;

drop policy if exists "follows insertable by listener" on public.music_follows_log;
create policy "follows insertable by listener" on public.music_follows_log
  for insert with check (
    auth.uid() = listener_id
    and ended_at is null
    and started_at between now() - interval '1 minute' and now() + interval '1 minute'
  );

drop policy if exists "follows readable by listener" on public.music_follows_log;
create policy "follows readable by listener" on public.music_follows_log
  for select using (auth.uid() = listener_id);

drop policy if exists "follows endable by listener" on public.music_follows_log;
create policy "follows endable by listener" on public.music_follows_log
  for update using (auth.uid() = listener_id)
  with check (auth.uid() = listener_id and ended_at <= now() + interval '1 minute');

-- Only the end can change: who, whom and when it started are fixed once written.
create or replace function public.music_follows_guard()
returns trigger
language plpgsql
as $$
begin
  new.listener_id := old.listener_id;
  new.host_id := old.host_id;
  new.started_at := old.started_at;
  return new;
end;
$$;

drop trigger if exists music_follows_guard on public.music_follows_log;
create trigger music_follows_guard
  before update on public.music_follows_log
  for each row execute function public.music_follows_guard();

create index if not exists music_follows_listener_idx on public.music_follows_log (listener_id, started_at desc);
create index if not exists music_follows_host_idx on public.music_follows_log (host_id);

-- FOR YOU ----------------------------------------------------------------------------------------------
--
-- Closeness to each other visible account, for the person asking:
--   replies     forum replies either way (a reply to their post or reply, or theirs to yours)  x3 each
--   messages    comms messages either way in threads you share                                 x1 each (max 200)
--   together    minutes listening along either way (max 3h a session) / 5, plus 10 per stream room shared
--   visits      profile visits either way                                                      x1 each (max 20)
-- `reason` is whichever of the four weighed most. Then, for the `people` closest who show their listening,
-- every song they played and how often (capped at 3 a day per song).

create or replace function public.music_for_you(people integer default 12)
returns table (person_id uuid, closeness numeric, reason text, track_src text, plays bigint)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select auth.uid() as id
  ),
  reply_pairs as (
    select c.author_id as a, coalesce(p.author_id, t.author_id) as b
    from public.forum_comments c
    join public.forum_threads t on t.id = c.thread_id
    left join public.forum_comments p on p.id = c.parent_id
  ),
  replies as (
    select case when r.a = me.id then r.b else r.a end as person, count(*)::numeric as n
    from reply_pairs r, me
    where (r.a = me.id or r.b = me.id) and r.a is distinct from r.b and r.a is not null and r.b is not null
    group by 1
  ),
  members as (
    select thread_id, user_id from public.comms_members
    union select id, participant_a from public.comms_threads where participant_a is not null
    union select id, participant_b from public.comms_threads where participant_b is not null
  ),
  messages as (
    select x.person, least(count(*), 200)::numeric as n
    from (
      select mem.user_id as person
      from public.comms_messages m join members mem on mem.thread_id = m.thread_id, me
      where m.author_id = me.id and mem.user_id <> me.id
      union all
      select m.author_id
      from public.comms_messages m join members mem on mem.thread_id = m.thread_id, me
      where mem.user_id = me.id and m.author_id is not null and m.author_id <> me.id
    ) x
    group by 1
  ),
  follows as (
    select case when f.listener_id = me.id then f.host_id else f.listener_id end as person,
           sum(least(extract(epoch from (coalesce(f.ended_at, f.started_at) - f.started_at)) / 60, 180)) / 5 as n
    from public.music_follows_log f, me
    where f.listener_id = me.id or f.host_id = me.id
    group by 1
  ),
  room_people as (
    select room_id, author_id as person from public.watch_messages where author_id is not null
    union select id, original_host_id from public.watch_rooms where original_host_id is not null
    union select id, host_id from public.watch_rooms where host_id is not null
  ),
  rooms as (
    select other.person, count(distinct other.room_id)::numeric * 10 as n
    from room_people mine join room_people other on other.room_id = mine.room_id, me
    where mine.person = me.id and other.person <> me.id
    group by 1
  ),
  visits as (
    select case when v.visitor_id = me.id then v.profile_id else v.visitor_id end as person,
           sum(least(v.visits, 20))::numeric as n
    from public.profile_visits v, me
    where v.visitor_id = me.id or v.profile_id = me.id
    group by 1
  ),
  parts as (
    select person, n * 3 as replies, 0::numeric as messages, 0::numeric as together, 0::numeric as visits from replies
    union all select person, 0, n, 0, 0 from messages
    union all select person, 0, 0, n, 0 from follows
    union all select person, 0, 0, n, 0 from rooms
    union all select person, 0, 0, 0, n from visits
  ),
  scored as (
    select person, sum(replies) as replies, sum(messages) as messages, sum(together) as together, sum(visits) as visits
    from parts
    group by person
  ),
  top as (
    select s.person,
           s.replies + s.messages + s.together + s.visits as closeness,
           case greatest(s.replies, s.messages, s.together, s.visits)
             when s.replies then 'replies'
             when s.messages then 'messages'
             when s.together then 'together'
             else 'visits'
           end as reason
    from scored s
    join public.profiles pr on pr.id = s.person, me
    where me.id is not null
      and s.person <> me.id
      and not pr.is_hidden
      and not pr.hide_listening
    order by closeness desc
    limit greatest(1, least(people, 50))
  ),
  played as (
    select d.user_id, d.track_src, sum(d.n)::bigint as plays
    from (
      select l.user_id, l.track_src, least(count(*), 3) as n
      from public.music_listens l
      join top on top.person = l.user_id
      group by l.user_id, l.track_src, (l.listened_at at time zone 'utc')::date
    ) d
    group by d.user_id, d.track_src
  )
  select top.person, top.closeness, top.reason, played.track_src, played.plays
  from top
  join played on played.user_id = top.person
  order by top.closeness desc, played.plays desc;
$$;

revoke all on function public.music_for_you(integer) from public;
grant execute on function public.music_for_you(integer) to authenticated;
