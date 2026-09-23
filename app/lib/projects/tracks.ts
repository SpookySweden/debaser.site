/**
 * The music manifest.
 *
 * Like the concept sheets, the audio itself is made by hand and dropped into the
 * project `assets/audio/` folder by hand - this list only describes what should be
 * there, so the page can point at it. A row plays the file the moment it exists;
 * until then it shows a player slot naming the path it wants, which is the audio
 * half of the same rule the artwork follows ("[ ARTWORK FILE NOT FOUND ]").
 *
 * Adding a track: save the file as `assets/audio/<id>.mp3`, add one entry below
 * (id, title, credit, length, kind), and set `length` to the real running time.
 */
export type Track = {
  /** File name stem; the browser path is built from it, so keep it stable. */
  id: string;
  /** Track-list title. */
  title: string;
  /** Who the track is credited to. */
  credit: string;
  /** Running time as it reads in a track list; `--:--` until the file is filed. */
  length: string;
  /** What it is for: a cue, a theme, a rough mix, a loop. */
  kind: string;
  /** Audio tags: how the track sounds, read by the /music directory's filter. */
  tags: string[];
  /** Browser path, served out of the project `assets/` folder. */
  src: string;
};

/** Where the audio files live, for the notes the page prints. */
export const TRACK_FOLDER = 'assets/audio';

export const TRACKS: Track[] = [
  {
    id: 'track-01',
    title: 'TRACK 01 // UNTITLED',
    credit: 'DEBASER.SITE',
    length: '--:--',
    kind: 'THEME - ROUGH MIX',
    src: '/assets/audio/track-01.mp3',
    tags: ['AMBIENT', 'EXPERIMENTAL'],
  },
  {
    id: 'track-02',
    title: 'TRACK 02 // UNTITLED',
    credit: 'DEBASER.SITE',
    length: '--:--',
    kind: 'CUE - SKETCH',
    src: '/assets/audio/track-02.mp3',
    tags: ['HIP HOP'],
  },
  {
    id: 'track-03',
    title: 'TRACK 03 // UNTITLED',
    credit: 'DEBASER.SITE',
    length: '--:--',
    kind: 'LOOP - AMBIENCE',
    src: '/assets/audio/track-03.mp3',
    tags: ['AMBIENT', 'LO FI'],
  },
];
