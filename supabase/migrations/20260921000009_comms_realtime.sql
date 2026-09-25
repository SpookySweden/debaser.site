-- ---------------------------------------------------------------------------
-- The comms tables in the realtime publication
-- ---------------------------------------------------------------------------
-- Run this in the Supabase SQL editor (Dashboard -> SQL Editor -> New query) on a
-- project whose `supabase_realtime` publication is missing any of the four comms
-- tables. It is section 9 of supabase/schema.sql as a file you can paste on its own,
-- it only adds what is missing, and it is safe to re-run.
--
-- Why it matters, and why this is the least obvious thing in the whole comms feature:
--
--   a channel bound to a table that is NOT in the publication does not fail on its own.
--   The channel reports SUBSCRIBED, and then no event from ANY of its tables is ever
--   delivered. One un-published table silences the lot.
--
-- That is exactly what happened here: the comms store watched `comms_messages`,
-- `comms_threads` and `comms_members` - which were published - and `comms_reads`, which
-- was not. Every event was therefore dropped, so a message that arrived while a page was
-- open was never shown, a member added to a group never appeared, and nothing moved
-- until a reload. The client no longer binds `comms_reads` (see the note on `openChannel`
-- in app/lib/comms/supabase-comms-repository.ts), so the site works either way; running
-- this publishes the four together, so the publication and the code agree.

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comms_threads') then
    alter publication supabase_realtime add table public.comms_threads;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comms_messages') then
    alter publication supabase_realtime add table public.comms_messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comms_members') then
    alter publication supabase_realtime add table public.comms_members;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comms_reads') then
    alter publication supabase_realtime add table public.comms_reads;
  end if;
end $$;

-- Check it landed: all four rows should be there, `replicaidentity` aside.
--
--   select tablename, pubname from pg_publication_tables
--     where schemaname = 'public' and tablename like 'comms%' order by tablename;
