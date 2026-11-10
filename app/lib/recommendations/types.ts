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
};

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
  send(input: { message: string; isPublic: boolean; things: readonly LetterThing[]; to: readonly string[] }): Promise<string>;
  attachThread(id: string, threadId: string): Promise<void>;
  /** WATCH, LISTEN or READ pressed inside it. */
  played(id: string): Promise<void>;
  markRead(id: string, me: string): Promise<void>;
  remove(id: string): Promise<void>;
};
