-- MEDIA's picks, a fix to 20261104120000_web_item_tags.sql (Luke's OK 2026-11-04). The Batches API limits a custom id to
-- 64 characters and most items' ids are longer, so the job sends a digest of each id, and needs the list of what is in a
-- batch to turn the answers back into ids. Reads only: no table changes, nothing altered or deleted. Callable with the
-- public key but useless without the lock, like the other web_tag_* functions.
--
-- Re-runnable: `create or replace`, grants revoked before they are given.

create or replace function public.web_tag_out(p_secret text, p_batch text)
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
  return query select t.item_id::text from public.web_item_tags t where t.batch_id = p_batch limit 1000;
end;
$$;

revoke all on function public.web_tag_out(text, text) from public, anon, authenticated;
grant execute on function public.web_tag_out(text, text) to anon;
