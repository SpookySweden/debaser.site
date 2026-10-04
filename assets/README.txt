HAND-DRAWN ART ARCHIVE
======================

Every drawing for this site lives in THIS folder, inside the project, as plain
files - artwork is never kept in public/ and never generated in code.

Folder layout
-------------
assets/concepts/     concept sheets shown on /concepts
assets/audio/        the music shelf's tracks, played on /music
assets/icons/        sign-in marks (google-retro.png) and other small marks
assets/cursors/      the retro pointers named in app/globals.css
assets/flags/        the country flags a profile may wear (ISO 3166-1 alpha-2 names,
                     lowercase: se.png, gb.png), read by app/lib/profile/countries.ts
assets/sprites/      the looping avatar sprites used by the taskbar
assets/profiles/     public profile pictures (the default pfp avatar-default.png,
                     and uploads/ written by the app itself)

There is no `placeholders/` folder, deliberately: a drawing that does not exist
yet is not represented by a stand-in picture (AGENTS.md - "no CSS/SVG art", and
the asset rules above). Every component that has room for artwork draws its own
missing state instead - a dithered field, a `[ ? ]`, or the two letters of a
country code - so an undrawn file is visible as a gap rather than as a picture
that is not yours.

How it is served
----------------
app/assets/[...path]/route.ts streams these files at the matching URL, e.g.

  assets/concepts/concept-sheet-01.png  ->  /assets/concepts/concept-sheet-01.png

Anything missing returns a 404 and the page shows an
"[ ARTWORK FILE NOT FOUND ]" panel naming the path it wanted.

The sizes, and the one rule that keeps a drawing crisp
------------------------------------------------------
`app/lib/ui/art/slots.ts` declares every slot this site has - what it is
called, the size to draw it at, the size it is shown at, and where its file
lives. `npm run art` reads that registry and holds the files on disk to it.

The rule, and it is the only one that matters for how a drawing looks:

    natural = shown x k        k a whole number, 1 or more

The site never resamples. A drawn pixel either becomes a whole number of
screen pixels or the browser blurs it into a smooth edge, and pixel art that
has been blurred is no longer pixel art. So a slot shown at 18x12 is drawn at
18x12 (k=1), or 36x24 (k=2), or 72x48 (k=4) - and **not** at 48x32, which is
2.67 and gets refused by `npm run art`. Drawing larger and letting the site
downscale is the right instinct and this is the arithmetic that makes it work:
a 4x drawing on a 2x screen is still whole pixels, and it survives a 4x screen
too. `assets/flags/README.txt` is where that correction was made on a real
slot (it used to say 48x32).

A second rule follows from the first and is what the audit's contact sheet
(`npm run art -- --sheet`) is for: **a slot's file must be the size the
registry declares**, because the registry is also what the layout reserves.
A file drawn at another size is not a smaller mistake than a missing one - it
is a row that reflows the moment the drawing lands.

Adding a new concept sheet
--------------------------
1. Save the PNG here as assets/concepts/concept-sheet-NN.png
2. Add one entry to CONCEPT_SHEETS in app/lib/concepts/sheets.ts (id, title,
   caption, src, width, height). The entry's anchor gives that picture its own
   forum thread, which the [ COMMENT ] control under the artwork pops open.
3. No other wiring needed - the sheet window, the sheet index and the forum
   "FILE UNDER" drop-down all read from that manifest.

Adding a track
--------------
1. Save the audio here as assets/audio/<id>.mp3 (MP3, M4A, OGG, WAV and FLAC are
   served; anything else is refused with a 400). The id is
   `<artist>-<album>-<number>`, built from the release in the catalogue.
2. Add the release to RELEASES in app/lib/projects/tracks.ts (artist, album, year,
   tags, and the track list with a running time each).
3. /music lists it under its artist and release, and the project page at
   /projects/debaser counts it. Until the file is there, pressing play answers with
   the player's own words rather than a dead button.

A track reads as `[TRACK TITLE] - [ALBUM NAME] - [ARTIST NAME]` everywhere it is
listed, and the same three parts are what the directory sorts and searches on.

Rules
-----
- Art is hand-drawn on a Kamvas tablet and added here by hand.
- Keep the exported aspect ratio in sync with the width/height in the manifest.
- 0px border-radius everywhere: framing is done with the Win95 window chrome
  in the components, not baked into the artwork.

Adding a profile picture
------------------------
Two ways, both ending in the same place - a picture the site can serve:

1. Upload: use the "[ CUSTOMISE PUBLIC PROFILE ]" console on /account, in the
   PICTURE, BIO & TAGS tab, and pick a file.
2. Pick one the site already holds: the same tab offers the drawings on the site
   whose shape suits a profile picture (`SITE_PICTURES` in
   app/lib/profile/avatar-catalogue.ts, which offers a concept sheet when its
   exported size is within `PROFILE_PICTURE_SLACK` of square). Add a sheet to
   assets/concepts/ with an entry in the manifest and it appears there by itself if
   its shape fits.

Where an upload lands depends on where profiles live (app/lib/profile/avatar-upload.ts):

- Profiles on Supabase: the drawing goes to the public `avatars` storage bucket,
  from the browser, under the visitor's own session. The path is
  `<account id>/avatar-v<version>-<stamp>.<ext>` and the bucket's policies read
  that first segment, so an account can only file into its own folder. Nothing
  lands on disk, which is what makes uploads work on a read-only host.
- Profiles on the mock store: POST /api/profile/avatar writes it into
  assets/profiles/uploads/ and returns the path it now serves, exactly as before.

Either way every change is filed as a new avatar version in the profile store, so
old pictures are never overwritten and the comments written against them keep
pointing at the right one.

The upload route needs a writable disk. On a read-only host it replies with a clear
message - and that is the case the storage bucket exists for.

The fixed slots (assets/profiles/avatar-slot-NN.png) are gone: a profile that was
filed against one still shows it, because a version stores whatever src it was filed
with, but nobody can pick a slot any more.
