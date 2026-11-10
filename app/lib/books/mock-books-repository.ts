import { HIGHLIGHTS_PER_BOOK_MAX, type BookHighlight, type BooksRepository } from './types';

/** Highlights and places in memory for the page load, for the mock accounts: no database, so nothing is kept. */
export function createMockBooksRepository(): BooksRepository {
  const highlights = new Map<string, BookHighlight>();
  const places = new Map<string, number>();
  let next = 1;

  return {
    async mine(person, bookRef) {
      return [...highlights.values()]
        .filter((highlight) => highlight.person === person && highlight.bookRef === bookRef)
        .sort((a, b) => a.place - b.place || a.startAt - b.startAt);
    },
    async add(person, input) {
      const held = [...highlights.values()].filter((highlight) => highlight.person === person && highlight.bookRef === input.bookRef);
      if (held.length >= HIGHLIGHTS_PER_BOOK_MAX) throw new Error('THAT IS 500 HIGHLIGHTS IN THIS BOOK, THE MOST THERE IS ROOM FOR.');
      const highlight: BookHighlight = { ...input, id: `mock-highlight-${next++}`, person, forumCommentId: null, createdAt: new Date().toISOString() };
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
      places.set(`${person}|${bookRef}`, place);
    },
  };
}
