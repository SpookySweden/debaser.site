-- -----------------------------------------------------------------------------
-- How a profile picture is cut to its square
-- -----------------------------------------------------------------------------
-- Idempotent: running it twice changes nothing the second time, and nothing here drops or rewrites
-- a row. Every existing profile reads as the defaults: cropped, square in the middle.
--
-- Why (Luke, 2026-10-30): a wide or tall picture was squeezed to the box's width, so a board row
-- showed a thin strip and a profile's frame grew tall. Pictures are now shown cut to a square; the
-- uploaded file is never touched. The owner can switch the crop off (the whole picture, with bars)
-- or drag the square to the part they want. `avatar_crop_x` / `_y` are CSS object-position
-- percentages (0 = left/top edge, 100 = right/bottom). debaser.site's picture is never cut - that
-- is decided in the app (app/lib/profile/avatar-crop.ts), not here.

alter table public.profiles
  add column if not exists avatar_crop boolean not null default true,
  add column if not exists avatar_crop_x smallint not null default 50,
  add column if not exists avatar_crop_y smallint not null default 50;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_avatar_crop_range') then
    alter table public.profiles
      add constraint profiles_avatar_crop_range
      check (avatar_crop_x between 0 and 100 and avatar_crop_y between 0 and 100);
  end if;
end $$;

-- No new policy: these are columns on a profile, and the profile's own policies already say who may
-- read them (everybody) and who may write them (only the owner).

-- -----------------------------------------------------------------------------
-- Done. To check it landed:
--   select display_name, avatar_crop, avatar_crop_x, avatar_crop_y from public.profiles limit 5;
-- -----------------------------------------------------------------------------
