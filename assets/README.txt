HAND-DRAWN ART ARCHIVE
======================

Every drawing for this site lives in THIS folder, inside the project, as plain
files - artwork is never kept in public/ and never generated in code.

Folder layout
-------------
assets/concepts/     concept sheets shown on /concepts
assets/placeholders/ stand-in slots for artwork that does not exist yet
assets/sprites/      the looping avatar sprites used by the taskbar

How it is served
----------------
app/assets/[...path]/route.ts streams these files at the matching URL, e.g.

  assets/concepts/concept-sheet-01.png  ->  /assets/concepts/concept-sheet-01.png

Anything missing returns a 404 and the page shows an
"[ ARTWORK FILE NOT FOUND ]" panel naming the path it wanted.

Adding a new concept sheet
--------------------------
1. Save the PNG here as assets/concepts/concept-sheet-NN.png
2. Add one entry to CONCEPT_SHEETS in app/lib/concepts/sheets.ts (id, title,
   caption, src, width, height). The entry's anchor gives that picture its own
   forum thread, which the [ COMMENT ] control under the artwork pops open.
3. No other wiring needed - the sheet window, the sheet index and the forum
   "FILE UNDER" drop-down all read from that manifest.

Rules
-----
- Art is hand-drawn on a Kamvas tablet and added here by hand.
- Keep the exported aspect ratio in sync with the width/height in the manifest.
- 0px border-radius everywhere: framing is done with the Win95 window chrome
  in the components, not baked into the artwork.
