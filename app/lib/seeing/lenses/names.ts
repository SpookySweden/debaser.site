/** Every lens BROWSER will have (SPEC-seeing-machine.md), in the order its keys are drawn. A lens with no file in the registry yet has a quiet key. */
export const LENS_NAMES = [
  { id: 'standard', label: 'STANDARD' },
  { id: 'reader', label: 'READER' },
  { id: 'watchers', label: 'WATCHERS' },
  { id: 'xray', label: 'X-RAY' },
  { id: 'lowfi', label: 'LOW-FI' },
  { id: 'dye', label: 'DYE' },
] as const;

export type LensId = (typeof LENS_NAMES)[number]['id'];

export const DEFAULT_LENS: LensId = 'standard';

export function isLensId(value: unknown): value is LensId {
  return LENS_NAMES.some((lens) => lens.id === value);
}
