import { dayJitter, NO_TASTE, tasteScore, type Taste } from '../web/recommend';
import type { HistoryAction, HistoryKind, HistoryRow } from './types';

/**
 * FOR YOU's engine (SPEC-recommender.md, Luke 2026-11-13): one way to pick for every lane on the site. Pure, so the checks
 * hold it: nothing here reads a clock, the browser or the network; the page hands it all of that.
 *
 * - Taste: what the person opened, played and read (their private history), stronger for finishing than for opening,
 *   halving every 30 days; NOT FOR ME counts against a thing's words and maker.
 * - A lane: candidates that fit the taste ("familiar") and, about 3 in every 10, candidates one step out on the DISCOVER
 *   map ("new"). Steady all day, different tomorrow (the daily jitter MEDIA uses). One maker can't fill a lane.
 * - Every pick has a why-line in plain words. No scores, counts or percentages ever leave this file.
 */

const DAY_MS = 86_400_000;
const HALF_LIFE_DAYS = 30;
const ACTION_WEIGHT: Record<Exclude<HistoryAction, 'not_for_me'>, number> = { opened: 1, played: 2, read: 2, finished: 3 };
/** How hard NOT FOR ME pushes a thing's words and maker down. */
const NOT_FOR_ME = 2;
/** Of each 10 picks, these places go to something new (7 familiar to 3 new, Luke 2026-11-13). */
const NEW_PLACES = new Set([2, 5, 8]);
/** Each earlier pick by the same maker costs a later one this much. */
const SAME_MAKER = 2;
/** A pick needs at least this much fit to be called familiar. */
const FITS = 0.5;
/** How many of the strongest words look one step out for new things. */
const EXPLORE_FROM = 8;

const normal = (word: string) => word.trim().toLowerCase();
export const keyOf = (kind: HistoryKind, ref: string) => `${kind}:${ref}`;

/** The person's taste: words and makers from their history, weighted by what they did and how long ago. */
export function tasteFromHistory(rows: readonly HistoryRow[], now: number, base: Taste = NO_TASTE): Taste {
  const tags: Record<string, number> = { ...base.tags };
  const creators: Record<string, number> = { ...base.creators };
  for (const row of rows) {
    const age = Math.max(0, now - Date.parse(row.lastAt)) / DAY_MS;
    const fade = Number.isFinite(age) ? 0.5 ** (age / HALF_LIFE_DAYS) : 0;
    const weight = row.action === 'not_for_me' ? -NOT_FOR_ME : ACTION_WEIGHT[row.action] * fade;
    for (const word of new Set(row.words.map(normal).filter(Boolean))) tags[word] = (tags[word] ?? 0) + weight;
    const maker = normal(row.maker);
    if (maker !== '') creators[maker] = (creators[maker] ?? 0) + weight;
  }
  return { tags, creators, platforms: base.platforms };
}

/** Things the person pressed NOT FOR ME on: never offered again. */
export function hiddenKeys(rows: readonly HistoryRow[]): ReadonlySet<string> {
  return new Set(rows.filter((row) => row.action === 'not_for_me').map((row) => keyOf(row.kind, row.ref)));
}

/** Everything already in the history: a lane offers things like them, not the same things again. */
export function seenKeys(rows: readonly HistoryRow[]): ReadonlySet<string> {
  return new Set(rows.map((row) => keyOf(row.kind, row.ref)));
}

/** The person's strongest words, best first. */
export function strongestWords(taste: Taste, limit: number): string[] {
  return Object.entries(taste.tags)
    .filter(([, weight]) => weight > 0)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, limit)
    .map(([word]) => word);
}

/**
 * Words one step out: the DISCOVER map's close partners of the person's strongest words that are not in their taste yet,
 * each with the word it came from (for the why-line).
 */
export function exploreWords(taste: Taste, neighbours: (word: string) => readonly string[]): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const word of strongestWords(taste, EXPLORE_FROM)) {
    for (const near of neighbours(word)) {
      const key = normal(near);
      if (key === '' || (taste.tags[key] ?? 0) !== 0 || out.has(key)) continue;
      out.set(key, word);
    }
  }
  return out;
}

export type Candidate<T> = {
  /** `kind:ref`, the same key the history uses. */
  key: string;
  words: readonly string[];
  maker?: string;
  item: T;
  /** An openly shared reason it is here (someone recommended it, a person you're close to posted it), and how much. */
  shared?: { why: string; weight: number };
};

export type LanePick<T> = { key: string; item: T; why: string; fresh: boolean };

const VERB: Record<HistoryKind, Partial<Record<HistoryAction, string>> & { default: string }> = {
  media: { played: 'PLAYED', default: 'OPENED' },
  song: { default: 'PLAYED' },
  book: { finished: 'FINISHED', opened: 'OPENED', default: 'READ' },
  thread: { default: 'READ' },
  room: { default: 'JOINED' },
  letter: { default: 'OPENED' },
  lore: { default: 'READ' },
  person: { default: 'VISITED' },
};

/** What was done, when the kind has no word of its own for it. */
const ACTION_VERB: Partial<Record<HistoryAction, string>> = { played: 'PLAYED', read: 'READ', finished: 'FINISHED' };

const shortTitle =(title: string) => (title.length > 60 ? `${title.slice(0, 57).trimEnd()}...` : title).toUpperCase();

