import {
  ITEMS_PER_LETTER_MAX,
  LETTERS_PER_PERSON_MAX,
  STAMP_DENSITY_START,
  STAMP_OPACITY_START,
  TOO_MANY_ITEMS,
  TOO_MANY_LETTERS,
  type Letter,
  type LetterItem,
  type LettersRepository,
} from './types';

/** Letters in memory for the page load, for the mock accounts: no database, so they go when the page reloads. */
export function createMockLettersRepository(): LettersRepository {
  const letters = new Map<string, Letter>();
  const items = new Map<string, LetterItem>();
  let next = 1;
  const id = () => `mock-${next++}`;
  const now = () => new Date().toISOString();

  return {
    async listOf(owner) {
      return [...letters.values()].filter((letter) => letter.owner === owner);
    },
    async get(letterId) {
      return letters.get(letterId) ?? null;
    },
    async items(letterId) {
      return [...items.values()].filter((item) => item.letterId === letterId);
    },
    async create(owner, name) {
      if ([...letters.values()].filter((letter) => letter.owner === owner).length >= LETTERS_PER_PERSON_MAX) throw new Error(TOO_MANY_LETTERS);
      const letter: Letter = {
        id: id(),
        owner,
        name,
        description: '',
        stampOpacity: STAMP_OPACITY_START,
        stampDensity: STAMP_DENSITY_START,
        isPublic: false,
        createdAt: now(),
        updatedAt: now(),
      };
      letters.set(letter.id, letter);
      return letter;
    },
    async update(letterId, patch) {
      const letter = letters.get(letterId);
      if (!letter) throw new Error('The letter could not be saved.');
      const changed = { ...letter, ...patch, updatedAt: now() };
      letters.set(letterId, changed);
      return changed;
    },
    async remove(letterId) {
      letters.delete(letterId);
      for (const [itemId, item] of items) if (item.letterId === letterId) items.delete(itemId);
    },
    async addItem(letterId, thing, at) {
      const held = [...items.values()].filter((item) => item.letterId === letterId);
      if (held.some((item) => item.kind === thing.kind && item.ref === thing.ref)) return 'already';
      if (held.length >= ITEMS_PER_LETTER_MAX) throw new Error(TOO_MANY_ITEMS);
      const item: LetterItem = { ...thing, ...at, id: id(), letterId, addedAt: now() };
      items.set(item.id, item);
      return item;
    },
    async placeItems(places) {
      for (const place of places) {
        const item = items.get(place.id);
        if (item) items.set(place.id, { ...item, x: place.x, y: place.y, turn: place.turn });
      }
    },
    async removeItem(itemId) {
      items.delete(itemId);
    },
  };
}
