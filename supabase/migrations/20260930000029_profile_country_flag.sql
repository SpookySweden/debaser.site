-- -----------------------------------------------------------------------------
-- A country flag on a profile, in place of the free-text place line
-- -----------------------------------------------------------------------------
-- Idempotent: running it twice changes nothing the second time, and nothing here drops a row.
--
-- Why: a profile could say a *place* - forty characters of free text - and a place is not something
-- this site can draw, sort, group or check. Two accounts could spell the same country two ways, and
-- a byline carried a sentence where it wanted a picture. A country is a code off a closed list
-- (app/lib/profile/countries.ts holds the 249 ISO 3166-1 alpha-2 codes, and the check beside it
-- proves the list), so the byline can draw the flag beside the name, the customiser can offer a
-- picker instead of a text box, and a value that is not a country can be refused.
--
-- The column is `country_code` rather than `country` because what is stored is a *code*: the name is
-- asked of `Intl.DisplayNames` at read time, so a name that changes does not need a migration.
--
-- Empty is the default and means "no flag", which is one way to say nothing rather than two - the
-- same arrangement the status line above has.

alter table public.profiles
  add column if not exists country_code text not null default '';

-- A hand-written request must not be able to put a sentence in a country's place, exactly as
-- `name_colour` is kept to its own shape. The pattern is two uppercase letters, which is the shape of
-- every ISO 3166-1 alpha-2 code; it does *not* check membership of the 249, because a check
-- constraint cannot see the site's list and a copied-out list in SQL is a second answer that drifts.
-- Membership is the application's rule (validateCountry + isCountryCode), and this is the backstop
-- that keeps a place line from being smuggled back into the column.
--
-- `not valid` because the rows already there are empty by the default: validating them is work with
-- one possible outcome, and skipping it means the constraint can be added to a live table without a
-- full scan.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_country_code_shape'
  ) then
    alter table public.profiles
      add constraint profiles_country_code_shape
      check (country_code = '' or country_code ~ '^[A-Z]{2}$') not valid;
  end if;
end $$;

-- No new policy and no new grant: this is a column on a profile, and the profile's own policies
-- already say who may read it (everybody - that is what lets a name on a post carry a flag) and who
-- may write it (only its owner).

-- -----------------------------------------------------------------------------
-- The old column is left where it is, on purpose
-- -----------------------------------------------------------------------------
-- `public.profiles.location` is not read by anything after this change, and it is *not* dropped here
-- either. What it holds is a sentence a real visitor typed ("Gothenburg", "bomboldilo land"), it
-- cannot be converted into a country automatically, and no rule on this project turns live
-- user-written content into nothing. Leaving it costs a byte a row.
--
-- If the owner decides to remove it later, that is a deliberate act and this is exactly what it is:
--
--   alter table public.profiles drop column if exists location;
--
-- Review first (`select id, location from public.profiles where location <> '';`) so the list of what
-- would go is read rather than assumed - the pattern in supabase/cleanup/.

-- -----------------------------------------------------------------------------
-- Done. To check it landed:
--   select display_name, country_code from public.profiles order by updated_at desc;
-- -----------------------------------------------------------------------------
