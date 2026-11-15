import { safeFetchHead, type FetchLike } from '../safe-fetch';
import { isShort, shortCandidate, youtubeIdOf } from '../shorts';
import type { WebItem } from '../types';

/**
 * **Is this YouTube video a Short? Asked of YouTube itself** (Luke, 2026-11-14: "im noticing that youtube shorts still appear
 * in the media tab, i want them exluded from the results entirely"; and "make sure the shorts thing doesnt affect any music
 * on youtube at all"). SERVER ONLY: it fetches.
 *
 * `https://www.youtube.com/shorts/<id>` answers 200 for a Short and sends any other video on to `/watch` (a 30x). That is
 * YouTube's own page, not an API, so it may change one day (core.md, "forever project"): a HEAD only, no body read, through
 * safe-fetch, and any answer that is neither (a consent page, an error, a timeout) is UNSURE, and an unsure video stays.
 *
 * One quirk (the YOUR YOUTUBE session's drive, 2026-11-14): the page answers 200 for an id YouTube doesn't know too, so a video
 * that has been taken down reads as a Short and is left out. That only hides what could not play anyway; a check's made-up
 * ids are hidden the same way.
 *
 * What is asked: only YouTube rows whose length makes them a candidate (three minutes or less, or not known: shorts.ts
 * `shortCandidate`). Length alone never drops anything; nor does a tag drop music (shorts.ts `isMusicItem`). Answers are kept
 * in this server's memory for a day, so a video is asked about at most once a day per server, and at most `MAX_ASKS` new ones
 * per call, a few at a time.
 */

export const SHORTS_HOSTS = ['www.youtube.com'] as const;
const KEEP_MS = 24 * 60 * 60 * 1000;
/** New videos asked about in one call (the rest stay, unasked, until a later call). */
const MAX_ASKS = 60;
const AT_ONCE = 8;
const TIMEOUT_MS = 4000;
const CONSENT_DECLINED = 'SOCS=CAI';

/** true: a Short. false: a normal video. null: unsure (kept). */
export type ShortAnswer = boolean | null;

const answers = new Map<string, { short: ShortAnswer; at: number }>();

/** How YouTube's answer reads: 200 is a Short; a redirect to /watch is not; anything else is unsure. */
export function readShortsAnswer(status: number, location: string | null): ShortAnswer {
  if (status === 200) return true;
  if (status >= 300 && status < 400 && location !== null) {
    try {
      const to = new URL(location, 'https://www.youtube.com');
      if (/(^|\.)youtube\.com$/.test(to.hostname) && to.pathname === '/watch') return false;
    } catch {
      return null;
    }
  }
  return null;
}

/** Asks YouTube about each id not already known (at most `MAX_ASKS`), and answers for all of them. */
export async function askShorts(ids: readonly string[], deps: { fetch?: FetchLike; now?: () => Date } = {}): Promise<Map<string, ShortAnswer>> {
  const now = (deps.now?.() ?? new Date()).getTime();
  const result = new Map<string, ShortAnswer>();
  const toAsk: string[] = [];
  for (const id of new Set(ids)) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) continue;
    const known = answers.get(id);
    if (known !== undefined && now - known.at < KEEP_MS) result.set(id, known.short);
    else if (toAsk.length < MAX_ASKS) toAsk.push(id);
    else result.set(id, null);
  }
  for (let start = 0; start < toAsk.length; start += AT_ONCE) {
    await Promise.all(
      toAsk.slice(start, start + AT_ONCE).map(async (id) => {
        let short: ShortAnswer = null;
        try {
          // `SOCS=CAI` is YouTube's own "reject all" answer to its cookie notice: without it, a server in Europe is sent to the
          // notice (consent.youtube.com) for every video, which reads as unsure. Checked 2026-11-14: Shorts answer 200, others 303.
          const answer = await safeFetchHead(`https://www.youtube.com/shorts/${id}`, { allowedHosts: SHORTS_HOSTS, fetchImpl: deps.fetch, timeoutMs: TIMEOUT_MS, cookie: CONSENT_DECLINED });
          short = readShortsAnswer(answer.status, answer.location);
        } catch {
          short = null;
        }
        // An unsure answer is kept for an hour only, so a passing hiccup is asked again soon.
        answers.set(id, { short, at: short === null ? now - KEEP_MS + 60 * 60 * 1000 : now });
        result.set(id, short);
      }),
    );
  }
  return result;
}

/**
 * The rows without Shorts: those marked as one (a /shorts/ link, a #shorts tag; never a music row by marks), then those
 * YouTube confirms. Every other row stays, in its order, unsure ones included.
 */
export async function dropShorts<T extends WebItem>(items: readonly T[], deps: { fetch?: FetchLike; now?: () => Date } = {}): Promise<T[]> {
  const marked = items.filter((item) => !isShort(item));
  const ids = marked.filter(shortCandidate).map(youtubeIdOf).filter((id): id is string => id !== null);
  if (ids.length === 0) return marked;
  const asked = await askShorts(ids, deps);
  return marked.filter((item) => {
    const id = youtubeIdOf(item);
    return id === null || asked.get(id) !== true;
  });
}

/** For a check: forget every answer. */
export function forgetShortAnswers(): void {
  answers.clear();
}
