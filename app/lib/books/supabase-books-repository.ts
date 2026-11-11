import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BOOKMARKS_PER_BOOK_MAX,
  HIGHLIGHTS_PER_BOOK_MAX,
  isHighlightColour,
  type BookBookmark,
  type BookHighlight,
  type BookReader,
  type BooksRepository,
} from './types';

const COLUMNS = 'id, person, book_ref, book_title, cfi, place, start_at, end_at, quote, comment, colour, is_locked, forum_comment_id, created_at';
const BOOKMARK_COLUMNS = 'id, person, book_ref, cfi, label, created_at';

type Row = {
  id: string;
  person: string;
  book_ref: string;
  book_title: string;
  cfi: string | null;
  place: number;
  start_at: number;
  end_at: number;
  quote: string;
  comment: string;
  colour: string;
  is_locked: boolean;
  forum_comment_id: string | null;
  created_at: string;
};

type BookmarkRow = { id: string; person: string; book_ref: string; cfi: string; label: string; created_at: string };

function fromRow(row: Row): BookHighlight {
  return {
    id: row.id,
    person: row.person,
    bookRef: row.book_ref,
    bookTitle: row.book_title,
    cfi: row.cfi,
    place: row.place,
    startAt: row.start_at,
    endAt: row.end_at,
    quote: row.quote,
    comment: row.comment,
    colour: isHighlightColour(row.colour) ? row.colour : 'yellow',
    isLocked: row.is_locked,
    forumCommentId: row.forum_comment_id,
    createdAt: row.created_at,
  };
}

function fromBookmarkRow(row: BookmarkRow): BookBookmark {
  return { id: row.id, person: row.person, bookRef: row.book_ref, cfi: row.cfi, label: row.label, createdAt: row.created_at };
}

/**
 * `book_highlights`, `book_bookmarks`, `book_places`, `book_reader_settings` and `book_readers()`. Row Level Security is the
 * lock; the filters only say what's asked.
 */
export function createSupabaseBooksRepository(client: SupabaseClient): BooksRepository {
  return {
    async mine(person, bookRef) {
      const { data, error } = await client
        .from('book_highlights')
        .select(COLUMNS)
        .eq('person', person)
        .eq('book_ref', bookRef)
        .order('created_at', { ascending: true })
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
          cfi: highlight.cfi,
          quote: highlight.quote,
          comment: highlight.comment,
          colour: highlight.colour,
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
      if (patch.colour !== undefined) row.colour = patch.colour;
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
      const { data } = await client.from('book_places').select('cfi').eq('person', person).eq('book_ref', bookRef).maybeSingle();
      return data ? ((data as { cfi: string | null }).cfi ?? null) : null;
    },
    async savePlace(person, bookRef, cfi) {
      await client.from('book_places').upsert({ person, book_ref: bookRef, cfi, updated_at: new Date().toISOString() }, { onConflict: 'person,book_ref' });
    },
    async bookmarks(person, bookRef) {
      const { data, error } = await client
        .from('book_bookmarks')
        .select(BOOKMARK_COLUMNS)
        .eq('person', person)
        .eq('book_ref', bookRef)
        .order('created_at', { ascending: true })
        .limit(BOOKMARKS_PER_BOOK_MAX);
      if (error) throw new Error('Your bookmarks could not be read.');
      return (data as BookmarkRow[]).map(fromBookmarkRow);
    },
    async addBookmark(person, bookmark) {
      const { data, error } = await client
        .from('book_bookmarks')
        .upsert({ person, book_ref: bookmark.bookRef, cfi: bookmark.cfi, label: bookmark.label }, { onConflict: 'person,book_ref,cfi' })
        .select(BOOKMARK_COLUMNS)
        .single();
      if (error) throw new Error(error.code === 'P0001' ? 'THAT IS 200 BOOKMARKS IN THIS BOOK, THE MOST THERE IS ROOM FOR.' : 'The bookmark could not be saved.');
      return fromBookmarkRow(data as BookmarkRow);
    },
    async removeBookmark(id) {
      const { error } = await client.from('book_bookmarks').delete().eq('id', id);
      if (error) throw new Error('The bookmark could not be deleted.');
    },
    async readerSettings(person) {
      const { data } = await client.from('book_reader_settings').select('settings').eq('person', person).maybeSingle();
      return data ? (data as { settings: unknown }).settings : null;
    },
    async saveReaderSettings(person, settings) {
      await client.from('book_reader_settings').upsert({ person, settings, updated_at: new Date().toISOString() }, { onConflict: 'person' });
    },
  };
}
