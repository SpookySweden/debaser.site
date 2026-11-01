-- -----------------------------------------------------------------------------
-- Watch together: the database's clock, for the order people joined a room (2026-10-27)
-- -----------------------------------------------------------------------------
-- Run with `npm run db:push`. Idempotent (create or replace). Reads no table and changes nothing.
--
-- Who hosts next is whoever has been in the room longest (decision 6). Each tab used to stamp its own
-- join time from its own clock, so a machine whose clock ran slow looked as if it had joined early and
-- jumped the queue. A tab now asks this for the time as it joins, so every join is stamped by one clock.

create or replace function public.watch_now()
returns timestamptz
language sql
stable
set search_path = public
as $$
  select now();
$$;

revoke all on function public.watch_now() from public;
grant execute on function public.watch_now() to anon, authenticated;
