AQUARIUM BACKGROUND
===================

The pictures behind the AQUARIUM background (PREFERENCES > BACKGROUND, the default since 2026-11-15).

They are NOT Luke's drawings. They are Microsoft's, from the "Underwater" aquarium screensaver of
Microsoft Plus! 95 for Kids, which ran on Windows 98. Luke made them an exception to the hand-drawn
rule on 2026-11-15 ("use the actual one its okay to put other art to use in this case"); the
exception is written in .claude/rules/core.md under Asset Rules. Said once: they are Microsoft's
art, and if Microsoft ever objects they come down and TILE takes over.

Where they came from
--------------------
Cut out of a recording of the screensaver running, "aquarium gif.gif" (540x394, 142 frames at
10 a second), from the Internet Archive item uwater_202602
(https://archive.org/details/uwater_202602). The same item holds the screensaver's own Uwater.dll,
which carries the original pictures at full quality; it was not downloaded (an anonymously
uploaded program file). If Luke ever drops that file into Temp/uwater/, the originals can be taken
out of it as pictures (never run) and replace these.

How they were cut: the still scene is the median of every frame (the fish move, the coral does
not), each fish is whatever a frame has that the still scene doesn't, aligned on its middle, and
the black sea is keyed out so the edges keep their colour.

The files
---------
coral-left.png     216x208  the bank in the bottom-left corner
coral-right.png    178x141  the bank in the bottom-right corner
fish-butterfly.png 6 frames of 81x55, facing right (yellow butterflyfish)
fish-trigger.png   11 frames of 97x73, facing right (blue triggerfish)
fish-ray.png       6 frames of 120x62, facing left (stingray)
fish-stripe.png    6 frames of 76x54, facing right (threadfin butterflyfish)
bubble-big.png     7x7
bubble-small.png   5x5
pellet.png         3x3      the food FEED ON CLICK drops: a patch of the orange sponge, cut from
                            coral-left.png at 15,187 (Temp/browse/cut-pellet.cjs), not drawn

Every one is shown at a whole-number zoom, pixel for pixel: 2x as it came, and whatever the
AQUARIUM window's size knobs say (SPEC-aquarium-settings.md). app/lib/aquarium/sim.ts holds the
fish sizes and app/components/Aquarium.tsx the coral's; change a file and its size together.
These are not slots in app/lib/ui/art/slots.ts: nothing here is waiting to be drawn.
