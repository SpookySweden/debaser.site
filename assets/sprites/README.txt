SPRITES - the looping pixel art the GUI leaves room for
=======================================================

Nothing in this folder is generated. Every file is drawn by hand on the tablet, the same
way every sheet, avatar and cursor on this site is (see AGENTS.md, Asset Rules). Code
never stands in for artwork: a component that needs one points at a path in here and
leaves a dark dithered field where the file will go, so the layout is already correct and
the drawing can land later without touching a line of TypeScript.

The slots that exist today, and what belongs in each:

  walk-cycle.gif   24x24, 4 frames, loops. The little figure that walks along the taskbar
                   (app/components/Taskbar.tsx). Loose and hand-made, in the site's palette.

  profile.gif      24x24, loops. The sprite beside a profile's status line
                   (app/components/ProfileStatusBar.tsx). Anything that moves: a blinking
                   thing, a bobbing thing, whatever the account is.

Adding a slot: a component imports `SpriteSlot` and gives it a path in here, a size, and
the words for what it is. A GIF may use any palette, but the sizes above are what the
layout has been built around, so a replacement at another size will move things.

Until a file exists its URL 404s and the slot stays an empty dithered field - the site
reads normally, and the sprite appears the moment the file is committed.
