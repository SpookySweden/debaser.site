/**
 * The seven primitives as Three geometry, each normalised to fill exactly a 1 x 1 x 1 box centred on the origin.
 *
 * **Normalised, so a shape's `size` is exactly its width, height and depth, whatever the primitive.** A sphere's
 * natural size is a radius and a capsule's is a radius plus a length; scaling each of them to a unit box first is
 * what lets one SIZE gesture, one set of number boxes and one transform box work the same way for all seven.
 *
 * Kept out of the scene component so a check can build every one in plain Node and measure it, rather than reading
 * the source for the names of geometry classes. Low-poly on purpose: the figure is pixelated in the end.
 */
import * as THREE from 'three';
import type { MassShapeId } from './shapes';

const GEOMETRY_CACHE = new Map<MassShapeId, THREE.BufferGeometry>();

/** One geometry per primitive, built on first use and shared by every shape of that kind. */
export function unitGeometry(kind: MassShapeId): THREE.BufferGeometry {
  const cached = GEOMETRY_CACHE.get(kind);
  if (cached !== undefined) return cached;

  let geometry: THREE.BufferGeometry;
  switch (kind) {
    case 'box':
      geometry = new THREE.BoxGeometry(1, 1, 1);
      break;
    case 'sphere':
      geometry = new THREE.SphereGeometry(0.5, 14, 10);
      break;
    case 'cone':
      // Point down: a cone on a forearm or a shin tapers towards the hand or the foot.
      geometry = new THREE.ConeGeometry(0.5, 1, 12).rotateX(Math.PI);
      break;
    case 'cylinder':
      geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
      break;
    case 'capsule':
      geometry = new THREE.CapsuleGeometry(0.25, 0.5, 4, 12);
      break;
    case 'wedge':
      geometry = new THREE.CylinderGeometry(0.33, 0.5, 1, 4);
      break;
    case 'prism':
      // A triangle seen from the front, apex up, running forward (along depth).
      geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 3, 1).rotateX(-Math.PI / 2);
      break;
  }

  geometry.computeBoundingBox();
  const box = geometry.boundingBox as THREE.Box3;
  const centre = box.getCenter(new THREE.Vector3());
  const extent = box.getSize(new THREE.Vector3());
  geometry.translate(-centre.x, -centre.y, -centre.z);
  geometry.scale(1 / extent.x, 1 / extent.y, 1 / extent.z);
  geometry.computeVertexNormals();

  GEOMETRY_CACHE.set(kind, geometry);
  return geometry;
}

