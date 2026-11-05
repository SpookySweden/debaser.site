import { SONGS_PER_PERSON_MAX, TOO_MANY_SONGS, type BeatBoxSongRepository, type SavedBeatBoxSong } from './types';

/** The same rules as the table, held in memory for the signed-out-of-Supabase site: each person sees only their own. */
export function createMockSongRepository(): BeatBoxSongRepository {
  const songs = new Map<string, (SavedBeatBoxSong & { owner: string })[]>();
  let nextId = 1;
  let clock = 0;

  const of = (owner: string) => songs.get(owner) ?? [];
  const now = () => new Date(Date.UTC(2026, 10, 5) + clock++ * 1000).toISOString();
  const plain = ({ id, title, song, updatedAt }: SavedBeatBoxSong): SavedBeatBoxSong => ({ id, title, song, updatedAt });

  return {
    async list(owner) {
      return [...of(owner)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(plain);
    },
    async add(owner, title, song) {
      if (of(owner).length >= SONGS_PER_PERSON_MAX) throw new Error(TOO_MANY_SONGS);
      const row = { id: `mock-song-${nextId++}`, owner, title, song, updatedAt: now() };
      songs.set(owner, [...of(owner), row]);
      return plain(row);
    },
    async update(owner, id, song) {
      const row = of(owner).find((entry) => entry.id === id);
      if (!row) throw new Error('That song is not there any more.');
      row.song = song;
      row.updatedAt = now();
      return plain(row);
    },
    async remove(owner, id) {
      songs.set(
        owner,
        of(owner).filter((entry) => entry.id !== id),
      );
    },
  };
}
