import type { LetterThing } from '../letters/types';

/**
 * Recommendations (Luke, 2026-11-10; SPEC-recommendations.md): a queue of things from around the site (the same references
 * letters keep), sent to chosen people or posted publicly, with a message that is its title.
 */

export type RecommendationTab = 'public' | 'for_me' | 'sent';

export type RecommendationSummary = {
  id: string;
  /** Null for a visitor or a stream guest, who sees ANON instead (as RECOMMENDED does). */
  sender: string | null;
  senderName: string | null;
  title: string;
  message: string;
  isPublic: boolean;
  forumThreadId: string | null;
  createdAt: string;
  /** FOR YOU only: when this reader opened it, or null while it's NEW. */
  readAt: string | null;
  itemCount: number;
  /** A recommended letter, as it was sent (Luke, 2026-11-11), or null when it isn't one. */
  letter: RecommendationLetter | null;
};

/**
 * A letter inside a recommendation: its look, and where each of the recommendation's things sits on its canvas (`places`,
 * in the things' order). A copy made when it was sent, read exactly as its recommendation is.
 */
export type RecommendationLetter = {
  name: string;
  description: string;
  textColour?: string;
  stampUrl?: string;
  stampOpacity: number;
  stampDensity: number;
  places: { x: number; y: number; turn: number }[];
};

/** A letter copy from the database, checked field by field; null for anything that isn't one. */
export function letterFrom(value: unknown): RecommendationLetter | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== 'string' || record.name.length === 0) return null;
  const number = (field: unknown, fallback: number, low: number, high: number) =>
    typeof field === 'number' && Number.isFinite(field) ? Math.min(high, Math.max(low, field)) : fallback;
  const places = Array.isArray(record.places)
    ? record.places.map((place) => {
        const spot = place && typeof place === 'object' ? (place as Record<string, unknown>) : {};
        return { x: number(spot.x, 0.5, 0, 1), y: number(spot.y, 0.5, 0, 1), turn: number(spot.turn, 0, -15, 15) };
      })
    : [];
  return {
    name: record.name.slice(0, 40),
    description: typeof record.description === 'string' ? record.description.slice(0, 200) : '',
    textColour: typeof record.textColour === 'string' && /^#[0-9a-fA-F]{6}$/.test(record.textColour) ? record.textColour : undefined,
    stampUrl: typeof record.stampUrl === 'string' && record.stampUrl.length <= 500 && (record.stampUrl.startsWith('https://') || (record.stampUrl.startsWith('/') && !record.stampUrl.startsWith('//'))) ? record.stampUrl : undefined,
    stampOpacity: number(record.stampOpacity, 30, 0, 100),
    stampDensity: number(record.stampDensity, 4, 1, 10),
    places,
  };
}

export type RecommendationItem = LetterThing & { id: string; position: number };

export const RECOMMENDATION_ITEMS_MAX = 50;
export const RECOMMENDATION_PEOPLE_MAX = 20;
export const RECOMMENDATION_MESSAGE_MAX = 200;
export const LIST_LIMIT = 100;

/** Luke's rule, the same as the database's: the message is the title; one thing, or no message, and the thing's own is. */
export function recommendationTitle(message: string, things: readonly Pick<LetterThing, 'title'>[]): string {
  const first = things[0]?.title.trim().slice(0, 200) || 'SOMETHING';
  if (things.length <= 1) return first;
  const said = message.trim();
  return said.length > 0 ? said : `${first} AND ${things.length - 1} MORE`;
}

export type RecommendationsRepository = {
  list(tab: RecommendationTab): Promise<RecommendationSummary[]>;
  items(id: string): Promise<RecommendationItem[]>;
  /** Who has played something in each of these, by recommendation id: person ids, earliest first. */
  players(ids: readonly string[]): Promise<Record<string, string[]>>;
  /** Sends one; gives back its id. The database checks everything and writes the notifications. */
  send(input: { message: string; isPublic: boolean; things: readonly LetterThing[]; to: readonly string[]; letter?: RecommendationLetter | null }): Promise<string>;
  attachThread(id: string, threadId: string): Promise<void>;
  /** WATCH, LISTEN or READ pressed inside it. */
  played(id: string): Promise<void>;
  markRead(id: string, me: string): Promise<void>;
  remove(id: string): Promise<void>;
};
