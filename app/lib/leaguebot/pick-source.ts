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

export async function readPlayer(id: RiotId, region: Region, sources: PlayerSources): Promise<PlayerAnswer> {
  const notes: string[] = [];
  let missing = 0;

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
    let uggBroke = false;
    try {
      const matches = await sources.uggMatches(id, region, STATS_GAMES);
      if (matches.length > 0) return { matches, source: 'U.GG' };
    } catch (error) {
      uggBroke = !isNotFound(error);
    }
    try {
      const matches = await sources.opggMatches(id, region);
      if (uggBroke) notes.push("U.GG didn't answer: the last 20 games from OP.GG instead of 100.");
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
  };
}
