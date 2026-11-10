/**
 * Letters (Luke, 2026-11-10; SPEC-letters.md): a person's small canvases of things from around the site, like playlists.
 * A letter keeps references, never copies: what kind of thing an item is and which one, with the title and picture address
 * it had when added (so it shows at once, and still shows where the thing has no lookup by id), and where its card sits.
 */

export const LETTER_KINDS = ['web', 'media', 'kino', 'thread', 'post', 'lore', 'file', 'song', 'profile', 'link', 'highlight'] as const;
export type LetterKind = (typeof LETTER_KINDS)[number];

export type Letter = {
  id: string;
  owner: string;
  name: string;
  description: string;
  /** A name-colour swatch hex (`NAME_COLOURS`), or undefined for the theme's own ink. */
  textColour?: string;
  /** The stamp picture: an uploaded picture's address, or the picture of something in the letter. */
  stampUrl?: string;
  /** 0-100: how strongly the stamp picture repeats behind the canvas (30 to start). */
  stampOpacity: number;
  /** 1-10: how many times the stamp picture repeats across the canvas (more is smaller and closer). */
  stampDensity: number;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
};

/** What ADD TO LETTER hands over: the thing itself, as a reference with its title and picture. */
export type LetterThing = {
  kind: LetterKind;
  /** Which one: a MEDIA row's id, a thread's id, a lore page's slug, a profile's id, a link's address... */
  ref: string;
  title: string;
  /** An https or site address, or undefined for a thing with no picture. */
  picture?: string;
};

export type LetterItem = LetterThing & {
  id: string;
  letterId: string;
  /** 0-1 across and down the canvas: the card's centre. */
  x: number;
  y: number;
  /** Degrees, -15 to 15: the card's slight tilt. */
  turn: number;
  addedAt: string;
};

export type LetterPatch = Partial<Pick<Letter, 'name' | 'description' | 'textColour' | 'stampUrl' | 'stampOpacity' | 'stampDensity' | 'isPublic'>>;

export type Placement = Pick<LetterItem, 'x' | 'y' | 'turn'>;

export const LETTER_NAME_MAX = 40;
export const LETTER_DESCRIPTION_MAX = 200;
export const LETTER_TITLE_MAX = 200;
export const LETTERS_PER_PERSON_MAX = 100;
export const ITEMS_PER_LETTER_MAX = 200;
export const STAMP_OPACITY_START = 30;
export const STAMP_DENSITY_START = 4;

export const TOO_MANY_LETTERS = 'That is 100 letters, the most there is room for. Delete one first.';
export const TOO_MANY_ITEMS = 'That letter holds 200 things, the most there is room for.';

export type LettersRepository = {
  /** The letters of `owner` this reader may see: all of them for the owner, the public ones for anyone else. Oldest first. */
  listOf(owner: string): Promise<Letter[]>;
  get(id: string): Promise<Letter | null>;
  items(letterId: string): Promise<LetterItem[]>;
  create(owner: string, name: string): Promise<Letter>;
  update(id: string, patch: LetterPatch): Promise<Letter>;
  remove(id: string): Promise<void>;
  /** Adds a thing at `at`, or says it's already there. */
  addItem(letterId: string, thing: LetterThing, at: Placement): Promise<LetterItem | 'already'>;
  /** Moves cards (SHUFFLE). */
  placeItems(places: (Placement & { id: string })[]): Promise<void>;
  removeItem(id: string): Promise<void>;
};
