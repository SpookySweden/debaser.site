/**
 * A song someone saved from the beat box. `song` is BeepBox's own text, the part of a song link after the #.
 * A saved song is private to the person who saved it; sharing one is a forum post, made on purpose.
 */
export type SavedBeatBoxSong = {
  id: string;
  title: string;
  song: string;
  updatedAt: string;
};

export const SONG_TITLE_MAX = 60;
export const SONG_TEXT_MAX = 100_000;
export const SONGS_PER_PERSON_MAX = 100;

export const TOO_MANY_SONGS = 'That is 100 saved songs, the most there is room for. Delete one first.';

export type BeatBoxSongRepository = {
  /** The signer-in's own songs, newest change first. */
  list(owner: string): Promise<SavedBeatBoxSong[]>;
  add(owner: string, title: string, song: string): Promise<SavedBeatBoxSong>;
  /** Saves over a song, keeping its title. */
  update(owner: string, id: string, song: string): Promise<SavedBeatBoxSong>;
  remove(owner: string, id: string): Promise<void>;
};
