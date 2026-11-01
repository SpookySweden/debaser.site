/**
 * The six primitives a joint's mass can be, declared once.
 *
 * **Why six and not the three the rig started with.** A box, a sphere and a cone will build a crude figure and
 * nothing else: there is no way to make a limb that is *evenly* thick (a cone always tapers), no way to round the
 * end of one, and no way to make anything with a flat face and a sloped one. Adding `cylinder`, `capsule` and
 * `wedge` closes exactly those three gaps and no more - a vocabulary that grows past what a reader can hold in
 * their head stops being a palette and becomes a menu.
 *
 * **The list is the palette's data, not a description of it.** `MassPalette` maps over `MASS_SHAPE_IDS`, so a
 * shape added to the union without a label here is a **type error** rather than a control that cannot be reached -
 * the same trick `layers.ts` uses for the render stages, for the same reason.
 *
 * **A note is required, not optional.** Six unlabelled glyphs is a memory test; one line each saying what the
 * shape is *for* is what makes the palette usable without an instruction. They are written in the same second
 * person the rest of the workbench speaks in.
 *
 * This file holds no geometry and no React: which shapes exist, and what they are called, is a fact the rig, the
 * palette, the renderer and the checks all need, and none of them should be the one that declares it.
 */
export type MassShapeId = 'box' | 'sphere' | 'cone' | 'cylinder' | 'capsule' | 'wedge' | 'prism';

export const MASS_SHAPE_IDS: readonly MassShapeId[] = [
  'box',
  'sphere',
  'cone',
  'cylinder',
  'capsule',
  'wedge',
  'prism',
];

export type MassShapeInfo = {
  label: string;
  /** What the shape is for, in one line. Shown under the swatch. */
  note: string;
  /** How many of the three size components it actually uses, so the sidebar can say so. */
  uses: 'xyz' | 'radius+length';
};

export const MASS_SHAPES: Record<MassShapeId, MassShapeInfo> = {
  box: { label: 'BOX', note: 'A FLAT-FACED BLOCK. HEADS, HANDS, FEET.', uses: 'xyz' },
  sphere: { label: 'SPHERE', note: 'ROUND IN EVERY DIRECTION. TORSOS, BELLIES.', uses: 'xyz' },
  cone: { label: 'CONE', note: 'TAPERS TO A POINT. FOREARMS, SHINS.', uses: 'xyz' },
  cylinder: { label: 'CYLINDER', note: 'EVENLY THICK, FLAT ENDS. UPPER ARMS, NECKS.', uses: 'radius+length' },
  capsule: { label: 'CAPSULE', note: 'A CYLINDER WITH ROUNDED ENDS. LIMBS THAT BEND.', uses: 'radius+length' },
  wedge: { label: 'WEDGE', note: 'FLAT ON ONE SIDE, SLOPED ON THE OTHER. SHOULDERS, CHINS.', uses: 'xyz' },
  prism: {
    label: 'PRISM',
    note: 'A TRIANGLE SEEN FROM THE FRONT, RUNNING FORWARD. FEET AND SNOUTS.',
    uses: 'xyz',
  },
};

/** True for an unknown string, so a corrupt persisted value cannot reach the renderer as a shape. */
export function isMassShapeId(value: string): value is MassShapeId {
  return (MASS_SHAPE_IDS as readonly string[]).includes(value);
}
