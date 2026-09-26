/**
 * The default figure: a humanoid blob, and the table that says what mass hangs off each joint.
 *
 * **The mapping the brief asks for, in one place.** Head is a box, the torso is a sphere, and every limb is a
 * cone. That is a deliberately crude vocabulary - three primitives, a dozen joints - and it is the right one
 * for a *pixel* figure, because at the resolution this renders at (about 96x128) a bevelled capsule and a
 * cone are the same four pixels. Detail spent on geometry the pixel pass will discard is detail nobody sees.
 *
 * **`PART_OF_JOINT` is a table, not a field on the joint.** Two reasons, both about drift. First, the mass is
 * a property of the *rig*, not of the state a reader edits: a joint's position and scale are theirs, but
 * "this is a cone" is the figure's anatomy. Second, Phase 4's renderer and Phase 3's picking both read it, and
 * a table is one source they cannot disagree about - the same shape `app/lib/games/catalogue.ts` uses for its
 * game list.
 *
 * **A joint with no entry is a joint with no mass, and that is a first-class case.** `spine` and the two
 * shoulders carry nothing; they exist so that rotating the chest swings the arms, and so a limb has somewhere
 * to hinge from. Hiding a layer does not hide these: it hides the wireframe of a joint that is still there
 * and still draggable.
 *
 * The dimensions are in the same units as positions - roughly a head-height figure, with the root at the
 * hips so rotations read as leaning rather than sliding. **They are not measurements of a person.** A blob
 * humanoid has a head a third of its body, which is not anatomy and is not trying to be.
 */
import {
  ORIGIN,
  UNIT,
  addJoint,
  cloneVec3,
  vec3,
  type Joint,
  type Mass,
  type Skeleton,
  type Vec3,
} from './skeleton';

/** The mass a preset seeds onto a joint. Once built, the mass lives on the joint - see `skeleton.ts`'s `Mass`. */
type MassPart = Mass;

/**
 * What each joint carries. A joint absent from this table is a joint with no geometry - see the header.
 *
 * The head and the chest are *both* at the top of the spine rather than the torso hanging off a shoulder:
 * a blob's torso is its whole trunk, and giving it a chest, an abdomen and a pelvis would be three joints
 * producing one sphere.
 */
export const PART_OF_JOINT: Record<string, MassPart> = {
  head: { shape: 'box', size: vec3(0.30, 0.30, 0.30), offset: vec3(0, 0.16, 0) },
  chest: { shape: 'sphere', size: vec3(0.34, 0.42, 0.26), offset: vec3(0, -0.18, 0) },
  hips: { shape: 'sphere', size: vec3(0.32, 0.26, 0.24), offset: vec3(0, -0.06, 0) },

  'upper-arm.left': { shape: 'cylinder', size: vec3(0.11, 0.30, 0.11), offset: vec3(0, -0.26, 0) },
  'upper-arm.right': { shape: 'cylinder', size: vec3(0.11, 0.30, 0.11), offset: vec3(0, -0.26, 0) },
  'forearm.left': { shape: 'capsule', size: vec3(0.09, 0.26, 0.09), offset: vec3(0, -0.22, 0) },
  'forearm.right': { shape: 'capsule', size: vec3(0.09, 0.26, 0.09), offset: vec3(0, -0.22, 0) },
  'hand.left': { shape: 'box', size: vec3(0.10, 0.10, 0.10), offset: vec3(0, -0.06, 0) },
  'hand.right': { shape: 'box', size: vec3(0.10, 0.10, 0.10), offset: vec3(0, -0.06, 0) },

  'thigh.left': { shape: 'capsule', size: vec3(0.14, 0.34, 0.14), offset: vec3(0, -0.30, 0) },
  'thigh.right': { shape: 'capsule', size: vec3(0.14, 0.34, 0.14), offset: vec3(0, -0.30, 0) },
  'shin.left': { shape: 'capsule', size: vec3(0.11, 0.30, 0.11), offset: vec3(0, -0.26, 0) },
  'shin.right': { shape: 'capsule', size: vec3(0.11, 0.30, 0.11), offset: vec3(0, -0.26, 0) },
  'foot.left': { shape: 'wedge', size: vec3(0.12, 0.05, 0.18), offset: vec3(0, 0, 0.06) },
  'foot.right': { shape: 'wedge', size: vec3(0.12, 0.05, 0.18), offset: vec3(0, 0, 0.06) },
};

/**
 * The joints that hold the figure together and carry nothing *by default*.
 *
 * Listed rather than inferred, because "the table has no entry for this joint" is the *same* state as "this joint
 * was meant to have one and does not". Naming the structural joints makes "silently forgot the arm" a failing
 * check instead of a figure that renders with a hole in it.
 *
 * **These are a default, not a prohibition.** Since mass moved onto the joint, a reader can add a sphere to a
 * shoulder with one press - which is the first thing anybody will want to do to one - so this list says what a
 * preset *starts* as, and never what a figure is allowed to be.
 */
