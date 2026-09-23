/**
 * The music archive's catalogue.
 *
 * The netlabel shelf: ten artists, two releases each, filed here by hand the same way the
 * concept sheets are. The audio itself is recorded by hand and dropped into the project
 * `assets/audio/` folder by hand - this list only describes what belongs there, so a row
 * plays the moment the file exists, and until then it states the path it is waiting for,
 * which is the audio half of the rule the artwork follows.
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
type ReleaseSeed = {
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
 * The id and the path are derived from the artist, the release and the track's position -
 * never from the title - so retitling a track does not move the file it plays.
 */
function releaseTracks(seed: ReleaseSeed): Track[] {
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

/** The shelf, in the order it was filed: the artists in turn, oldest release first. */
const RELEASES: ReleaseSeed[] = [
  {
    artist: 'SLEEP STATIC',
    album: 'TAPE DECK SUMMER',
    year: '1996',
    tags: ['LO FI', 'HIP HOP'],
    tracks: [
      { title: 'SUMMER STATIC', length: '3:12' },
      { title: 'BACK SEAT RADIO', length: '2:48' },
      { title: 'ONE MORE TAPE', length: '3:40' },
    ],
  },
  {
    artist: 'SLEEP STATIC',
    album: 'RAIN ON CONCRETE',
    year: '1998',
    tags: ['LO FI', 'HIP HOP', 'DOWNTEMPO'],
    tracks: [
      { title: 'WET KERB', length: '4:02' },
      { title: 'LAST BUS HOME', length: '3:26' },
      { title: 'SLEEPLESS AT SIX', length: '3:51' },
    ],
  },
  {
    artist: 'DJ NULLSET',
    album: 'CARGO CULT BEATS',
    year: '1995',
    tags: ['HIP HOP', 'DOWNTEMPO'],
    tracks: [
      { title: 'SAMPLE CLEARANCE', length: '3:08' },
      { title: 'DUSTY FREIGHT', length: '2:57' },
      { title: 'NULL SET', length: '4:15' },
    ],
  },
  {
    artist: 'DJ NULLSET',
    album: 'SLOW TRAIN TO NOWHERE',
    year: '1999',
    tags: ['DOWNTEMPO', 'TRIP HOP'],
    tracks: [
      { title: 'PLATFORM NINE', length: '5:02' },
      { title: 'NO SIGNAL', length: '4:28' },
      { title: 'SLEEPER CAR', length: '6:11' },
    ],
  },
  {
    artist: 'LOWLIGHT CHOIR',
    album: 'SALT FLATS',
    year: '1994',
    tags: ['AMBIENT', 'DRONE'],
    tracks: [
      { title: 'WHITE PAN', length: '6:40' },
      { title: 'MIRAGE', length: '5:18' },
      { title: 'SALT LINE', length: '7:02' },
    ],
  },
  {
    artist: 'LOWLIGHT CHOIR',
    album: 'NIGHT BUS',
    year: '2001',
    tags: ['AMBIENT'],
    tracks: [
      { title: 'TERMINAL LIGHTS', length: '4:44' },
      { title: 'WINDOW SEAT', length: '5:30' },
      { title: 'DAWN INTERCHANGE', length: '6:25' },
    ],
  },
  {
    artist: 'GHOST REPEATER',
    album: 'ABANDONED AIRPORTS',
    year: '1997',
    tags: ['AMBIENT', 'EXPERIMENTAL'],
    tracks: [
      { title: 'CONCOURSE B', length: '8:10' },
      { title: 'DEPARTURES BOARD', length: '5:55' },
      { title: 'NO FLIGHTS', length: '6:48' },
    ],
  },
  {
    artist: 'GHOST REPEATER',
    album: 'TAPE HISS MEDITATION',
    year: '2000',
    tags: ['DRONE', 'EXPERIMENTAL', 'NOISE'],
    tracks: [
      { title: 'HISS LOOP', length: '7:33' },
      { title: 'BROKEN AZIMUTH', length: '4:19' },
      { title: 'STOP BUTTON', length: '3:57' },
    ],
  },
  {
    artist: 'HEXHAM',
    album: 'MACHINE BALLADS',
    year: '1996',
    tags: ['IDM', 'EXPERIMENTAL'],
    tracks: [
      { title: 'BINARY LULLABY', length: '5:12' },
      { title: 'SEQUENCER TEARS', length: '4:36' },
      { title: 'ROOM TONE', length: '6:02' },
    ],
  },
  {
    artist: 'HEXHAM',
    album: 'GRIDLOCK',
    year: '1998',
    tags: ['IDM', 'BREAKCORE'],
    tracks: [
      { title: 'TRAFFIC MODEL', length: '3:44' },
      { title: 'PACKET LOSS', length: '4:08' },
      { title: 'RED LIGHT DISTRICT', length: '5:21' },
    ],
  },
  {
    artist: 'PLASTIC ORACLE',
    album: 'SOFTWARE DECAY',
    year: '1997',
    tags: ['IDM', 'EXPERIMENTAL'],
    tracks: [
      { title: 'DEPRECATED', length: '4:50' },
      { title: 'MEMORY LEAK', length: '3:33' },
      { title: 'ORACLE BONE', length: '5:44' },
    ],
  },
  {
    artist: 'PLASTIC ORACLE',
    album: 'CATHODE',
    year: '1999',
    tags: ['IDM', 'NOISE'],
    tracks: [
      { title: 'PHOSPHOR BURN', length: '4:12' },
      { title: 'SCANLINE', length: '3:29' },
      { title: 'TUBE FAILURE', length: '5:06' },
    ],
  },
  {
    artist: 'BLIND TERMINAL',
    album: 'DEAD SIGNAL',
    year: '1995',
    tags: ['NOISE', 'EXPERIMENTAL'],
    tracks: [
      { title: 'CARRIER LOST', length: '6:20' },
      { title: 'STATIC BLOOM', length: '5:41' },
      { title: 'TERMINAL HUM', length: '7:14' },
    ],
  },
  {
    artist: 'BLIND TERMINAL',
    album: 'FEEDBACK LOOP',
    year: '2002',
    tags: ['NOISE', 'DRONE'],
    tracks: [
      { title: 'HOWL BACK', length: '8:02' },
      { title: 'GROUND LOOP', length: '5:27' },
      { title: 'CLIPPING', length: '4:45' },
    ],
  },
  {
    artist: 'VHS MARTYR',
    album: 'TRACKING ERROR',
    year: '1998',
    tags: ['NOISE', 'BREAKCORE'],
    tracks: [
      { title: 'BLUE SCREEN TEARS', length: '3:18' },
      { title: 'TRACKING BAR', length: '2:44' },
      { title: 'REWIND DAMAGE', length: '4:01' },
    ],
  },
  {
    artist: 'VHS MARTYR',
    album: 'HEAD CLEANING TAPE',
    year: '2003',
    tags: ['NOISE', 'BREAKCORE', 'EXPERIMENTAL'],
    tracks: [
      { title: 'CHROME DUST', length: '5:33' },
      { title: 'AUTO TRACKING', length: '3:52' },
      { title: 'TAPE EATER', length: '6:07' },
    ],
  },
  {
    artist: 'CONCRETE ANGEL',
    album: 'STAIRWELL',
    year: '1996',
    tags: ['DOWNTEMPO', 'TRIP HOP'],
    tracks: [
      { title: 'TWELVE FLOORS', length: '4:22' },
      { title: 'LANDING LIGHT', length: '3:47' },
      { title: 'BROKEN LIFT', length: '5:15' },
    ],
  },
  {
    artist: 'CONCRETE ANGEL',
    album: 'CITY OF SMALL ROOMS',
    year: '1999',
    tags: ['DOWNTEMPO', 'LO FI'],
    tracks: [
      { title: 'BEDSIT', length: '3:36' },
      { title: 'NIGHT PORTER', length: '4:09' },
      { title: 'LAST ROOM', length: '5:48' },
    ],
  },
  {
    artist: 'SPOKEN WIRE',
    album: 'PIRATE RADIO GHOSTS',
    year: '1997',
    tags: ['SPOKEN WORD', 'EXPERIMENTAL'],
    tracks: [
      { title: 'FREQUENCY DRIFT', length: '4:31' },
      { title: 'ANNOUNCEMENT', length: '2:58' },
      { title: 'DEAD AIR', length: '5:12' },
    ],
  },
  {
    artist: 'SPOKEN WIRE',
    album: 'LAST TRANSMISSION',
    year: '2001',
    tags: ['SPOKEN WORD', 'AMBIENT'],
    tracks: [
      { title: 'SIGN OFF', length: '6:03' },
      { title: 'REPEATER', length: '4:47' },
      { title: 'SILENCE AFTER', length: '7:26' },
    ],
  },
];

/** Every track the archive holds: ten artists, twenty releases, in filing order. */
export const TRACKS: Track[] = RELEASES.flatMap(releaseTracks);
