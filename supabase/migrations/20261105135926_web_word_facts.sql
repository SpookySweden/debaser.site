-- The word pass (SPEC-tag-station.md; Luke's OK 2026-11-05): Claude reads the list of different words and says what type each one is,
-- which other word it duplicates, and whether it is too vague to mean anything. Only TAG STATION reads the answers.
--
-- What this adds, and nothing else. web_item_tags, web_seen_items and every other table are not altered, and no row in them is
-- changed: MEDIA's ordering reads the same words as before, whatever happens to this pass.
--   - web_word_facts: one row per different word. Signed-in people can read the word, its type, its twin and whether it's vague;
--     nobody can write through the API.
--   - web_word_*: what /api/web/tag needs, callable with the public key but useless without the lock, like the web_tag_* functions.
--     Wrong lock: SQLSTATE 28000.
--   - web_tag_limit_reached (from 20261105130709_web_seen_items.sql) now answers yes from $59.90: the job stops when the worst case of
--     what's left no longer fits, which can be a little under $60, and the notice on the page must not wait for a figure it never reaches.
--
-- Re-runnable: `if not exists`, `create or replace`, constraint and policy dropped and recreated by name, grants revoked before given.

create table if not exists public.web_word_facts (
  word text collate "C" primary key,
  -- Null until answered.
  facet text,
  -- The word this one means the same as, if any. Never applied to web_item_tags: TAG STATION joins them when it builds its map.
  same_as text,
  vague boolean not null default false,
  -- The Message Batch this word is out in, if any.
  batch_id text,
  -- Batches that came back without a usable answer; stops at 3.
  tries integer not null default 0,
  answered_at timestamptz
);

alter table public.web_word_facts drop constraint if exists web_word_facts_facet_values;
alter table public.web_word_facts add constraint web_word_facts_facet_values
  check (facet is null or facet in ('genre', 'mood', 'place', 'era', 'form', 'subject'));
alter table public.web_word_facts drop constraint if exists web_word_facts_word_size;
alter table public.web_word_facts add constraint web_word_facts_word_size
  check (char_length(word) between 1 and 60 and (same_as is null or char_length(same_as) between 1 and 60));

create index if not exists web_word_facts_batch_idx on public.web_word_facts (batch_id) where batch_id is not null;

alter table public.web_word_facts enable row level security;

drop policy if exists "word facts readable by the signed in" on public.web_word_facts;
create policy "word facts readable by the signed in" on public.web_word_facts
  for select to authenticated using (true);

revoke all on public.web_word_facts from public, anon, authenticated;
grant select (word, facet, same_as, vague) on public.web_word_facts to authenticated;

-- Words in use with no answer yet, and not out in a batch.
create or replace function public.web_word_waiting(p_secret text, p_limit integer)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  return query
    select u.word
    from (
      select distinct lower(w) as word from public.web_item_tags t, unnest(t.words) w
      union
      select distinct lower(w) from public.web_seen_items s, unnest(s.words) w
      union
      select distinct lower(w) from public.web_items i, unnest(i.tags) w where i.enabled
    ) u
    left join public.web_word_facts f on f.word = u.word
    where char_length(u.word) between 1 and 60
      and (f.word is null or (f.facet is null and f.batch_id is null and f.tries < 3))
    order by u.word
    limit least(greatest(coalesce(p_limit, 0), 0), 1000);
end;
$$;

-- The words in use, commonest first, so Claude can spot a duplicate of a word that isn't in the same small list.
create or replace function public.web_word_vocabulary(p_secret text, p_limit integer)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  return query
    select u.word
    from (
      select lower(w) as word from public.web_item_tags t, unnest(t.words) w
      union all
      select lower(w) from public.web_seen_items s, unnest(s.words) w
      union all
      select lower(w) from public.web_items i, unnest(i.tags) w where i.enabled
    ) u
    where char_length(u.word) between 1 and 60
    group by u.word
    order by count(*) desc, u.word
    limit least(greatest(coalesce(p_limit, 0), 0), 2000);
end;
$$;

create or replace function public.web_word_pending(p_secret text)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  return query select distinct f.batch_id from public.web_word_facts f where f.batch_id is not null limit 5;
end;
$$;

create or replace function public.web_word_out(p_secret text, p_batch text)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  return query select f.word::text from public.web_word_facts f where f.batch_id = p_batch limit 1000;
end;
$$;

create or replace function public.web_word_sent(p_secret text, p_batch text, p_words text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  insert into public.web_word_facts (word, batch_id)
    select w, p_batch from unnest(p_words) w where char_length(w) between 1 and 60
  on conflict (word) do update set batch_id = excluded.batch_id;
end;
$$;

create or replace function public.web_word_save(p_secret text, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  update public.web_word_facts f
    set facet = r.value ->> 'facet',
        same_as = nullif(r.value ->> 'sameAs', ''),
        vague = coalesce((r.value ->> 'vague')::boolean, false),
        batch_id = null,
        answered_at = now()
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where f.word = r.value ->> 'word';
end;
$$;

-- What a finished batch left without an answer goes back in the queue, one try down.
create or replace function public.web_word_release(p_secret text, p_batch text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  update public.web_word_facts f set batch_id = null, tries = f.tries + 1 where f.batch_id = p_batch;
end;
$$;

-- All a signed-in reader can learn about the spending: whether the limit has stopped the tagging.
create or replace function public.web_tag_limit_reached()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(t.usd), 0) >= 59.9 from public.web_tag_spend t;
$$;

revoke all on function public.web_word_waiting(text, integer) from public, anon, authenticated;
revoke all on function public.web_word_vocabulary(text, integer) from public, anon, authenticated;
revoke all on function public.web_word_pending(text) from public, anon, authenticated;
revoke all on function public.web_word_out(text, text) from public, anon, authenticated;
revoke all on function public.web_word_sent(text, text, text[]) from public, anon, authenticated;
revoke all on function public.web_word_save(text, jsonb) from public, anon, authenticated;
revoke all on function public.web_word_release(text, text) from public, anon, authenticated;

grant execute on function public.web_word_waiting(text, integer) to anon;
grant execute on function public.web_word_vocabulary(text, integer) to anon;
grant execute on function public.web_word_pending(text) to anon;
grant execute on function public.web_word_out(text, text) to anon;
grant execute on function public.web_word_sent(text, text, text[]) to anon;
grant execute on function public.web_word_save(text, jsonb) to anon;
grant execute on function public.web_word_release(text, text) to anon;
