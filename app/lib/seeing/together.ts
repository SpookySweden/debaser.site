/**
 * SEEN TOGETHER (SPEC-seeing-machine.md, idea x): which page somebody is showing their room, and how far down it they are. Pure. What comes from
 * the room is a stranger's words: anybody in it could have said them, so a page is only ever opened by the press of whoever is looking, and
 * being followed moves the page that is already in front and nothing else.
 */
import { readAddress } from './address';
import { isOutside } from './history';

export type Placed = { address: string; y: number; whole: number };
/** `who`: somebody has just come, and asks what is being shown. `over`: nothing is, any more. */
export type TogetherMessage = ({ see: 'at' } & Placed) | { see: 'over' } | { see: 'who' };

const isPlace = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 10_000_000;

export function readTogether(value: unknown): TogetherMessage | null {
  if (typeof value !== 'object' || value === null) return null;
  const { see, address, y, whole } = value as Record<string, unknown>;
  if (see === 'over' || see === 'who') return { see };
  if (see !== 'at' || typeof address !== 'string' || !isPlace(y) || !isPlace(whole)) return null;
  const read = readAddress(address);
  return read.ok && isOutside(read.address) ? { see, address: read.address.split('#')[0], y: Math.min(y, whole), whole: Math.max(1, whole) } : null;
}

/** The same page, whatever part of it is in front. */
export const samePage = (one: string | null, other: string | null): boolean => one !== null && other !== null && one.split('#')[0] === other.split('#')[0];
