/**
 * Being a good guest to the sources (SPEC-leaguebot.md): answers are kept in this server's memory for a while, so ten people
 * looking at one Riot ID make one request, and a visitor may make only so many fresh look-ups a minute. Memory only: nothing
 * from a source is ever written to the database. Pure apart from the clock it is handed, so the checks can drive it.
 */

export const KEEP = {
  /** A player's profile and match history. */
  player: 10 * 60 * 1000,
  /** Whether someone is in a game, and the game itself. */
  live: 60 * 1000,
  /** A finished match never changes. */
  match: 24 * 60 * 60 * 1000,
  /** A matchup guide or a champion's build: the sources update them about daily. */
  guide: 6 * 60 * 60 * 1000,
} as const;

/** Fresh (not kept) look-ups one visitor may cause in a minute. */
export const LOOKUPS_PER_MINUTE = 20;
/** How often one Riot ID may ask a source to re-read its games from Riot. */
export const REFRESH_EVERY_MS = 2 * 60 * 1000;
/** A player's answer holds 100 games of ten players: a few hundred kept answers is plenty for one server. */
const MAX_ENTRIES = 400;
const MAX_VISITORS = 2000;

type Entry<T> = { until: number; value: Promise<T> };

export type Keeper = {
  /**
   * The kept answer for `key`, or `make()`'s, kept for `keepMs` once it succeeds and `keepIf` (when given) says it is worth
   * keeping: a failure, or an answer that only says the sources broke, is never kept. A `fresh` ask that fails leaves the
   * answer that was kept before it in place.
   */
  get<T>(key: string, keepMs: number, make: () => Promise<T>, fresh?: boolean, keepIf?: (value: T) => boolean): Promise<T>;
  /** True while `key` is kept (so a look-up costs the sources nothing). */
  has(key: string): boolean;
  /** False when this visitor has made `LOOKUPS_PER_MINUTE` fresh look-ups in the last minute. */
  allow(visitor: string): boolean;
  /** False when this Riot ID was refreshed less than `REFRESH_EVERY_MS` ago; true (and noted) otherwise. */
  mayRefresh(key: string): boolean;
};

export function createKeeper(now: () => number = Date.now): Keeper {
  const entries = new Map<string, Entry<unknown>>();
  const visits = new Map<string, number[]>();
  const refreshed = new Map<string, number>();

  const trim = () => {
    if (entries.size <= MAX_ENTRIES) return;
    const t = now();
    for (const [key, entry] of entries) if (entry.until <= t) entries.delete(key);
    while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
  };

  return {
    get<T>(key: string, keepMs: number, make: () => Promise<T>, fresh = false, keepIf?: (value: T) => boolean): Promise<T> {
      const t = now();
      const kept = entries.get(key) as Entry<T> | undefined;
      if (!fresh && kept && kept.until > t) return kept.value;
      const before = kept && kept.until > t ? kept : undefined;
      const value = make();
      const entry: Entry<T> = { until: t + keepMs, value };
      entries.set(key, entry);
      const forget = () => {
        if (entries.get(key) !== entry) return;
        if (before) entries.set(key, before);
        else entries.delete(key);
      };
      value.then((answer) => {
        if (keepIf && !keepIf(answer)) forget();
      }, forget);
      trim();
      return value;
    },
    has(key) {
      const kept = entries.get(key);
      return kept !== undefined && kept.until > now();
    },
    allow(visitor) {
      const t = now();
      const recent = (visits.get(visitor) ?? []).filter((at) => at > t - 60_000);
      if (recent.length >= LOOKUPS_PER_MINUTE) {
        visits.set(visitor, recent);
        return false;
      }
      recent.push(t);
      visits.set(visitor, recent);
      if (visits.size > MAX_VISITORS) {
        for (const [who, times] of visits) if (times.every((at) => at <= t - 60_000)) visits.delete(who);
        while (visits.size > MAX_VISITORS) visits.delete(visits.keys().next().value as string);
      }
      return true;
    },
    mayRefresh(key) {
      const t = now();
      const last = refreshed.get(key);
      if (last !== undefined && t - last < REFRESH_EVERY_MS) return false;
      refreshed.set(key, t);
      if (refreshed.size > MAX_VISITORS) refreshed.delete(refreshed.keys().next().value as string);
      return true;
    },
  };
}
