import type { SupabaseClient } from '@supabase/supabase-js';
import { TOO_MANY_SONGS, SONGS_PER_PERSON_MAX, type BeatBoxSongRepository, type SavedBeatBoxSong } from './types';

const COLUMNS = 'id, title, song, updated_at';

type SongRow = { id: string; title: string; song: string; updated_at: string };

function fromRow(row: SongRow): SavedBeatBoxSong {
  return { id: row.id, title: row.title, song: row.song, updatedAt: row.updated_at };
}

/**
 * `public.beatbox_songs`. Row Level Security is the real lock: the owner filter here only says what's being asked for.
 * Error words shown to a reader are the site's own, never the database's, apart from the cap's, which the migration wrote.
 */
export function createSupabaseSongRepository(client: SupabaseClient): BeatBoxSongRepository {
  return {
    async list(owner) {
      const { data, error } = await client
        .from('beatbox_songs')
        .select(COLUMNS)
        .eq('owner', owner)
        .order('updated_at', { ascending: false })
        .limit(SONGS_PER_PERSON_MAX);
      if (error) throw new Error('Your saved songs could not be read.');
      return (data as SongRow[]).map(fromRow);
    },
    async add(owner, title, song) {
      const { data, error } = await client
        .from('beatbox_songs')
        .insert({ owner, title, song })
        .select(COLUMNS)
        .single();
      if (error) throw new Error(error.code === 'P0001' ? TOO_MANY_SONGS : 'That song could not be saved.');
      return fromRow(data as SongRow);
    },
    async update(owner, id, song) {
      const { data, error } = await client
        .from('beatbox_songs')
        .update({ song })
        .eq('id', id)
        .eq('owner', owner)
        .select(COLUMNS)
        .single();
      if (error) throw new Error('That song could not be saved.');
      return fromRow(data as SongRow);
    },
    async remove(owner, id) {
      const { error } = await client.from('beatbox_songs').delete().eq('id', id).eq('owner', owner);
      if (error) throw new Error('That song could not be deleted.');
    },
  };
}
