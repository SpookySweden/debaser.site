/**
 * Where a room's first video starts (SPEC-floating-player.md, part 3): `[ WATCH IN ROOM ]` carries on from where the viewer had
 * got to, when the player can tell. The room's player is a new one, so the host's room asks here as that entry comes on screen,
 * and everybody else follows the host as usual. Memory only.
 *
 * Each player asks once, and the place lasts a short while rather than one asking: a private room can draw its stage twice as
 * it opens (its door, then the room), so the first player made is not always the one that stays.
 */

const STARTING_MS = 30000;

const starts = new Map<string, { seconds: number; until: number }>();
const asked = new WeakSet<object>();

/** Starts this queue row from `seconds`; under a second is the top. */
export function noteRoomStart(entryId: string, seconds: number | null, now = Date.now()): void {
  if (seconds !== null && Number.isFinite(seconds) && seconds >= 1) starts.set(entryId, { seconds, until: now + STARTING_MS });
}

/** Where this player starts this row: null once it has asked, so the host can seek back to the top like any other. */
export function roomStartFor(player: object, entryId: string, now = Date.now()): number | null {
  const start = starts.get(entryId);
  if (start === undefined) return null;
  if (now > start.until) {
    starts.delete(entryId);
    return null;
  }
  if (asked.has(player)) return null;
  asked.add(player);
  return start.seconds;
}
