import type { OwnDeviceMessage, OwnDeviceWay } from './repository';
import type { DeviceMode } from './own-device-modes';

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
/** A following device asks where the leading one is this often, while something plays (two messages each time). */
export const OWN_PLACE_ASK_MS = 2000;
/** A place heard longer ago than this is not followed: the room's record is used instead. */
export const OWN_PLACE_KEEPS_MS = 5000;

const clampVolume = (volume: number) => Math.min(1, Math.max(0, volume));
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** What came down the line, or null for anything that is not a well-formed message of ours. */
export function readOwnDeviceMessage(data: unknown): OwnDeviceMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const said = data as Record<string, unknown>;
  if (typeof said.roomId !== 'string') return null;
  const roomId = said.roomId;
  // A device of yours from before [ DEVICES ] says nothing of who it is: its sound is taken as from a device with no way chosen.
  const from = typeof said.from === 'string' && said.from.length <= ID_MAX ? said.from : undefined;
  const sender = from === undefined ? {} : { from };
  if (said.kind === 'volume' && isNumber(said.volume) && typeof said.muted === 'boolean') return { kind: 'volume', roomId, volume: clampVolume(said.volume), muted: said.muted, ...sender };
  if (said.kind === 'bar' && isNumber(said.volume)) return { kind: 'bar', roomId, volume: clampVolume(said.volume), ...sender };
  if ((said.kind === 'ask-room' || said.kind === 'ask-bar') && isNumber(said.since)) return { kind: said.kind, roomId, since: said.since, ...sender };
  if (from === undefined) return null;
  if (said.kind === 'hello' && typeof said.key === 'string' && typeof said.name === 'string' && typeof said.held === 'boolean' && typeof said.answer === 'boolean') {
    const modes: Record<string, OwnDeviceWay> = {};
    if (typeof said.modes === 'object' && said.modes !== null) {
      for (const [id, way] of Object.entries(said.modes as Record<string, unknown>).slice(0, MODES_MAX)) {
        const read = readWay(way);
        if (read !== null && id.length <= ID_MAX) modes[id] = read;
      }
    }
    return { kind: 'hello', roomId, from, key: said.key.slice(0, 200), name: said.name.slice(0, NAME_MAX), modes, held: said.held, answer: said.answer };
  }
  if (said.kind === 'ask-place' && isNumber(said.asked)) return { kind: 'ask-place', roomId, from, asked: said.asked };
  if (typeof said.to !== 'string') return null;
  const to = said.to;
  if (said.kind === 'place' && isNumber(said.asked) && isNumber(said.seconds) && typeof said.entryId === 'string' && said.entryId.length <= ID_MAX) return { kind: 'place', roomId, from, to, asked: said.asked, entryId: said.entryId, seconds: Math.max(0, said.seconds) };
  if (said.kind === 'pair') {
    const way = readWay(said);
    return way === null ? null : { kind: 'pair', roomId, from, to, ...way };
  }
  if (said.kind === 'mute-device' && typeof said.on === 'boolean') return { kind: 'mute-device', roomId, from, to, on: said.on };
  return null;
}

const ID_MAX = 64;
const NAME_MAX = 24;
const MODES_MAX = 24;
const isMode = (value: unknown): value is DeviceMode => value === 'follows-me' || value === 'i-follow' || value === 'apart';

function readWay(data: unknown): OwnDeviceWay | null {
  if (typeof data !== 'object' || data === null) return null;
  const way = data as Record<string, unknown>;
  if (!(way.mode === null || isMode(way.mode)) || !isNumber(way.at)) return null;
  return { mode: way.mode, keeper: typeof way.keeper === 'string' && way.keeper.length <= ID_MAX ? way.keeper : null, at: way.at };
}
