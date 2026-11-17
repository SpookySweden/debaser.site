import type { HistoryRow } from '../recommender/types';
import { dayJitter, tasteScore, type Taste } from './recommend';
import type { WebItem } from './types';

/**
 * Which lives to ask for, and their order, for MEDIA's feed and FOR YOU (SPEC-live-streams.md; Luke, 2026-11-17: "reccomend
 * twitch streams based on user history- linked youtube and tags and association and all other data we have in the algorithm").
 * Pure, so `scripts/check-web-search-twitch.cjs` holds it; the asking is use-live-lane.ts.
 * - **history:** the Twitch channels this reader opened here (their MEDIA history, `twitch:<login>`), newest first, then the ones
 *   they watched in a room (HISTORY's lines, `playedChannels`);
 * - **linked YouTube and makers:** the makers their taste leans to (YOUR YOUTUBE's channels and likes feed it) and the channels
 *   of YOUR YOUTUBE's rows, each tried as a Twitch login by the same name;
 * - **words and tags:** their taste's strongest words, matched to Twitch's categories and YouTube's lives (`/api/web/live`).
 */

const DAY_MS = 86_400_000;
const MAX_CHANNELS = 100;
const MAX_WORDS = 5;
const LOGIN = /^[a-z0-9][a-z0-9_]{1,24}$/;
const WORD = /^[\p{L}\p{N}]{3,40}$/u;

/** A maker's name as a Twitch login would spell it: lower case, letters, digits and `_` only. Null when it can't be one. */
export function loginLike(name: string): string | null {
  const squashed = name.toLowerCase().replace(/[^a-z0-9_]/g, '');
  return LOGIN.test(squashed) ? squashed : null;
}

/** The Twitch channel a HISTORY line played (its address, `https://www.twitch.tv/<login>`), or null. */
export function playedChannel(ref: string): string | null {
  const match = /^https:\/\/www\.twitch\.tv\/([a-z0-9][a-z0-9_]{1,24})$/.exec(ref);
  return match === null ? null : match[1];
}

/** The Twitch channels in a history, newest first, without the ones marked NOT FOR ME. */
function watchedChannels(history: readonly HistoryRow[]): string[] {
  return [...history]
    .filter((row) => row.kind === 'media' && row.ref.startsWith('twitch:') && row.action !== 'not_for_me')
    .sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt))
    .map((row) => row.ref.slice('twitch:'.length))
    .filter((login) => LOGIN.test(login));
}

/** What to ask `/api/web/live` for: channels (history first, then makers) and words. */
export function liveAsk(taste: Taste, history: readonly HistoryRow[], youtubeMakers: readonly string[], playedChannels: readonly string[] = []): { channels: string[]; words: string[] } {
  const makers = Object.entries(taste.creators)
    .sort(([, a], [, b]) => b - a)
    .map(([name]) => name);
  const played = playedChannels.filter((login) => LOGIN.test(login));
  const channels = [...new Set([...watchedChannels(history), ...played, ...[...makers, ...youtubeMakers].map(loginLike).filter((login): login is string => login !== null)])].slice(0, MAX_CHANNELS);
  const words = Object.entries(taste.tags)
    .sort(([, a], [, b]) => b - a)
    .map(([word]) => word)
    .filter((word) => WORD.test(word))
    .slice(0, MAX_WORDS);
  return { channels, words };
}

/** Lives in the reader's order: a channel they watched here first, then the taste's score (words and maker), then the day's jitter. */
export function orderLives<T extends Pick<WebItem, 'id' | 'tags' | 'creator'>>(items: readonly T[], taste: Taste, history: readonly HistoryRow[], now: number, playedChannels: readonly string[] = []): T[] {
  const day = Math.floor(now / DAY_MS);
  const watched = new Set([...watchedChannels(history), ...playedChannels].map((login) => `twitch:${login}`));
  const score = (item: T) => (watched.has(item.id) ? 1000 : 0) + tasteScore(item, taste);
  return [...items].sort((a, b) => score(b) - score(a) || dayJitter(b.id, day) - dayJitter(a.id, day) || a.id.localeCompare(b.id));
}
