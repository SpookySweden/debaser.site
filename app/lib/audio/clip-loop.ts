/**
 * A short file behaves like a GIF.
 *
 * A seven-second sound filed with a post has the same shape as a looping animation: it is a
 * *motion*, not a piece of music, and a reader who presses play on it expects it to keep going
 * rather than to stop and hand the player on to whatever is next on the shelf. Twenty seconds is
 * where that stops being true - past it a file is a track, and a track ends.
 *
 * **The rounding is the reader's, not ours.** `measureTrackLength` files a whole number of seconds
 * (`app/lib/audio/attach.ts`), so the rule is asked of that filed running time - a `0:20` clip
 * repeats, a `0:21` one does not. When the file has no filed running time (`--:--`, a profile's own
 * song, a track nobody measured) the answer is `null`: *no opinion*, and the shelf's switch decides
 * as it always did. Guessing from a file we cannot read would be worse than saying nothing.
 *
 * **Which switch this writes, and which it must not.** A file's own repeat is the player's
 * *handed-over* repeat (`ownLoop` in `MusicPlayerProvider.tsx`), never the shelf's switch - that one
 * is persisted, so writing it here would turn looping on for the whole board and leave it on. The
 * same separation a profile's song already keeps.
 *
 * Video is deliberately out of scope: the site draws no `<video>` element anywhere, so there is no
 * second medium for this rule to govern yet. The rule is written against a filed running time
 * rather than against audio, so the day one exists, it applies unchanged.
 */

/**
 * The longest running time that still reads as a loop rather than as a track, in seconds.
 *
 * Twenty, and inclusive: a clip of exactly this length is a GIF, and one second more is a song
 * with an ending.
 */
export const CLIP_LOOP_SECONDS = 20;

/**
 * A filed running time (`0:07`, `3:41`) as seconds, or `null` when it names no length.
 *
 * Deliberately strict about the shape, because `formatClock` is the only thing that writes one and
 * it writes `m:ss` - so anything else (`--:--`, a blank, a hand-edited jsonb row) is not a length
 * this can act on, and saying `null` is how that is said. The hours part is accepted because a
 * running time may come from somewhere other than this site's own clock one day; nothing here
 * writes one.
 */
export function secondsFromLength(length: string | undefined | null): number | null {
  if (typeof length !== 'string') return null;

  const parts = length.trim().split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((part) => part.length > 0 && /^\d+$/.test(part))) return null;

  // The last part is the seconds and is always padded to two digits by `formatClock`; the one
  // before it is minutes. Anything further left is hours, folded in.
  const seconds = Number(parts[parts.length - 1]);
  const minutes = Number(parts[parts.length - 2]);
  if (parts[parts.length - 1].length !== 2 || seconds > 59) return null;

  const hours = parts.length === 3 ? Number(parts[0]) : 0;

  const total = hours * 3600 + minutes * 60 + seconds;

  // `0:00` is not a clip, it is an unread file - and it is what a length column holds when the
  // browser could not measure anything at all.
  return total > 0 ? total : null;
}

/**
 * Whether this file repeats itself, and `null` for "no opinion".
 *
 * Takes the track rather than its length because that is what the player holds: `length` is
 * optional on `AudioTrack` and on `ForumTrack` alike, and a file with none - a profile's own song,
 * a file nobody measured - is the case this has to answer honestly rather than assume about.
 */
export function clipRepeats(file: { length?: string } | undefined): true | null {
  if (file === undefined) return null;

  const seconds = secondsFromLength(file.length);
  if (seconds === null) return null;

  return seconds <= CLIP_LOOP_SECONDS ? true : null;
}
