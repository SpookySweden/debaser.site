/**
 * Which PLAY your room's keeper (`MusicRoomKeeper.tsx`) has dealt with, so each is handed to your room once
 * (Luke, list 4, 2026-11-16: "when pressing play on a video on my "good morning" account it seems to still open a gap
 * and extra options under the video itself, seen in grid view").
 *
 * Your room takes a moment to read on the live site (343cbd1 found the same for GO LIVE). A PLAY in that moment used to
 * stay in its card for good: the keeper was not listening yet, and when it started it skipped the video already on. Now
 * it asks here, on every start and once more the moment it starts listening, and hands over whatever it has not handled.
 * Kept for the visit, outside React, so a room arriving again (a blank room made real, END ROOM's new room) never moves
 * a video twice, and CANCEL on the ask keeps a video where it is.
 */

let handled = 0;

/** The entry if its PLAY has not been dealt with yet (and marks it dealt with), else null. */
export function takeUnhandledPlay<T extends { play: number }>(entry: T | null): T | null {
  if (entry === null || entry.play <= handled) return null;
  handled = entry.play;
  return entry;
}
