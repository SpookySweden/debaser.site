-- The word cap's check inside web_sweep_stats_add reads the database's own estimate of the row count instead of counting (2026-11-06). Counting 50,000 rows ran past the API's 3 seconds a
-- statement on a fresh connection, which stopped the job at 02:58. Same check, same cap of 300,000 (20261106050000_web_word_stats_cap.sql), no data touched. Re-runnable.
create or replace function public.web_sweep_stats_add(p_secret text, p_batch text, p_part integer, p_stats jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  place integer;
  held integer;
begin
  if not public.web_ingest_lock_ok(p_secret) then
    raise exception 'not allowed' using errcode = '28000';
  end if;
  insert into public.web_sweep_batches (batch_id) values (p_batch) on conflict (batch_id) do nothing;
  select b.stats_part into place from public.web_sweep_batches b where b.batch_id = p_batch for update;
  if place <> p_part then
    return;
  end if;

  -- Existing words always count. A new word only comes in while there's room for it.
  -- The database's own estimate: counting the rows took past the API's 3 seconds a statement, and stopped the job.
  select c.reltuples::integer into held from pg_catalog.pg_class c where c.oid = 'public.web_word_stats'::regclass;
  insert into public.web_word_stats as s (word, items, partners)
    select r.value ->> 'word', (r.value ->> 'items')::integer, coalesce(r.value -> 'partners', '{}'::jsonb)
    from jsonb_array_elements(coalesce(p_stats, '[]'::jsonb)) r
    where held < 300000 or r.value ->> 'word' = '#total' or exists (select 1 from public.web_word_stats e where e.word = r.value ->> 'word')
  on conflict (word) do update
    set items = s.items + excluded.items,
        partners = (
          select coalesce(jsonb_object_agg(t.k, t.v), '{}'::jsonb)
          from (
            select m.k, sum(m.v)::integer as v
            from (
              select o.key as k, o.value::integer as v from jsonb_each_text(s.partners) o
              union all
              select n.key, n.value::integer from jsonb_each_text(excluded.partners) n
            ) m
            group by m.k
            order by v desc, m.k
            limit 100
          ) t
        );

  update public.web_sweep_batches set stats_part = p_part + 1 where batch_id = p_batch;
end;
$$;
