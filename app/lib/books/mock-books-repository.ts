import { BOOKMARKS_PER_BOOK_MAX, HIGHLIGHTS_PER_BOOK_MAX, PLACES_LISTED_MAX, cleanPlace, type BookBookmark, type BookHighlight, type BookPlace, type BooksRepository } from './types';

/** Highlights, bookmarks, places and settings in memory for the page load, for the mock accounts: no database, so nothing is kept. */
export function createMockBooksRepository(): BooksRepository {
  const highlights = new Map<string, BookHighlight>();
  const bookmarks = new Map<string, BookBookmark>();
  const places = new Map<string, BookPlace>();
  const settings = new Map<string, Record<string, unknown>>();
  let next = 1;

  return {
    async mine(person, bookRef) {
      return [...highlights.values()]
        .filter((highlight) => highlight.person === person && highlight.bookRef === bookRef)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async add(person, input) {
      const held = [...highlights.values()].filter((highlight) => highlight.person === person && highlight.bookRef === input.bookRef);
      if (held.length >= HIGHLIGHTS_PER_BOOK_MAX) throw new Error('THAT IS 500 HIGHLIGHTS IN THIS BOOK, THE MOST THERE IS ROOM FOR.');
      const highlight: BookHighlight = {
        ...input,
        place: 0,
        startAt: 0,
        endAt: 0,
        id: `mock-highlight-${next++}`,
        person,
        forumCommentId: null,
        createdAt: new Date().toISOString(),
      };
      highlights.set(highlight.id, highlight);
      return highlight;
    },
    async update(id, patch) {
      const highlight = highlights.get(id);
      if (highlight) highlights.set(id, { ...highlight, ...patch });
    },
    async remove(id) {
      highlights.delete(id);
    },
    async get(id) {
      return highlights.get(id) ?? null;
    },
    async readers(bookRef) {
      const counts = new Map<string, { highlights: number; latest: string }>();
      for (const highlight of highlights.values()) {
        if (highlight.bookRef !== bookRef || highlight.isLocked) continue;
        const held = counts.get(highlight.person) ?? { highlights: 0, latest: '' };
        counts.set(highlight.person, { highlights: held.highlights + 1, latest: highlight.createdAt > held.latest ? highlight.createdAt : held.latest });
      }
      return [...counts].map(([person, held]) => ({ person, displayName: null, ...held }));
    },
    async place(person, bookRef) {
      return places.get(`${person}|${bookRef}`) ?? null;
    },
    async savePlace(person, bookRef, place) {
      const clean = cleanPlace(place);
      const held = places.get(`${person}|${bookRef}`);
      places.set(`${person}|${bookRef}`, { ...clean, title: clean.title || held?.title || '', bookRef, updatedAt: new Date().toISOString() });
    },
    async places(person) {
      return [...places]
        .filter(([key]) => key.startsWith(`${person}|`))
        .map(([, place]) => place)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, PLACES_LISTED_MAX);
    },
    async unfinish(person, bookRef) {
      const held = places.get(`${person}|${bookRef}`);
      if (held) places.set(`${person}|${bookRef}`, { ...held, finishedAt: null, updatedAt: new Date().toISOString() });
    },
    async bookmarks(person, bookRef) {
      return [...bookmarks.values()]
        .filter((bookmark) => bookmark.person === person && bookmark.bookRef === bookRef)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async addBookmark(person, input) {
      const held = [...bookmarks.values()].filter((bookmark) => bookmark.person === person && bookmark.bookRef === input.bookRef);
      if (held.length >= BOOKMARKS_PER_BOOK_MAX) throw new Error('THAT IS 200 BOOKMARKS IN THIS BOOK, THE MOST THERE IS ROOM FOR.');
      const same = held.find((bookmark) => bookmark.cfi === input.cfi);
      if (same) return same;
      const bookmark: BookBookmark = { ...input, id: `mock-bookmark-${next++}`, person, createdAt: new Date().toISOString() };
      bookmarks.set(bookmark.id, bookmark);
      return bookmark;
    },
    async removeBookmark(id) {
      bookmarks.delete(id);
    },
    async readerSettings(person) {
      return settings.get(person) ?? null;
    },
    async saveReaderSettings(person, value) {
      settings.set(person, value);
    },
  };
}
