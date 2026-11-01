/**
 * The music archive's catalogue.
 *
 * The hand-filed shelf: releases someone has actually put a file up for, described here so the archive can
 * list them. **It holds nothing at the moment** - see `RELEASES` below for why that is the honest state.
 *
 * The audio itself is recorded by hand and dropped into `assets/audio/` by hand - this list only describes
 * what belongs there, so a row plays the moment the file exists, and until then it states the path it is
 * waiting for, which is the audio half of the rule the artwork follows.
 *
 * The other half of the archive is the Supabase `mp3` bucket, listed by asking it rather than by a list in
 * the code (`app/lib/audio/supabase-music-repository.ts`), so an upload from the music window appears with
 * nobody editing this file.
 *
 * ## How a track reads
 *
 * One convention, everywhere, for display and for sorting:
 *
 *     [TRACK TITLE] - [ALBUM NAME] - [ARTIST NAME]
 *
 * `archiveDisplayName` builds it, and the directory prints nothing else as a track's name -
 * so a file pulled out of the archive and into a forum post still reads the same three
 * parts in the same order.
 *
 * ## Filing a track
 *
 * 1. save the audio as `assets/audio/<id>.mp3` (the `id` below, which is
 *    `<artist>-<album>-<number>`);
 * 2. add the release to `RELEASES` with its artist, year, tags and track list;
 * 3. set each `length` to the real running time once the file is there. The list is also
 *    the sleeve notes, and `--:--` beside a finished track reads as a missing file.
 */

export type Track = {
  /** File name stem and key: `<artist>-<album>-<number>`. Keep it stable. */
  id: string;
  /** The track's own name, alone. The rest of the name is built from the release. */
  title: string;
  /** The release it was filed on. */
  album: string;
  /** Who it is credited to. */
  artist: string;
  /** Where it sits on its release, so the list keeps the running order. */
  trackNumber: number;
  /** The year the release carries. */
  year: string;
  /** Running time as it reads in a list; `--:--` until the file is filed. */
  length: string;
  /** How it sounds. The directory's filter reads these. */
  tags: string[];
  /** Browser path, served out of the project `assets/` folder. */
  src: string;
};

/** Where the audio files live, for the notes the page prints. */
export const TRACK_FOLDER = 'assets/audio';

/** One release as it is filed: the artist, the year, how it sounds, and its tracks. */
export type ReleaseSeed = {
  artist: string;
  album: string;
  year: string;
  /** Tags for the release. Every track on it wears them. */
  tags: string[];
  tracks: { title: string; length: string }[];
};

/** `Sleep Static` -> `sleep-static`, for the file stem. */
function stem(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * A release's tracks as the archive lists them.
 *
 * Exported so a check can build a release of *its own* and hold the naming rules against it, rather than
 * against whatever the shipped catalogue happens to contain. That distinction mattered the moment the
 * invented catalogue was removed: three checks had been asserting "sixty tracks" and broke, having been
 * testing fake data rather than the rule they were written for.
 *
 * The id and the path are derived from the artist, the release and the track's position -
 * never from the title - so retitling a track does not move the file it plays.
 */
export function releaseTracks(seed: ReleaseSeed): Track[] {
  return seed.tracks.map((entry, index) => {
    const id = `${stem(seed.artist)}-${stem(seed.album)}-${String(index + 1).padStart(2, '0')}`;

    return {
      id,
      title: entry.title,
      album: seed.album,
      artist: seed.artist,
      trackNumber: index + 1,
      year: seed.year,
      length: entry.length,
      tags: seed.tags,
      src: `/${TRACK_FOLDER}/${id}.mp3`,
    };
  });
}

/**
 * The release's name as one string, in the order a track is named by:
 * `SUMMER STATIC - TAPE DECK SUMMER - SLEEP STATIC`.
 */
export function archiveDisplayName(track: Pick<Track, 'title' | 'album' | 'artist'>): string {
  return `${track.title} - ${track.album} - ${track.artist}`;
}

/**
 * The shelf: the releases the archive actually holds.
 *
 * **Empty, and that is the honest state.** This list used to carry twenty invented releases - ten invented
 * artists, sixty invented track titles, their running times made up - and not one of the `mp3` files they
 * pointed at existed, because there is no audio in the repository at all. Every row in the archive was
 * therefore a path waiting for a file that was never going to arrive, which reads as a broken shelf rather
 * than as an empty one.
 *
 * The machinery is kept and only the data is gone, on purpose: drop a real file into `assets/audio/` and
 * add its release here, and it plays with nothing else to change. A track's `src` is derived from the
 * release, never from the title, so a file keeps playing when its title is edited.
 *
 * The archive is not empty as a *screen* while this list is empty - it lists whatever the Supabase `mp3`
 * bucket holds, which is where uploads go. This list is only the hand-filed half.
 */
const RELEASES: ReleaseSeed[] = [];

/** Every track the archive holds by hand: nothing yet, and the bucket's own files beside it. */
export const TRACKS: Track[] = RELEASES.flatMap(releaseTracks);
