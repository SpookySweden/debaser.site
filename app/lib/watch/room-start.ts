/**
 * Where a room's first video starts (SPEC-floating-player.md, part 3): `[ WATCH IN ROOM ]` carries on from where the viewer had
 * got to, when the player can tell. The room's player is a new one, so the host's room reads this once, as that entry comes on
 * screen, and everybody else follows the host as usual. Memory only.
 */

const starts = new Map<string, number>();

/** Starts this queue row from `seconds`; under a second is the top. */
export function noteRoomStart(entryId: string, seconds: number | null): void {
  if (seconds !== null && Number.isFinite(seconds) && seconds >= 1) starts.set(entryId, seconds);
}

/** Where this row starts, once: asked again it is null, so the host can seek back to the top like any other. */
export function takeRoomStart(entryId: string): number | null {
  const seconds = starts.get(entryId);
  if (seconds === undefined) return null;
  starts.delete(entryId);
  return seconds;
}
