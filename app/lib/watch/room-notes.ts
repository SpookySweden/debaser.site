/**
 * The room's own lines in its chat (Luke, 2026-11-08: "make the automatic chat messages a bit less frequent"). In each browser only:
 * never sent, never stored, never on the board or in the record, so changing them needs no database change.
 *
 * - UP NEXT: what plays next, every two minutes (once a minute until 2026-11-08), and not at all while it would only repeat the
 *   UP NEXT just above it with nothing said since.
 * - The not-in-step line: once per play, as a player the room can't keep in step comes on (a WEB platform's own player, or a
 *   friend's media server's), in place of the line that used to sit under the picture.
 */

/** How often the chat says what plays next. */
export const UP_NEXT_EVERY_MS = 120_000;

/** One of the room's own lines: UP NEXT, or the once-per-play note on a player the room can't keep in step. */
export type RoomNote = { id: string; at: string; kind: 'next' | 'step'; text: string };

/** Whether an UP NEXT would only repeat the newest line, an UP NEXT with the same title, with nothing said since (`lastSaid`). */
export function upNextRepeats(kept: readonly RoomNote[], title: string, lastSaid: string): boolean {
  const last = kept[kept.length - 1];
  return last !== undefined && last.kind === 'next' && last.text === title && last.at > lastSaid;
}

/** The chat's one line for a play the room can't keep in step: a server's (the host's PLAY restarts it for all), or a platform's. */
export function notInStepNote(server: boolean): string {
  return server
    ? "THE HOST'S PLAY STARTS EVERYONE'S PLAYER FROM THE TOP, TOGETHER. PAUSING AND SKIPPING IN THIS PLAYER ARE EACH PERSON'S OWN."
    : "NOT IN STEP: EVERYONE PRESSES PLAY ON THIS ONE. PAUSING AND SKIPPING IN THIS PLAYER ARE EACH PERSON'S OWN.";
}

/** The note's id: one per play, so a restart or a redraw never says it twice. */
export function notInStepId(entryId: string): string {
  return `not-in-step-${entryId}`;
}