export const STRUCTURAL_JOINTS: readonly string[] = ['spine', 'neck', 'shoulder.left', 'shoulder.right'];

/**
 * Which mass a joint carries, if any - **read from the joint, not from the table.**
 *
 * This used to be `PART_OF_JOINT[jointId]`, and that single line was the whole reason "move the mass and the
 * vertex follows" could not work: it returned a shared object from a frozen table, so there was nothing per-joint
 * to edit and no way for an edit to mean anything. Taking the joint instead makes the lookup a read of authored
 * data, and `PART_OF_JOINT` becomes purely the seed `buildDefaultRig` copies from.
 *
 * `null` and "unknown joint" are deliberately different answers: a joint that carries nothing is a normal state a
 * reader can change, and an unknown id is a caller's mistake. Only the first is `null`.
 */
export function massFor(skeleton: Skeleton, jointId: string): Mass | null {
  return skeleton.joints[jointId]?.mass ?? null;
}

/** Whether a joint carries a primitive. The palette's "is there anything to reshape here". */
export function hasMass(skeleton: Skeleton, jointId: string): boolean {
  return (skeleton.joints[jointId]?.mass ?? null) !== null;
}

/** A joint and where it hangs. The rig's own shape, before it becomes a `Skeleton`. */
type RigJoint = {
  id: string;
  /**
   * The joint this hangs off, or `null` for the root.
   *
   * **Typed as a union rather than as a plain `string` with the root kept out of the list**, because the root
   * genuinely has no parent and saying so in the table is what lets `buildDefaultRig` place it. The `continue`
   * in that function narrows the `null` away before `addJoint` is called; without the narrowing, `addJoint`'s
   * non-null parameter is a type error - which is the compiler correctly pointing out that a joint with no
   * parent cannot be added under one.
   */
  parentId: string | null;
  position: Vec3;
};

/**
 * The figure, joint by joint.
 *
 * **The root is the hips and everything is measured in halves from it.** A rig rooted at the feet would
 * measure every joint upward and put the origin on the floor, which is right for a game's world position and
 * wrong for a character editor: the model would sit in the lower half of the frame and a lean would pivot on
 * the ground rather than on the pelvis. Rooting at the hips puts the figure around the origin, so the two
 * orthographic cameras are a fixed distance away and the geometry is roughly centred in both.
 *
 * **The two sides are written out rather than mirrored in a loop.** A mirror is a `for` over `['left',
 * 'right']` with the x component negated - shorter, and the thing to do for a game with twelve identical
 * limbs - but this is a character editor whose whole purpose is that the sides *become* different, and a
 * generated side is one nobody can edit without first understanding the generator. Six extra lines buys a
 * table anybody can read.
 */
const RIG: readonly RigJoint[] = [
  { id: 'hips', parentId: null, position: vec3(0, 0, 0) },

  { id: 'spine', parentId: 'hips', position: vec3(0, 0.10, 0) },
  { id: 'chest', parentId: 'spine', position: vec3(0, 0.16, 0) },
  { id: 'neck', parentId: 'chest', position: vec3(0, 0.20, 0) },
  { id: 'head', parentId: 'neck', position: vec3(0, 0.10, 0) },

  { id: 'shoulder.left', parentId: 'chest', position: vec3(-0.30, 0.10, 0) },
  { id: 'upper-arm.left', parentId: 'shoulder.left', position: vec3(0, 0, 0) },
  { id: 'forearm.left', parentId: 'upper-arm.left', position: vec3(0, -0.52, 0) },
  { id: 'hand.left', parentId: 'forearm.left', position: vec3(0, -0.48, 0) },

  { id: 'shoulder.right', parentId: 'chest', position: vec3(0.30, 0.10, 0) },
  { id: 'upper-arm.right', parentId: 'shoulder.right', position: vec3(0, 0, 0) },
  { id: 'forearm.right', parentId: 'upper-arm.right', position: vec3(0, -0.52, 0) },
  { id: 'hand.right', parentId: 'forearm.right', position: vec3(0, -0.48, 0) },

  { id: 'thigh.left', parentId: 'hips', position: vec3(-0.13, -0.10, 0) },
  { id: 'shin.left', parentId: 'thigh.left', position: vec3(0, -0.58, 0) },
  { id: 'foot.left', parentId: 'shin.left', position: vec3(0, -0.54, 0) },

  { id: 'thigh.right', parentId: 'hips', position: vec3(0.13, -0.10, 0) },
  { id: 'shin.right', parentId: 'thigh.right', position: vec3(0, -0.58, 0) },
  { id: 'foot.right', parentId: 'shin.right', position: vec3(0, -0.54, 0) },
];

export const ROOT_JOINT_ID = 'hips';

