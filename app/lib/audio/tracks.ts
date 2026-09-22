import { TRACKS } from '../projects/tracks';

/**
 * What the player plays, and where it comes from.
 *
 * Two shelves, one queue:
 *
 *   1. the files the archive holds itself - `LOCAL_TRACKS` below, which is the
 *      hand-filed manifest (`app/lib/projects/tracks.ts`) read as a plain array of
 *      public paths, so a track dropped into `assets/audio/` and listed there plays
 *      with nothing else to change;
 *   2. everything in the Supabase `mp3` bucket - the track uploaded from the music
 *      shelf, a demo somebody filed from their own account page, whatever is dropped
 *      into the bucket by hand. Those are found by listing the bucket (see
 *      ./supabase-music-repository.ts), so a file put there by hand plays without
 *      anybody editing a list.
 *
 * The queue is therefore never empty, even on a machine with no database: the
 * hand-filed shelf is always there, and a track that has not been drawn yet shows as
 * the path the player is waiting for rather than as a dead button.
 */

export type AudioTrack = {
  /** Stable key: the manifest id, the storage path, or a slug of the file name. */
  id: string;
  title: string;
  /** Who it is credited to. */
  credit: string;
  /** What it is for: a theme, a cue, a rough mix. */
  kind: string;
  /** Browser path or storage URL. */
  src: string;
  /** Running time as it reads in a list, when it is known. */
  length: string;
  /** Where it came from, which is what the player's display calls out. */
  shelf: 'archive' | 'bucket';
};

/** The folder the archive's own audio lives in, served by app/assets/[...path]. */
export const AUDIO_FOLDER = '/assets/audio';

/**
 * The hand-filed shelf: the project manifest, read as the player sees it.
 *
 * The first entry is the theme, exactly as the music page says, so that is what the
 * queue starts on when the bucket has nothing in it.
 */
export const LOCAL_TRACKS: AudioTrack[] = TRACKS.map((track) => ({
  id: track.id,
  title: track.title,
  credit: track.credit,
  kind: track.kind,
  src: track.src,
  length: track.length,
  shelf: 'archive',
}));

/** The track the player starts on: the theme, which is the manifest's first entry. */
export const THEME_TRACK_ID = TRACKS[0]?.id ?? '';

/**
 * A name for a file nobody has described: `band-demo-02.mp3` -> `BAND DEMO 02`.
 *
 * The bucket is the shelf anybody can drop a file onto, so a track without a row in
 * `music_tracks` still gets a title worth reading in the display rather than a URL.
 */
export function titleFromFileName(path: string): string {
  const file = path.split('/').pop() ?? path;
  const stem = file.replace(/\.[a-z0-9]+$/i, '');
  const words = stem.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

  return words.length === 0 ? file.toUpperCase() : words.toUpperCase();
}

/**
 * What the player queues up.
 *
 * The bucket comes first - it is the shelf somebody just put something on - and the
 * archive's own hand-filed shelf follows, so the theme still plays when the bucket is
 * empty. A track that is in both (the same file uploaded and also filed by hand) is
 * listed once: the bucket's copy wins, because that is the one whose path was just
 * checked.
 */
export function buildQueue(bucket: AudioTrack[], local: AudioTrack[] = LOCAL_TRACKS): AudioTrack[] {
  const seen = new Set<string>();
  const queue: AudioTrack[] = [];

  for (const track of [...bucket, ...local]) {
    if (seen.has(track.src)) continue;
    seen.add(track.src);
    queue.push(track);
  }

  return queue;
}

/** One file found in the bucket, as the listing reports it. */
export type StoredAudio = {
  /** Path inside the bucket, e.g. `3f2a.../theme-rough-20260921.mp3`. */
  path: string;
  /** The public URL the player streams. */
  src: string;
};

/** What a `music_tracks` row says about one file. */
export type DescribedAudio = {
  src: string;
  title: string;
  credit: string;
  kind: string;
  length?: string;
};

/**
 * The bucket's files as playable tracks.
 *
 * A file with a row in `music_tracks` is described by it (title, credit, what kind of
 * cue it is); a file without one still plays - it is titled from its own name - which
 * is the whole point of reading the bucket rather than a list: a track dropped in by
 * hand is on the shelf the moment it lands.
 */
export function tracksFromStorage(objects: StoredAudio[], described: DescribedAudio[]): AudioTrack[] {
  const bySrc = new Map(described.map((row) => [row.src, row]));

  return objects.map((object) => {
    const row = bySrc.get(object.src);

    return {
      id: object.path,
      title: row === undefined || row.title.trim().length === 0 ? titleFromFileName(object.path) : row.title,
      credit: row === undefined || row.credit.trim().length === 0 ? 'DEBASER.SITE' : row.credit,
      kind: row === undefined || row.kind.trim().length === 0 ? 'UPLOADED TO THE SHELF' : row.kind,
      src: object.src,
      length: row?.length ?? '--:--',
      shelf: 'bucket' as const,
    };
  });
}

/** One line under the display: where the track came from, and what it is. */
export function trackCaption(track: AudioTrack | undefined): string {
  if (track === undefined) return 'NOTHING QUEUED';

  const shelf = track.shelf === 'bucket' ? 'UPLOADED' : 'ARCHIVE';

  return track.kind.length === 0 ? `${shelf} :: ${track.credit}` : `${shelf} :: ${track.kind} :: ${track.credit}`;
}
