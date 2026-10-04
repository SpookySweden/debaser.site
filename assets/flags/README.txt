COUNTRY FLAGS
=============

Every file in this folder is hand-drawn, on the tablet, like every other picture on the site.
No AI-generated artwork, no CSS gradients, no SVG and no emoji standing in for a drawing
(AGENTS.md -> Asset Rules, and the rules at the foot of assets/README.txt).

NAMING
------

One file per country, named after the ISO 3166-1 alpha-2 code, LOWERCASE, with a .png extension:

    se.png    Sweden
    us.png    United States
    gb.png    United Kingdom

Lowercase because `countryFlagPath()` in `app/lib/profile/countries.ts` builds the path from the
code with `.toLowerCase()`, and one file per country in two cases is a way to be wrong quietly on
a case-sensitive host. It is served by the archive route like every other drawing:

    assets/flags/se.png   ->   /assets/flags/se.png

SIZE
----

Drawn at 3:2, two sizes are used:

    18x12   beside a name in a post's byline (PostAuthorRow)
    24x16   on a profile panel and in the customiser's preview

**One file serves both, so it has to be a whole multiple of both at once.** The
rule everywhere in this archive is `natural = shown x k` with `k` a whole number
(assets/README.txt), and 18x12 and 24x16 have no common whole multiple below
their lowest common multiple - so the file to draw is:

    72x48    x4 into the byline slot, x3 into the profile slot

This README said "draw at 48x32" until 2026-10-04, and that is x2.67 and x1.5 -
two different fractions of a pixel, which is exactly what makes a flag look
smeared rather than drawn. `npm run art` now fails on a file whose size is not a
whole multiple of its slot, so the old number could not have landed quietly.

UNTIL A FILE LANDS
------------------

Nothing breaks: `app/components/CountryFlag.tsx` points a SpriteSlot at the path whether or not
the file exists, and a slot whose file 404s draws the two letters of the code instead - the same
answer the rest of the archive gives for artwork that is not made yet. So the site is honest about
a flag nobody has drawn, and flags can be added one country at a time.