/**
 * The skeletons a reader may start from.
 *
 * **Three, and each one is a *proportion*, not a different rig.** They share the joint table above and differ only
 * in the bone lengths, because the thing that makes a figure read as lanky or stocky is the ratio of its parts -
 * not which parts it has. A second joint table per preset would be three near-identical tables to keep in step,
 * and the first edit to one of them would silently diverge from the others.
 *
 * `legLength` and `armLength` are **multipliers applied to the limb bones**, and `girth` scales every mass on the
 * figure. Three dials, three recognisably different default people:
 *
 *   BLOB    the short, round one - the figure this editor shipped with
 *   LANKY   long limbs, thin, small mass
 *   STOCKY  short limbs, heavy
 *
 * **The root stays where it is in every preset.** Moving it would move the figure relative to the camera's centre,
 * which is `FIGURE_CENTRE_Y`, and a preset that quietly changed the framing would look like a camera bug.
 */
export type RigPresetId = 'blob' | 'lanky' | 'stocky';

export const RIG_PRESET_IDS: readonly RigPresetId[] = ['blob', 'lanky', 'stocky'];

export type RigPreset = {
  label: string;
  /** One line, so the choice is made on the figure rather than on the name. */
  note: string;
  /** Multiplies the shoulder-to-elbow, elbow-to-wrist, hip-to-knee and knee-to-ankle bones. */
  limb: number;
  /** Multiplies every mass's size. The single dial that turns a figure fat or thin. */
  girth: number;
};

export const RIG_PRESETS: Record<RigPresetId, RigPreset> = {
  blob: { label: 'BLOB', note: 'SHORT AND ROUND - THE BALANCED ONE', limb: 1, girth: 1 },
  lanky: { label: 'LANKY', note: 'LONG LIMBS, THIN - A STRINGY FIGURE', limb: 1.3, girth: 0.78 },
  stocky: { label: 'STOCKY', note: 'SHORT LIMBS, HEAVY - A SOLID FIGURE', limb: 0.78, girth: 1.32 },
};

/**
 * Does this joint's bone length respond to the preset's `limb` multiplier?
 *
 * **A predicate rather than a column on the joint table**, because the table's job is to say where a joint is, and
 * "this bone scales with the limbs" is not the same kind of fact - it is about the *preset*, not the figure. The
 * ids come from the rig's own vocabulary, so a renamed joint is a bone that stops scaling visibly rather than one
 * that scales wrongly.
 */
function isLimbBone(id: string): boolean {
  return /^(upper-arm|forearm|thigh|shin)\./.test(id);
}

/**
 * The figure the editor opens on, built from one of the three presets.
 *
 * Built by folding `addJoint` over the table rather than by writing the record out, because `addJoint` refuses a
 * parent that does not exist - so a typo in a `parentId` here produces a joint that is simply missing and that
 * `validateRig` reports, rather than a rig that breaks the moment it is drawn.
 *
 * **The mass is seeded onto each joint from `PART_OF_JOINT`, and that is the one-way door in this function.**
 * After it returns, a joint's mass is that joint's own data; the table is a *default source* and never consulted
 * again. So editing a hand's shape cannot alter the table, switching preset rebuilds from the table and therefore
 * discards edits - which is what "start over from a preset" means - and there is exactly one place mass can be
 * read from at any moment.
 *
 * The root cannot go through `addJoint` (which requires a parent that exists), so it is placed directly. That is
 * the one asymmetry in this function and the comment is here so it does not read as an oversight.
 */
export function buildDefaultRig(presetId: RigPresetId = 'blob'): Skeleton {
  const preset = RIG_PRESETS[presetId];

  const seedFor = (id: string): Mass | null => {
    const part = PART_OF_JOINT[id];
    if (part === undefined) return null;

    // `girth` is applied here rather than at render time so that the figure the reader then edits is the figure
    // they chose - a preset that only *looked* heavier would come apart on the first drag.
    return {
      shape: part.shape,
      size: vec3(part.size.x * preset.girth, part.size.y * preset.girth, part.size.z * preset.girth),
      offset: cloneVec3(part.offset),
    };
  };

  const root: Joint = {
    id: ROOT_JOINT_ID,
    parentId: null,
    position: cloneVec3(ORIGIN),
    rotation: cloneVec3(ORIGIN),
    scale: cloneVec3(UNIT),
    mass: seedFor(ROOT_JOINT_ID),
  };

  let skeleton: Skeleton = { joints: { [root.id]: root }, rootId: ROOT_JOINT_ID };

  for (const joint of RIG) {
    // The root is already placed, and it is the only entry with no parent - so anything with a parent here is
    // a real child. Reading it into a local is what narrows `string | null` to `string` for `addJoint`, rather
    // than casting, which would defeat the point of the union.
    const parentId = joint.parentId;
    if (parentId === null) continue;

    const scaled = isLimbBone(joint.id)
      ? vec3(joint.position.x, joint.position.y * preset.limb, joint.position.z)
      : joint.position;

    skeleton = addJoint(skeleton, { id: joint.id, parentId, position: scaled });
    skeleton = { ...skeleton, joints: { ...skeleton.joints, [joint.id]: { ...skeleton.joints[joint.id], mass: seedFor(joint.id) } } };
  }

  return skeleton;
}

/** Every joint of the default rig, in the order the table declares them. */
export const DEFAULT_JOINT_IDS: readonly string[] = RIG.map((joint) => joint.id);
