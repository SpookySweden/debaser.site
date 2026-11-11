-- A letter travels inside a recommendation (Luke, 2026-11-11): "when recommending a letter, ensure it comes with the letter
-- icon which you can click to see the canvas of the letter, recommending a letter literally includes the letter itself as
-- well as a kind of queue".
--
-- What this changes (Luke's OK, 2026-11-11):
--   - recommendations.letter: a copy of the letter as it was sent: its name, description, text colour, stamp picture,
--     the pattern's opacity and density, and where each of the recommendation's things sits on its canvas. Null for a
--     recommendation that isn't a letter. At most 32 KB, and only those fields: the send builds it, never a browser.
--   - recommendation_send() takes the letter (a fifth argument, null when there's none), checks every field, and makes
--     the letter's name the title. Every check it had stays.
--   - recommendations_list() hands the letter copy back with each row. Who may read what is unchanged: the copy is read
--     exactly as its recommendation is, so a private letter sent to chosen people is seen by them and nobody else.
--
-- Re-runnable: the column `if not exists`; the functions dropped by their old signatures and made again.

alter table public.recommendations add column if not exists letter jsonb;
alter table public.recommendations drop constraint if exists recommendations_letter_shape;
alter table public.recommendations
  add constraint recommendations_letter_shape check (letter is null or (jsonb_typeof(letter) = 'object' and pg_column_size(letter) < 32768));

drop function if exists public.recommendation_send(text, boolean, jsonb, uuid[]);
drop function if exists public.recommendation_send(text, boolean, jsonb, uuid[], jsonb);

create or replace function public.recommendation_send(p_message text, p_public boolean, p_items jsonb, p_to uuid[], p_letter jsonb default null)
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
  letter jsonb := null;
  letter_name text;
  stamp text;
  colour text;
  places jsonb := '[]'::jsonb;
  place jsonb;
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

  -- The letter copy: rebuilt here field by field, so nothing but these fields, in these shapes, is ever kept.
  if p_letter is not null and jsonb_typeof(p_letter) = 'object' then
    letter_name := left(btrim(coalesce(p_letter ->> 'name', '')), 40);
    if letter_name = '' then
      raise exception 'a letter needs a name';
    end if;
    stamp := nullif(p_letter ->> 'stampUrl', '');
    if stamp is not null and (length(stamp) > 500 or not (stamp like 'https://%' or (stamp like '/%' and stamp not like '//%'))) then
      stamp := null;
    end if;
    colour := nullif(p_letter ->> 'textColour', '');
    if colour is not null and colour !~ '^#[0-9a-fA-F]{6}$' then
      colour := null;
    end if;
    if jsonb_typeof(p_letter -> 'places') = 'array' then
      for place in select value from jsonb_array_elements(p_letter -> 'places') limit 50
      loop
        places := places || jsonb_build_array(jsonb_build_object(
          'x', least(greatest(coalesce((place ->> 'x')::numeric, 0.5), 0), 1),
          'y', least(greatest(coalesce((place ->> 'y')::numeric, 0.5), 0), 1),
          'turn', least(greatest(coalesce((place ->> 'turn')::integer, 0), -15), 15)
        ));
      end loop;
    end if;
    letter := jsonb_build_object(
      'name', letter_name,
      'description', left(coalesce(p_letter ->> 'description', ''), 200),
      'textColour', colour,
      'stampUrl', stamp,
      'stampOpacity', least(greatest(coalesce((p_letter ->> 'stampOpacity')::integer, 30), 0), 100),
      'stampDensity', least(greatest(coalesce((p_letter ->> 'stampDensity')::integer, 4), 1), 10),
      'places', places
    );
  end if;

  first_title := left(btrim(coalesce(p_items -> 0 ->> 'title', '')), 200);
  if first_title = '' then
    first_title := 'SOMETHING';
  end if;
  -- Luke's rules: a letter is titled by its name; otherwise the message, or with one thing or no message, the thing's own.
  title := case
    when letter is not null then letter_name
    when n = 1 then first_title
    when message <> '' then message
    else first_title || ' AND ' || (n - 1) || ' MORE'
  end;

  insert into public.recommendations (sender, message, title, is_public, letter)
  values (me, message, title, coalesce(p_public, false), letter)
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
revoke all on function public.recommendation_send(text, boolean, jsonb, uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.recommendation_send(text, boolean, jsonb, uuid[], jsonb) to authenticated;

drop function if exists public.recommendations_list(text, integer);

create or replace function public.recommendations_list(p_tab text, p_limit integer)
returns table (
  id uuid, sender uuid, sender_name text, title text, message text, is_public boolean, forum_thread_id uuid,
  created_at timestamptz, read_at timestamptz, item_count integer, letter jsonb
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
             r.forum_thread_id, r.created_at, null::timestamptz, (select count(*)::integer from public.recommendation_items i where i.recommendation_id = r.id), r.letter
      from public.recommendations r
      join public.profiles p on p.id = r.sender
      where r.is_public and not p.is_hidden and p.banned_at is null
      order by r.created_at desc
      limit most;
  elsif p_tab = 'for_me' and named then
    return query
      select r.id, r.sender, p.display_name, r.title, r.message, r.is_public, r.forum_thread_id, r.created_at, t.read_at,
             (select count(*)::integer from public.recommendation_items i where i.recommendation_id = r.id), r.letter
      from public.recommendation_to t
      join public.recommendations r on r.id = t.recommendation_id
      join public.profiles p on p.id = r.sender
      where t.person = me
      order by r.created_at desc
      limit most;
  elsif p_tab = 'sent' and named then
    return query
      select r.id, r.sender, p.display_name, r.title, r.message, r.is_public, r.forum_thread_id, r.created_at, null::timestamptz,
             (select count(*)::integer from public.recommendation_items i where i.recommendation_id = r.id), r.letter
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
