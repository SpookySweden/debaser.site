# SPEC: Character creator overhaul ("canvas window")

Interviewed 2026-10-12. Build this in a fresh session. Read `docs/design.md` and CLAUDE.md first.

## Goal
Replace the current CHAR tab workbench (inside the profile customiser) with something that feels like a
Clip Studio Paint canvas window: two views of the same figure side by side, a clear tool strip, and
shapes you can freely add and reshape.

## What stays
- **Two views, side by side: FRONT and SIDE**, both flat (orthographic) cameras, as now. The drag maths
  depends on them being flat; don't switch to perspective.
- three.js via `@react-three/fiber`, state in the Zustand store (`app/lib/character/store.ts`), plain data
  in the store, never three.js objects.
- The skeleton and its presets (`rig.ts`, `skeleton.ts`): you can still pose joints.
- The 7 shape types in `shapes.ts` (box, sphere, cone, cylinder, capsule, wedge, prism).
- The shelf / character browser window, saving to the browser's local storage per account (no database
  work in this task).
- The "unsaved work asks before closing" rule.

## What changes
1. **Shapes are free, not one-per-joint.** Add as many as you like, anywhere. Each shape can optionally be
   **pinned to a joint**; a pinned shape moves AND turns with that joint when you pose it (like a sticker on a
   bone). Unpinned shapes stay where they are. A shape can be re-pinned or unpinned from the properties panel.
2. **Layout, Clip Studio style:**
   - Left: a thin vertical **tool strip**. Each tool shows a text label/glyph (text-character art is allowed,
     no drawn or SVG icons; see Asset Rules) and a tooltip with its name.
   - Middle: FRONT and SIDE views side by side.
   - Right: a **shape list** (works like a layers panel: select, rename, hide, delete, reorder) and below it a
     **properties panel** for the selected shape (type, colour, pin joint, exact position/rotation/size numbers).
3. **Tools in the strip:** Select, Add shape (pick one of the 7, click in a view to place it), Move, Rotate,
   Scale, Pose (drag skeleton joints), Delete. Move/Rotate/Scale use on-shape **handles** in whichever view you
   drag in (a transform box, like Clip Studio). Front view edits left/right + up/down; side view edits
   forward/back + up/down.
4. **Morphing scope this round: move, rotate, scale only.** Taper/bend, rounding and point-pulling are out.
5. **Render look becomes a view toggle.** You edit on plain shapes; a button flips the views to the
   pixelated "final look". The old SKELETON / MASS / BASE / PIXEL layer tabs go away. Lighting moves into the
   properties panel (as a scene setting when nothing is selected).
6. **Undo / redo:** buttons plus Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z too). One undo step per finished drag, not per
   pixel of movement.
7. **Works on phones:** at narrow widths the tool strip becomes a horizontal row, the two views stack, and the
   right panels fold under them. Handles must be big enough for a thumb (tap targets the audit accepts).

## Old saves
**Start fresh.** Figures saved in the old format are not converted. Bump the storage key
(`debaser.character.library.v1` in `library.ts`) to a v2 so old data is ignored rather than misread.
Agent's note for Luke: this loses any figure anyone has already put on their shelf. It's only in each
person's own browser, so nothing on the server is touched, but tell any testers before it ships.

## Out of scope
- Taper, bend, rounding, vertex pulling.
- Mirror/symmetry, keyboard shortcuts beyond undo/redo (both good next steps).
- Saving figures to Supabase / sharing them between people.
- A third (perspective) view.
- Any artwork: if a tool needs an icon beyond text, add a `SpriteSlot` placeholder and stop.

## Edge cases to handle
- Deleting a joint's shapes doesn't delete the joint; deleting/re-picking a rig preset unpins shapes whose
  joint no longer exists (they stay in place, unpinned) rather than deleting them.
- Hidden shapes can't be grabbed in the views.
- A drag that leaves the view still finishes cleanly (one undo step).
- Closing with unsaved changes asks first (existing `unsaved-changes.ts` rule).
- Reduced motion: no animated handles/transitions.
- Colours from theme tokens only; 4.5:1 text contrast in every theme.

## Notes for the build session
- Big multi-file change: give Luke a short plan and wait for OK before editing (CLAUDE.md).
- Existing scratch checks in `Temp/check-*.cjs` that test the old one-shape-per-joint model will fail.
  Update them on purpose with a reason; never delete to go green. Add checks for: adding/pinning shapes,
  pinned shape follows a posed joint, undo/redo steps, v2 storage key.
- Server-rendered checks can't see the workbench (`ssr: false`): use a real browser capture with
  `--use-angle=swiftshader`, at desktop and phone width.
- Commit after each verified step. Finish with the full loop (verify, checks, capture + audit, push, read)
  and a fresh-context subagent review of the diff against this spec.
