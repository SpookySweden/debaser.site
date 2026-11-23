/**
 * Kept pages, or captures (SPEC-seeing-machine.md, "Captures"): the card, the quotes and the copy. Pure; every stored one is read back
 * through one door.
 */
import { readAddress, shortName } from './address';
import { isOutside } from './history';
import { cleanTitle } from './tabs';

export const QUOTES_MOST = 20;
export const QUOTE_LENGTH = 300;
export const TAGS_MOST = 8;
export const TAG_LENGTH = 40;
export const NOTE_LENGTH = 1000;
/** A copy's most, pictures and all. */
export const KEPT_BYTES = 10 * 1024 * 1024;
const PICTURE_BYTES = 60_000;

export type SeenPage = {
  id: string;
  ownerId: string;
  ownerLabel: string;
  address: string;
  title: string;
  description: string;
  site: string;
  /** Shrunk by the server and carried here: a card asks nothing of the page's own site. */
  picture: string | null;
  language: string;
  /** When the page says it was published (YYYY-MM-DD), or nothing. */
  date: string;
  at: number;
  tags: string[];
  note: string;
  quotes: string[];
  hasCopy: boolean;
  /** Only its owner sees it: the page answered a signed-out reader with something else. */
  private: boolean;
};

export type MadeCopy = { html: string; reading: string | null; title: string };

const line = (value: unknown, most: number): string => (typeof value === 'string' ? value.replace(/[\s\u0000-\u001f\u202a-\u202e\u2066-\u2069]+/g, ' ').trim().slice(0, most) : '');

export const cleanQuote = (value: unknown): string => line(value, QUOTE_LENGTH);

/** As the forum writes a tag: its own words, in capitals, once each. */
export function cleanTags(value: unknown): string[] {
  const all = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : [];
  const tags: string[] = [];
  for (const each of all) {
    const tag = line(each, TAG_LENGTH).replace(/^#+/, '').toUpperCase();
    if (tag !== '' && !tags.includes(tag) && tags.length < TAGS_MOST) tags.push(tag);
  }
  return tags;
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isPageId = (value: unknown): value is string => typeof value === 'string' && ID.test(value);

const KEPT = /^see:kept\/([0-9a-f]{32})$/;
/** A copy's own address in the machine. */
export const keptAddress = (id: string): string => `see:kept/${id.replace(/-/g, '')}`;
export function keptId(address: string): string | null {
  const found = KEPT.exec(address)?.[1];
  return found === undefined ? null : `${found.slice(0, 8)}-${found.slice(8, 12)}-${found.slice(12, 16)}-${found.slice(16, 20)}-${found.slice(20)}`;
}

export function pageFrom(value: unknown): SeenPage | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  const read = typeof row.address === 'string' ? readAddress(row.address) : null;
  if (!isPageId(row.id) || read === null || !read.ok || !isOutside(read.address) || typeof row.at !== 'number' || !Number.isFinite(row.at)) return null;
  return {
    id: row.id,
    ownerId: line(row.ownerId, 64),
    ownerLabel: line(row.ownerLabel, 80),
    address: read.address,
    title: cleanTitle(typeof row.title === 'string' ? row.title : '') ?? read.address,
    description: line(row.description, QUOTE_LENGTH),
    site: shortName(read.address),
    picture: typeof row.picture === 'string' && row.picture.length <= PICTURE_BYTES && /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(row.picture) ? row.picture : null,
    language: line(row.language, 20),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(row.date)) ? String(row.date) : '',
    at: row.at,
    tags: cleanTags(row.tags),
    note: typeof row.note === 'string' ? row.note.slice(0, NOTE_LENGTH) : '',
    quotes: Array.isArray(row.quotes) ? row.quotes.slice(0, QUOTES_MOST).map(cleanQuote).filter((each) => each !== '') : [],
    hasCopy: row.hasCopy === true,
    private: row.private !== false,
  };
}

export function copyFrom(value: unknown): MadeCopy | null {
  if (typeof value !== 'object' || value === null) return null;
  const { html, reading, title } = value as Record<string, unknown>;
  if (typeof html !== 'string') return null;
  const words = typeof reading === 'string' ? reading : null;
  if (html.length + (words?.length ?? 0) > KEPT_BYTES * 2) return null;
  return { html, reading: words, title: line(title, 200) };
}

/** Its card's words, for a search. */
export const pageWords = (page: SeenPage): string[] => [page.title, page.description, page.site, page.note, ...page.tags, ...page.quotes];
