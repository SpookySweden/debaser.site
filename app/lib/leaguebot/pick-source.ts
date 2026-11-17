/**
 * Which source answers what, and what happens when one doesn't (SPEC-leaguebot.md). Server-side only.
 *
 * - Profile (rank, LP history, past seasons): OP.GG's app server, then U.GG's ranks.
 * - Match history (the last 100 ranked solo games): U.GG, then OP.GG's last 20.
 * Both halves are asked at once; either may come back without the other, and the window says which source each came from.
 * The sources are handed in, so the checks can run the fallbacks with fakes and no network.
 */

import type { Region } from './regions';
import type { RiotId } from './riot-id';
import type { LiveAnswer, LiveGame } from './live-types';
import type { MatchSummary, PlayerAnswer, Profile } from './types';
import { STATS_GAMES } from './types';

export type PlayerSources = {
  opggProfile(id: RiotId, region: Region): Promise<Profile>;
  uggRanks(id: RiotId, region: Region): Promise<Pick<Profile, 'ranks' | 'pastSeasons'>>;
  uggMatches(id: RiotId, region: Region, want: number): Promise<MatchSummary[]>;
  opggMatches(id: RiotId, region: Region): Promise<MatchSummary[]>;
};

/** A "this player doesn't exist" answer, as opposed to a source that broke. */
export function isNotFound(error: unknown): boolean {
  return error instanceof Error && (error.name === 'OpggNotFound' || /not.?found|no summoner|does not exist/i.test(error.message));
}

export type LiveSources = {
  uggLive(id: RiotId, region: Region): Promise<LiveGame | null>;
  opggLive(id: RiotId, region: Region): Promise<LiveGame | null>;
};

/** The live game: U.GG, then OP.GG's site. "Not in a game" from U.GG is believed; only a broken U.GG falls back. */
export async function readLive(id: RiotId, region: Region, sources: LiveSources): Promise<LiveAnswer> {
  let uggTrouble: string;
  try {
    return { game: await sources.uggLive(id, region), source: 'U.GG', notes: [], uggTrouble: null };
  } catch (error) {
    uggTrouble = troubleOf(error);
  }
  // The window's browser asks OP.GG itself when this came from OP.GG through the server (./browser-opgg.ts).
  try {
    return { game: await sources.opggLive(id, region), source: 'OP.GG', notes: ["U.GG isn't answering LEAGUEBOT's server: the live game comes from OP.GG, without roles or duos."], uggTrouble };
  } catch (error) {
    if (isNotFound(error)) return { game: null, source: null, notes: [], uggTrouble };
    return { game: null, source: null, notes: ["Neither U.GG nor OP.GG answered for the live game. Try again in a minute."], uggTrouble };
  }
}

export async function readPlayer(id: RiotId, region: Region, sources: PlayerSources): Promise<PlayerAnswer> {
  const notes: string[] = [];
  let missing = 0;

  let uggTrouble: string | null = null;

  const profileTask = (async (): Promise<{ profile: Profile; source: 'OP.GG' | 'U.GG' } | null> => {
    try {
      return { profile: await sources.opggProfile(id, region), source: 'OP.GG' };
    } catch (error) {
      if (isNotFound(error)) missing += 1;
      try {
        const { ranks, pastSeasons } = await sources.uggRanks(id, region);
        // OP.GG doesn't know them and U.GG has nothing either: nobody by that name, not an unranked player.
        if (isNotFound(error) && ranks.length === 0 && pastSeasons.length === 0) return null;
        if (!isNotFound(error)) notes.push("OP.GG didn't answer: rank from U.GG, no LP history.");
        return { profile: { riotId: id, region: region.id, level: null, iconId: null, ranks, lpHistory: [], pastSeasons }, source: 'U.GG' };
      } catch {
        notes.push("Neither OP.GG nor U.GG answered for the rank.");
        return null;
      }
    }
  })();

  const matchesTask = (async (): Promise<{ matches: MatchSummary[]; source: 'OP.GG' | 'U.GG' } | null> => {
    try {
      const matches = await sources.uggMatches(id, region, STATS_GAMES);
      if (matches.length > 0) return { matches, source: 'U.GG' };
    } catch (error) {
      if (!isNotFound(error)) uggTrouble = troubleOf(error);
    }
    try {
      const matches = await sources.opggMatches(id, region);
      // The window's browser fills this out to 100 from OP.GG itself (./browser-opgg.ts); this note is for when it can't.
      if (uggTrouble !== null) notes.push(`Only your last ${matches.length} games: U.GG isn't answering LEAGUEBOT's server right now.`);
      return { matches, source: 'OP.GG' };
    } catch (error) {
      if (isNotFound(error)) missing += 1;
      else notes.push("Neither U.GG nor OP.GG answered for the match history.");
      return null;
    }
  })();

  const [profile, matches] = await Promise.all([profileTask, matchesTask]);
  const notFound = profile === null && (matches === null || matches.matches.length === 0) && missing > 0;
  return {
    profile: profile?.profile ?? null,
    profileSource: profile?.source ?? null,
    matches: matches?.matches ?? null,
    matchesSource: matches?.source ?? null,
    notFound,
    notes: notFound ? [] : notes,
    uggTrouble,
  };
}

/** What a source said when it failed, in a few words: `HTTP 403`, `timed out`, the error's own words. */
export function troubleOf(error: unknown): string {
  if (error && typeof error === 'object') {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') return `HTTP ${status}`;
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message !== '') return message.replace(/\s+/g, ' ').slice(0, 80);
  }
  return 'unknown failure';
}
