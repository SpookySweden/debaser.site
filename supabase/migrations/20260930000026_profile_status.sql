-- -----------------------------------------------------------------------------
-- A status line for a profile
-- -----------------------------------------------------------------------------
-- Paste this whole file into the Supabase SQL editor and run it. Idempotent: running it twice changes
-- nothing the second time, and nothing here drops or rewrites a row.
--
-- Why: a profile could say what somebody *is* (a bio, a place) but not what they are *doing*. The
-- presence lamp answers a different question - whether a tab is open - and it is the store's fact
-- rather than the owner's sentence. The side panel shows this line beside the name, and the
-- customiser's identity tab is where it is written.
--
-- Empty is the default and means "not written", which is why the column is `not null default ''`
-- rather than nullable: there is one way to say nothing, not two.

alter table public.profiles
  add column if not exists status text not null default '';

-- No new policy and no new grant. The status is a column on a profile, and the profile's own policies
-- already say who may read it (everybody, which is what makes a name printable on a post) and who may
-- write it (only its owner). Adding a rule here would be a second answer to a question already
-- answered.

-- -----------------------------------------------------------------------------
-- Done. To check it landed:
--   select display_name, status from public.profiles where status <> '' order by updated_at desc;
-- -----------------------------------------------------------------------------
