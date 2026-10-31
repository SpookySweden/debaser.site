/**
 * The song settings panel's two small rules (SPEC-vanity.md), kept pure so a check can hold them.
 */

/**
 * The hand-made queue after ADD TO QUEUE (`'end'`) or PLAY NEXT (`'next'`).
 *
 * A song is in it once: queueing one already there moves it rather than adding a second copy, matched by
 * its file, because the same song met in a post and in the archive is one file.
 */
export function enqueueTrack<T extends { src: string }>(list: readonly T[], track: T, where: 'end' | 'next'): T[] {
  const without = list.filter((entry) => entry.src !== track.src);
  return where === 'next' ? [track, ...without] : [...without, track];
}

/**
 * The archive's own record of a song, or undefined when the archive does not hold that file.
 *
 * `queue` is the player's queue and `shelfSize` how much of its front came from reading the archive;
 * whatever sits after that was added by a press elsewhere (a post's MP3, someone's profile song) and is
 * not an archive song, even when it is playing. Matched by the file's address, the one key the same file
 * keeps everywhere. A song the archive does not hold gets no likes or lists: a list holds archive songs,
 * and one it could not draw would come back as UNAVAILABLE.
 */
export function shelfSong<T extends { src: string }>(queue: readonly T[], shelfSize: number, src: string): T | undefined {
  return queue.slice(0, Math.max(0, shelfSize)).find((entry) => entry.src === src);
}
