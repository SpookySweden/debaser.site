import type { OwnDeviceMessage } from './repository';

/**
 * Your own devices in a room, kept together (Luke, 2026-11-27: "when two of the same account are watching media in a room, make sure
 * the pause play and volume controls are all synced"). Play, pause and jumps ride the room's own record (device-lead.ts); the
 * sound rides the account's own line (`WatchRepository.joinOwnDevices`), which this reads both ends of: the room's speaker key, the
 * music bar's volume while it plays your room (his answer, "Yes, it follows"), and a device that comes in taking what the ones
 * already there have (his answer, "Take current volume on join").
 */

/** The line's name on Supabase: the account's own, which only that account may hear or send on. */
export function ownDevicesTopic(userId: string): string {
  return `account:${userId}`;
}

/** A device that comes in asks this long after its line opens, then again, until one already there answers (a line takes a moment to join). */
export const OWN_ASK_AFTER_MS = [400, 2000, 5000] as const;
/** A dragged volume tells your other devices at most this often (the last place always arrives). */
export const OWN_VOLUME_SAY_MS = 150;

const clampVolume = (volume: number) => Math.min(1, Math.max(0, volume));
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** What came down the line, or null for anything that is not a well-formed message of ours. */
export function readOwnDeviceMessage(data: unknown): OwnDeviceMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const said = data as Record<string, unknown>;
  if (typeof said.roomId !== 'string') return null;
  const roomId = said.roomId;
  if (said.kind === 'volume' && isNumber(said.volume) && typeof said.muted === 'boolean') return { kind: 'volume', roomId, volume: clampVolume(said.volume), muted: said.muted };
  if (said.kind === 'bar' && isNumber(said.volume)) return { kind: 'bar', roomId, volume: clampVolume(said.volume) };
  if ((said.kind === 'ask-room' || said.kind === 'ask-bar') && isNumber(said.since)) return { kind: said.kind, roomId, since: said.since };
  return null;
}
