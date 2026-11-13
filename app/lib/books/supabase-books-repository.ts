import type { SupabaseClient } from '@supabase/supabase-js';
import { cleanWork } from './copies';
import {
  BOOKMARKS_PER_BOOK_MAX,
  HIGHLIGHTS_PER_BOOK_MAX,
  PLACES_LISTED_MAX,
  cleanPlace,
  isCfi,
  isHighlightColour,
  type BookPlace,
  type BookBookmark,
  type BookHighlight,
  type BookReader,
  type BooksRepository,
} from './types';

const COLUMNS = 'id, person, book_ref, book_title, cfi, place, start_at, end_at, quote, comment, colour, is_locked, forum_comment_id, created_at, work_ref';
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
  work_ref: string | null;
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
    workRef: row.work_ref ?? null,
  };
}

/** Other readers' public highlights shown in a book: the newest 200. */
const OTHERS_HIGHLIGHTS_MAX = 200;

const PLACE_COLUMNS ='book_ref, cfi, place, title, progress, finished_at, updated_at, work_ref';
type PlaceRow = {
  book_ref: string;
  cfi: string | null;
  place: number;
  title: string | null;
  progress: number | null;
  finished_at: string | null;
  updated_at: string;
  work_ref: string | null;
};

function fromPlaceRow(row: PlaceRow): BookPlace {
  return {
    bookRef: row.book_ref,
    cfi: isCfi(row.cfi) ? row.cfi : null,
    page: row.place ?? 0,
    title: row.title ?? '',
    progress: row.progress ?? 0,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
    workRef: row.work_ref ?? null,
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
          start_at: highlight.startAt ?? 0,
          end_at: highlight.endAt ?? 0,
          work_ref: cleanWork(highlight.workRef),
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
      const { data, error } = await client.from('book_places').select(PLACE_COLUMNS).eq('person', person).eq('book_ref', bookRef).maybeSingle();
      // A failed read says so (it isn't "no place"): your own file's match must not be guessed over (ReaderPage).
      if (error) throw new Error('Your place could not be read.');
      return data ? fromPlaceRow(data as PlaceRow) : null;
    },
    async savePlace(person, bookRef, place) {
      const clean = cleanPlace(place);
      const row: Record<string, unknown> = {
        person,
        book_ref: bookRef,
        cfi: clean.cfi,
        place: clean.page,
        progress: clean.progress,
        finished_at: clean.finishedAt,
        updated_at: new Date().toISOString(),
      };
      // A title not known yet leaves the saved one alone; so does a work not known yet.
      if (clean.title) row.title = clean.title;
      if (clean.workRef) row.work_ref = clean.workRef;
      await client.from('book_places').upsert(row, { onConflict: 'person,book_ref' });
    },
    async places(person) {
      const { data, error } = await client
        .from('book_places')
        .select(PLACE_COLUMNS)
        .eq('person', person)
        .order('updated_at', { ascending: false })
        .limit(PLACES_LISTED_MAX);
      if (error) throw new Error('Your books could not be read.');
      return (data as PlaceRow[]).map(fromPlaceRow);
    },
    async acrossCopies(person, bookRef, work) {
      // This copy's, and every copy of the same work: matched to it, or a Gutenberg ref of it. RLS keeps others' locked ones out.
      const copies = [`book_ref.eq."${bookRef}"`];
      if (work) copies.push(`work_ref.eq."${work}"`, `book_ref.eq."${work}"`, `book_ref.like."${work}-pg*"`);
      // Yours and others' asked apart, so a busy book's public highlights never crowd yours out.
      const [yours, theirs] = await Promise.all([
        client.from('book_highlights').select(COLUMNS).eq('person', person).or(copies.join(',')).order('created_at', { ascending: true }).limit(HIGHLIGHTS_PER_BOOK_MAX * 4),
        client
          .from('book_highlights')
          .select(COLUMNS)
          .neq('person', person)
          .eq('is_locked', false)
          .or(copies.join(','))
          .order('created_at', { ascending: false })
          .limit(OTHERS_HIGHLIGHTS_MAX),
      ]);
      if (yours.error || theirs.error) throw new Error('The highlights could not be read.');
      // Yours first in the order they were made; others' public ones after, newest first.
      return [...(yours.data as Row[]).map(fromRow), ...(theirs.data as Row[]).map(fromRow)];
    },
    async placesOfWork(person, work) {
      const { data, error } = await client
        .from('book_places')
        .select(PLACE_COLUMNS)
        .eq('person', person)
        .or(`work_ref.eq."${work}",book_ref.eq."${work}",book_ref.like."${work}-pg*"`)
        .order('updated_at', { ascending: false })
        .limit(50);
      if (error) return [];
      return (data as PlaceRow[]).map(fromPlaceRow);
    },
    async setWork(person, bookRef, work) {
      if (!/^(books:OL[1-9][0-9]{0,11}W|none)$/.test(work)) throw new Error('That is not a book.');
      // Only the match: an upsert names just these columns, so a place already saved stays as it was.
      const { error } = await client.from('book_places').upsert({ person, book_ref: bookRef, work_ref: work }, { onConflict: 'person,book_ref' });
      if (error) throw new Error('The match could not be saved.');
    },
    async unfinish(person, bookRef) {
      const { error } = await client.from('book_places').update({ finished_at: null, updated_at: new Date().toISOString() }).eq('person', person).eq('book_ref', bookRef);
      if (error) throw new Error('That could not be saved.');
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
      // A plain insert: an upsert would ask to rewrite every column on a clash, and only the label may change.
      const { data, error } = await client
        .from('book_bookmarks')
        .insert({ person, book_ref: bookmark.bookRef, cfi: bookmark.cfi, label: bookmark.label })
        .select(BOOKMARK_COLUMNS)
        .single();
      if (error?.code === '23505') {
        // This page is bookmarked already: that one.
        const held = await client.from('book_bookmarks').select(BOOKMARK_COLUMNS).eq('person', person).eq('book_ref', bookmark.bookRef).eq('cfi', bookmark.cfi).maybeSingle();
        if (held.data) return fromBookmarkRow(held.data as BookmarkRow);
      }
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
