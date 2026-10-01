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

Draw at 48x32 and let it downscale into those - the pixel face does not resample, so a file drawn
at the size it is shown is the only one that stays crisp.

UNTIL A FILE LANDS
------------------

Nothing breaks: `app/components/CountryFlag.tsx` points a SpriteSlot at the path whether or not
the file exists, and a slot whose file 404s draws the two letters of the code instead - the same
answer the rest of the archive gives for artwork that is not made yet. So the site is honest about
a flag nobody has drawn, and flags can be added one country at a time.