/** Why a familiar pick is here: the history row it shares most with, or its maker. */
function familiarWhy(candidate: Candidate<unknown>, rows: readonly HistoryRow[], taste: Taste): string {
  const maker = candidate.maker ? normal(candidate.maker) : '';
  const words = new Set(candidate.words.map(normal));
  let best: HistoryRow | null = null;
  let bestShared = 0;
  for (const row of rows) {
    if (row.action === 'not_for_me') continue;
    const shared = row.words.filter((word) => words.has(normal(word))).length + (maker !== '' && normal(row.maker) === maker ? 2 : 0);
    if (shared > bestShared) {
      best = row;
      bestShared = shared;
    }
  }
  if (best !== null && best.title !== '') {
    const verb = VERB[best.kind][best.action] ?? (best.action === 'opened' ? undefined : ACTION_VERB[best.action]) ?? VERB[best.kind].default;
    return `BECAUSE YOU ${verb} ${shortTitle(best.title)}`;
  }
  if (maker !== '' && (taste.creators[maker] ?? 0) > 0) return `MORE FROM ${candidate.maker?.toUpperCase()}`;
  const word = candidate.words.map(normal).find((one) => (taste.tags[one] ?? 0) > 0);
  return word ? `FITS ${word.toUpperCase()}` : 'PICKED FOR TODAY';
}

/**
 * One lane: up to `size` picks, about 7 familiar to 3 new, steady for a day. Hidden and already-seen things are left
 * out. A candidate with an openly shared reason counts as familiar and says that reason.
 */
export function pickLane<T>(
  candidates: readonly Candidate<T>[],
  context: { taste: Taste; rows: readonly HistoryRow[]; explore: ReadonlyMap<string, string>; now: number; size: number },
): LanePick<T>[] {
  const { taste, rows, explore, now, size } = context;
  const day = Math.floor(now / DAY_MS);
  const hidden = hiddenKeys(rows);
  const seen = seenKeys(rows);
  const unique = new Map<string, Candidate<T>>();
  for (const candidate of candidates) if (!hidden.has(candidate.key) && !seen.has(candidate.key) && !unique.has(candidate.key)) unique.set(candidate.key, candidate);

  const familiar: { candidate: Candidate<T>; score: number }[] = [];
  const fresh: { candidate: Candidate<T>; score: number; from: string; near: string }[] = [];
  const rest: { candidate: Candidate<T>; score: number }[] = [];
  for (const candidate of unique.values()) {
    const fit = tasteScore({ tags: [...candidate.words], creator: candidate.maker }, taste) + (candidate.shared?.weight ?? 0);
    const jitter = dayJitter(candidate.key, day);
    if (fit >= FITS) {
      familiar.push({ candidate, score: fit + jitter });
      continue;
    }
    if (fit < 0) continue;
    const near = candidate.words.map(normal).find((word) => explore.has(word));
    if (near !== undefined) fresh.push({ candidate, score: jitter, from: explore.get(near) as string, near });
    else rest.push({ candidate, score: jitter });
  }
  const best = (a: { score: number; candidate: Candidate<T> }, b: { score: number; candidate: Candidate<T> }) => b.score - a.score || (a.candidate.key < b.candidate.key ? -1 : 1);
  fresh.sort(best);
  rest.sort(best);

  // Familiar picks one at a time, each maker costing more for every pick of theirs already taken.
  const familiarOrder: { candidate: Candidate<T>; score: number }[] = [];
  const byMaker = new Map<string, number>();
  const left = [...familiar];
  while (left.length > 0) {
    let at = 0;
    let value = -Infinity;
    left.forEach((one, index) => {
      const maker = one.candidate.maker ? normal(one.candidate.maker) : '';
      const cost = maker === '' ? 0 : SAME_MAKER * (byMaker.get(maker) ?? 0);
      if (one.score - cost > value || (one.score - cost === value && one.candidate.key < left[at].candidate.key)) {
        at = index;
        value = one.score - cost;
      }
    });
    const [taken] = left.splice(at, 1);
    familiarOrder.push(taken);
    const maker = taken.candidate.maker ? normal(taken.candidate.maker) : '';
    if (maker !== '') byMaker.set(maker, (byMaker.get(maker) ?? 0) + 1);
  }

  const picks: LanePick<T>[] = [];
  const takeFamiliar = () => {
    const one = familiarOrder.shift();
    if (one === undefined) return false;
    picks.push({ key: one.candidate.key, item: one.candidate.item, why: one.candidate.shared?.why ?? familiarWhy(one.candidate, rows, taste), fresh: false });
    return true;
  };
  const takeFresh = () => {
    const one = fresh.shift();
    if (one !== undefined) {
      picks.push({ key: one.candidate.key, item: one.candidate.item, why: `NEW TO YOU: NEAR ${one.from.toUpperCase()}`, fresh: true });
      return true;
    }
    const other = rest.shift();
    if (other === undefined) return false;
    picks.push({ key: other.candidate.key, item: other.candidate.item, why: 'NEW TO YOU', fresh: true });
    return true;
  };
  while (picks.length < size) {
    const place = picks.length % 10;
    const took = NEW_PLACES.has(place) ? takeFresh() || takeFamiliar() : takeFamiliar() || takeFresh();
    if (!took) break;
  }
  return picks;
}
