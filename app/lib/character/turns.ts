/**
 * Rotations as plain numbers.
 *
 * **Quaternions, held as `{x, y, z, w}` triples-plus-one, for the same reason `skeleton.ts` holds `{x, y, z}`.** The
 * store must never hold a `THREE.Quaternion`: it is a mutable object, and a drag that mutates a value React has
 * already compared leaves the canvas showing the old pose. These are values - they copy, they compare, they
 * serialise - and the whole file runs in plain Node, which is what lets a check drive "a pinned shape turns with its
 * bone" without a GPU.
 *
 * Euler angles are what a reader types into the properties panel and what is saved, because three numbers in degrees
 * are something a person can read. Quaternions are what the arithmetic composes, because composing Euler angles is
 * the classic way to be subtly wrong. The order is XYZ, which is Three's default, so a saved rotation means the same
 * thing to the renderer as it does here.
 */
import type { Vec3 } from './skeleton';

export type Quat = { x: number; y: number; z: number; w: number };

export const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

export function quatMultiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/** The opposite turn. Unit quaternions only, which is all this file ever makes. */
export function quatInvert(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

function normalise(q: Quat): Quat {
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  if (length < 1e-12) return { ...IDENTITY };
  return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
}

/** A turn of `angle` radians about `axis` (which need not be unit length). */
export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const length = Math.hypot(axis.x, axis.y, axis.z);
  if (length < 1e-12 || !Number.isFinite(angle)) return { ...IDENTITY };

  const s = Math.sin(angle / 2) / length;

  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(angle / 2) };
}

export function rotateVec(q: Quat, v: Vec3): Vec3 {
  // q * v * q^-1, expanded.
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;

  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

/**
 * The smallest turn that carries direction `from` onto direction `to` - a "swing", with no twist about the bone.
 *
 * This is how a bone's frame is found from its joints: the rest pose says which way the bone pointed, the current
 * pose says which way it points now, and the swing between them is the bone's rotation. Twist is not recoverable
 * from two points, and in two flat views it is not visible either.
 */
export function quatSwing(from: Vec3, to: Vec3): Quat {
  const a = Math.hypot(from.x, from.y, from.z);
  const b = Math.hypot(to.x, to.y, to.z);
  if (a < 1e-9 || b < 1e-9) return { ...IDENTITY };

  const f = { x: from.x / a, y: from.y / a, z: from.z / a };
  const t = { x: to.x / b, y: to.y / b, z: to.z / b };
  const dot = f.x * t.x + f.y * t.y + f.z * t.z;

  if (dot < -0.999999) {
    // Opposite directions: any axis at right angles to `from` will do.
    const axis = Math.abs(f.x) < 0.9 ? { x: 0, y: -f.z, z: f.y } : { x: -f.z, y: 0, z: f.x };
    return quatFromAxisAngle(axis, Math.PI);
  }

  return normalise({
    x: f.y * t.z - f.z * t.y,
    y: f.z * t.x - f.x * t.z,
    z: f.x * t.y - f.y * t.x,
    w: 1 + dot,
  });
}

/** Euler angles in radians, XYZ order (Three's default), to a quaternion. */
export function quatFromEuler(e: Vec3): Quat {
  const c1 = Math.cos(e.x / 2);
  const c2 = Math.cos(e.y / 2);
  const c3 = Math.cos(e.z / 2);
  const s1 = Math.sin(e.x / 2);
  const s2 = Math.sin(e.y / 2);
  const s3 = Math.sin(e.z / 2);

  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  };
}

/** A quaternion back to XYZ Euler angles in radians - the inverse of `quatFromEuler`, as Three computes it. */
export function eulerFromQuat(input: Quat): Vec3 {
  const q = normalise(input);
  const m11 = 1 - 2 * (q.y * q.y + q.z * q.z);
  const m12 = 2 * (q.x * q.y - q.z * q.w);
  const m13 = 2 * (q.x * q.z + q.y * q.w);
  const m22 = 1 - 2 * (q.x * q.x + q.z * q.z);
  const m23 = 2 * (q.y * q.z - q.x * q.w);
  const m32 = 2 * (q.y * q.z + q.x * q.w);
  const m33 = 1 - 2 * (q.x * q.x + q.y * q.y);

  const y = Math.asin(Math.min(1, Math.max(-1, m13)));

  if (Math.abs(m13) < 0.9999999) {
    return { x: Math.atan2(-m23, m33), y, z: Math.atan2(-m12, m11) };
  }

  return { x: Math.atan2(m32, m22), y, z: 0 };
}
