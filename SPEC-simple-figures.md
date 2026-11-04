# SPEC: Simple figures (5-shape characters, node-anchored placement, sag)

Interviewed 2026-10-18. Build this in a fresh session. Read CLAUDE.md, `docs/design.md` and
`docs/character-render.md` first. This builds on the workbench from SPEC.md / SPEC-pixel-render.md (both done).

## Goal
Characters become much simpler: 5 shapes by default, 7 at most, on a small skeleton. Every shape and every node
is placed in relation to an existing node, confirmed with a tick or cancelled with a cross. Shapes that stick out
from their support visibly sag, and the workbench shows two live stats: pixel count and sag %.

## Small UI changes
1. **The skeleton show/hide button moves into the LAYERS tab** (beside PIXELATE / NORMAL LIGHT / NORMAL MAP).
2. **The shape list can be clicked to select.** Clicking a row selects that shape in both views, the same as
   clicking it in a view.
3. **The shape list starts collapsed** and has a header to expand it. The header shows the count, e.g.
   `SHAPES 5/7`. Expanding must not move what the pointer is on (CLAUDE.md "reveals" rule).
4. **Stats under the views:** `PIXELS 312 · SAG 14%`, updated live.
   - PIXELS = the number of filled blocks in the FRONT view's pixel render. Count it from the render target the
     view already draws, rather than estimating it.
   - SAG = see "Sag" below.

## Figures and presets
- **The 7 goofy presets go** (blob, noodle, bobblehead, brick, gremlin, snowman, pear).
- **NEW FIGURE offers:** BASE, GOBLIN, ROBOT (small, Wall-E-like: boxy body, tracks, binocular head), GUY (a
  rough little person).
- **Every preset is exactly 5 shapes on its own simple skeleton**, valid as shipped (every shape anchored,
  every node covered) and with 0% sag at rest.
- **Shapes:** 5 by default, **7 max** (`MAX_SHAPES` 80 -> 7). ADD is disabled at 7, with a tooltip saying why.
- **Skeleton nodes:** base skeleton = **3 nodes** (hips, body, head). **7 max.**
- **Old shelves start fresh:** bump the library storage key (`library.ts`) to the next version, so old figures
  are ignored rather than misread. They live only in each person's own browser; nothing on the server changes.
  Tell testers before it ships.
- No database work in this task.

## Adding a shape (the placement flow)
1. Press ADD, then pick a shape type. **Keep the pop-out shape menu that is already in
   `CharacterViewport.tsx`** (`AddToolButton`, live since 5123ee1) and build on it: it is the type picker for this flow.
2. **Pick a node:** the skeleton shows, nodes highlight on hover, and you click one. Nothing else in the views
   can be grabbed during placement.
3. **Place:** the new shape appears at the node, and you drag it in either view. **It can go anywhere.**
   The green tick checks the placement.
4. **Confirm with a green ✓ or cancel with a red ✗** (text characters, not drawn icons), shown near the shape.
   - The ✓ is greyed out, with a reason in its tooltip, while the shape touches nothing valid (see Validity).
   - ✗ removes the shape and leaves the figure exactly as before.
   - ESC = ✗.
   - The whole placement is one undo step.
5. The shape is **pinned to the chosen node**, so posing carries it along.
6. Once a shape is placed, the existing MOVE / TURN / SIZE tools still work on it. Every finished change
   re-checks validity and sag.

## Adding a node
The same flow: ADD NODE -> pick an existing node (the new node's parent) -> drag the new node anywhere ->
✓ / ✗. It is one undo step. ADD NODE is disabled at 7 nodes.

## Validity (blocks saving)
- A **node is invalid** until a shape surrounds or touches it.
- A **shape is invalid** unless it touches a node, or touches a shape that touches a node.
- Invalid things are marked in the views and in the shape list.
- **Saving is refused while anything is invalid**, with a message naming what's wrong, e.g.
  "Can't save: node ARM has no shape around it" or "Can't save: CONE 2 isn't touching anything".
- **Touching** = the shapes' outlines overlap or sit within a small gap. Work it out from each primitive's real
  outline as far as practical, not just its bounding box, so a sphere beside a box isn't "touching" across the
  box's empty corner. It's fine to approximate tilted cones and wedges. Keep the gap in one named constant.

## Sag
**Levels.** A shape touching a node is level 0. A shape touching a level-0 shape is level 1. Each further hop
adds a level, measured by the shortest path.
- Levels 0 and 1: no sag.
- **Level 2 (the first "sagger") sags** after it's placed, and also drags down the level-1 shape it hangs from
  a little.
- **Each extra level down the chain doubles the effect** (level 3 = 2×, level 4 = 4×...).
- **Another sagger at the same level on the same support adds 25% more sag** (the total becomes 125%, then 150%...).

**Weight.** Each shape's sag potential scales with its **pixel count**, i.e. its size in the front render.
- **Fat vs long:** a shape sticking out sideways from where it touches sags the most. A shape hanging straight
  down (like a leg) barely sags. Use how sideways the line from the contact point to the shape's centre runs.

**Look.** Sagging shapes **visibly tip downwards** around the point where they touch their support.
- The tilt is applied when drawing only, and is never saved into the shape's own numbers.
- The figure must still save and load exactly as built.
- It **updates live while posing**: swing an arm out sideways and it sags more.

**SAG %** = how far the most-tipped shape has turned from where it was built, where 100% = tipped all the way
to hanging straight down. Clamp at 100%.

Put every sag number (the base amount, ×2 per level, +25% per sibling, the weight scale) together in one named
place, because Luke will tune them by eye.

## Edge cases
- **Deleting a shape** that others hang from makes those others invalid (they're marked), not deleted.
- **Deleting a node** deletes its child nodes too; shapes pinned to them are unpinned and marked invalid. Ask
  before doing it if any shapes are affected.
- **Hidden shapes:** they don't count for touching, pixels or sag. The list says so in the row's tooltip.
- **Undo/redo** restores validity and sag along with the figure (both are worked out from the figure, never
  stored separately).
- **The unsaved-work prompt** still asks before the customiser closes, including mid-placement.
- **Phone width:** ✓ / ✗ and node picking must be thumb-sized (the audit's tap-target rule).

## Out of scope
- Real physics or animation of the sag (it's a one-off pose tilt, not a wobble).
- More than 7 shapes or nodes; mirror/symmetry.
- Converting old saves.
- Any artwork. Icons are text characters (✓ ✗ ☀ etc.), or a `SpriteSlot` placeholder.

## Proof of done
- `npm run verify` and `npm run checks` pass.
- New checks, each proven by a deliberate break:
  - sag levels: ×2 per level, +25% per sibling, a long leg hanging down sags less than a fat shape sticking out
    sideways
  - validity
  - save refusal and its messages
  - the 7-shape / 7-node caps
  - the presets: valid, 5 shapes, 0% sag
  - the pixel count matches a real front render
- Browser drive (`Temp/char-drive.cjs`, extended):
  - the add-shape and add-node flows, ✓ / ✗ / ESC
  - selecting a shape from the list
  - collapse and expand
  - the skeleton toggle in LAYERS
- `npm run capture` + `npm run audit`.
- Screenshots at desktop and phone width, on the deployed site, after pushing.
