import type { SupabaseClient } from '@supabase/supabase-js';
import { HIGHLIGHTS_PER_BOOK_MAX, type BookHighlight, type BookReader, type BooksRepository } from './types';

const COLUMNS = 'id, person, book_ref, book_title, place, start_at, end_at, quote, comment, is_locked, forum_comment_id, created_at';

type Row = {
  id: string;
  person: string;
  book_ref: string;
  book_title: string;
  place: number;
  start_at: number;
  end_at: number;
  quote: string;
  comment: string;
  is_locked: boolean;
  forum_comment_id: string | null;
  created_at: string;
};

function fromRow(row: Row): BookHighlight {
  return {
    id: row.id,
    person: row.person,
    bookRef: row.book_ref,
    bookTitle: row.book_title,
    place: row.place,
    startAt: row.start_at,
    endAt: row.end_at,
    quote: row.quote,
    comment: row.comment,
    isLocked: row.is_locked,
    forumCommentId: row.forum_comment_id,
    createdAt: row.created_at,
  };
}

/** `book_highlights`, `book_places` and `book_readers()`. Row Level Security is the lock; the filters only say what's asked. */
export function createSupabaseBooksRepository(client: SupabaseClient): BooksRepository {
  return {
    async mine(person, bookRef) {
      const { data, error } = await client
        .from('book_highlights')
        .select(COLUMNS)
        .eq('person', person)
        .eq('book_ref', bookRef)
        .order('place', { ascending: true })
        .order('start_at', { ascending: true })
        .limit(HIGHLIGHTS_PER_BOOK_MAX);
      if (error) throw new Error('Your highlights could not be read.');
      return (data as Row[]).map(fromRow);
    },
    async add(person, highlight) {
      const { data, error } = await client
        .from('book_highlights')
        .insert({
          person,
          book_ref: highlight.bookRef,
          book_title: highlight.bookTitle,
          place: highlight.place,
          start_at: highlight.startAt,
          end_at: highlight.endAt,
          quote: highlight.quote,
          comment: highlight.comment,
          is_locked: highlight.isLocked,
        })
        .select(COLUMNS)
        .single();
      if (error) throw new Error(error.code === 'P0001' ? 'THAT IS 500 HIGHLIGHTS IN THIS BOOK, THE MOST THERE IS ROOM FOR.' : 'The highlight could not be saved.');
      return fromRow(data as Row);
    },
    async update(id, patch) {
      const row: Record<string, unknown> = {};
      if (patch.comment !== undefined) row.comment = patch.comment;
      if (patch.isLocked !== undefined) row.is_locked = patch.isLocked;
      if (patch.forumCommentId !== undefined) row.forum_comment_id = patch.forumCommentId;
      const { error } = await client.from('book_highlights').update(row).eq('id', id);
      if (error) throw new Error('The highlight could not be saved.');
    },
    async remove(id) {
      const { error } = await client.from('book_highlights').delete().eq('id', id);
      if (error) throw new Error('The highlight could not be deleted.');
    },
    async get(id) {
      const { data, error } = await client.from('book_highlights').select(COLUMNS).eq('id', id).maybeSingle();
      if (error || !data) return null;
      return fromRow(data as Row);
    },
    async readers(bookRef) {
      const { data, error } = await client.rpc('book_readers', { p_ref: bookRef });
      if (error) throw new Error('The readers could not be read.');
      return ((data ?? []) as { person: string | null; display_name: string | null; highlights: number; latest: string }[]).map(
        (row): BookReader => ({ person: row.person, displayName: row.display_name, highlights: row.highlights, latest: row.latest }),
      );
    },
    async place(person, bookRef) {
      const { data } = await client.from('book_places').select('place').eq('person', person).eq('book_ref', bookRef).maybeSingle();
      return data ? (data as { place: number }).place : null;
    },
    async savePlace(person, bookRef, place) {
      await client.from('book_places').upsert({ person, book_ref: bookRef, place, updated_at: new Date().toISOString() }, { onConflict: 'person,book_ref' });
    },
  };
}
