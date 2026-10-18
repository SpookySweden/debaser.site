# Character workbench: simple figures

Read this before touching how shapes connect, sag or get placed (`app/lib/character/touch.ts`, `structure.ts`,
`sag.ts`, the placing flow in `store.ts`). The spec it was built from is `SPEC-simple-figures.md`.

## The rules
- A figure is at most 7 shapes (`MAX_SHAPES`) on at most 7 nodes (`MAX_NODES`). Every preset is 5 shapes, valid, with no sag.
- **Touching** = the gap between two outlines is at most `TOUCH_GAP` (0.03 units). The gap is measured on each primitive's
  real outline (GJK distance on exact support functions), so a sphere off a box's corner is not touching. A node touches
  a shape the same way.
- **Levels**: a shape touching a node is level 0; touching a level-0 shape, level 1; and so on, by the shortest path.
- **Broken** (blocks saving): a node with no shape round it, a shape touching nothing, a shape cut off from every node,
  and a shape pinned to no node. Hidden shapes are left out of everything.
- **Sag** starts at level 2, doubles per level, adds 25% per sibling sagger, scales with the shape's front-view pixel
  count and with how sideways it sticks out from where it touches. A sagger drags its support a little; anything hanging
  off a tipped shape tips with it. All the numbers are `SAG` in `sag.ts`.
- **SAG %** is the most-turned shape's whole drawn turn (its own tip and everything it is carried by) as a share of a
  quarter turn (100% = something that stuck straight out now hangs straight down). Each tip is capped at hanging as
  the shape points *after* being carried, so a chain of tips never swings a shape back under the figure. Not "share of
  its own way to hanging": a shape built almost hanging would then read 20% for a one-degree droop, and swinging an arm
  out would make the number drop while the droop you can see grows.
- Levels, validity and sag are **worked out from the figure** (memoised per figure object), never stored, so undo, redo
  and loading bring them back for free. Sag is applied when drawing only.

## Placing (ADD and +NODE)
- Pick a shape (or +NODE), click a node, drag from anywhere in either view, then ✓ or ✗. ESC is ✗ - unless the ADD
  menu or the light pad is open (ESC shuts that first), or the key was pressed in another window such as the shelf.
  A press in a view leaves focus on the customiser window, which is *around* the workbench, so that ESC still counts.
- The figure from before is `placing.base`; drags while placing file nothing; ✓ files `base` once (one undo step); ✗
  puts `base` back as the same object.
- While placing, an invisible sheet in front of everything takes every press (`PlacingSheet`), and the side panels are
  `inert`. Any other tool, NEW, throwing changes away, or leaving the workbench abandons the placement.
- ✓ is refused while a new shape touches nothing valid. A new node can always be kept; it is marked until a shape is
  put round it.

## Gotchas
- **Adding or removing a node can turn its parent's frame** (a node's bone points at its *first* child). On a posed
  figure that would swing every shape pinned there. `addNode` / `removeNode` re-express every shape in the new frames
  (`keepShapesInPlace`) so nothing moves. `check-character-simple` proves it with a deliberate break.
- **The overlays are tone-mapped.** The skeleton, outlines and marks are drawn with three's own materials, which R3F
  tone-maps, so on screen they are a little off their palette values (rose #E6004C draws as 236,0,75). The pixel figure
  itself is exact. `Temp/char-drive.cjs` matches the on-screen values, and matches rose tightly because the ✗ button over
  the view is the exact palette rose.
- **The PIXELS stat** is read back from the FRONT view's tiny colour target every 200 ms (`countFigurePixels`). With
  PIXELATE off it draws one extra tiny colour pass for the count. A shape's sag *weight* is estimated from its outline
  instead (`outlinePixels`), because counting each shape separately would need a pass per shape.

## How it is checked
- `Temp/check-character-simple.cjs`: touching, validity, the save messages, sag levels and siblings, hanging vs
  sideways, the caps, the presets, the placing flows, node add/delete. `node Temp/prove-simple-breaks.cjs` applies 18
  deliberate breaks to the source and confirms each is caught.
- `Temp/char-drive.cjs [url] [--mobile]`: the flows in Chrome, PIXELS against a real front render, the folded list,
  the SKELETON switch, and (on a phone) every workbench control at least 44px tall.
