COUNTRY FLAGS
=============

These are the one ready-made set of pictures on the site, by Luke's choice (2026-11-03). Every
flag here was waiting to be hand-drawn, none had been, and every profile showed two tiny letters
instead. So the folder is filled from an open set of the official national designs:

    country-flag-icons 1.6.20 by catamphetamine (MIT licence, notice below)
    https://www.npmjs.com/package/country-flag-icons, its 3x2 SVGs
    drawn once into 72x48 PNGs by a browser; the SVGs themselves are not served

They are flags, not anybody's artwork, and nothing else on the site may follow this example:
everything else stays hand-drawn on the tablet (CLAUDE.md -> Asset Rules). A flag Luke draws
himself simply replaces its file. They are drawn smoothly rather than pixelated (`.country-flag`
in app/globals.css), because a 72x48 flag shrunk to 18x12 in whole pixels loses its stars.

The same flags stand for languages beside content titles (app/lib/web/language.ts says which
country stands for which language).

    The MIT License
    Copyright (c) 2020 @catamphetamine <purecatamphetamine@gmail.com>
    Permission is hereby granted, free of charge, to any person obtaining a copy of this software
    and associated documentation files (the "Software"), to deal in the Software without
    restriction, including without limitation the rights to use, copy, modify, merge, publish,
    distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
    Software is furnished to do so, subject to the following conditions:
    The above copyright notice and this permission notice shall be included in all copies or
    substantial portions of the Software.
    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
    BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
    NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
    DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

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

IF A FILE GOES MISSING
----------------------

Nothing breaks: `app/components/CountryFlag.tsx` points a SpriteSlot at the path, and a slot whose
file 404s draws the two letters of the code instead.

