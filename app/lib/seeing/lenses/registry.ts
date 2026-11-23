import type { Lens } from './lens';
import { DEFAULT_LENS, type LensId } from './names';
import { reader } from './reader';
import { standard } from './standard';
import { watchers } from './watchers';

/** The lenses that are built. A name in `./names.ts` with no lens here has a quiet key. */
const LENSES: readonly Lens[] = [standard, reader, watchers];

export function lensById(id: LensId): Lens | null {
  return LENSES.find((lens) => lens.id === id) ?? null;
}

/** What a page is drawn with when its lens isn't built: STANDARD. */
export function lensOr(id: LensId): Lens {
  return lensById(id) ?? lensById(DEFAULT_LENS) ?? standard;
}
