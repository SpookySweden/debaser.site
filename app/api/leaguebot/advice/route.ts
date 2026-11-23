import { isChampionAlias, type ChampionNotes, type PairAdvice } from '../../../lib/leaguebot/advice-notes';
import { pairFrom, readChampionNotes } from '../../../lib/leaguebot/notes-store';
import { json, keeper } from '../../../lib/leaguebot/route-helpers';

/**
 * The Claude-written notes for one pair (SPEC-leaguebot-live-champs.md), read from the folder on SERVER:
 *
 *   GET /api/leaguebot/advice?mine=Evelynn&theirs=Ahri&side=against  ->  PairAdvice
 *
 * `side` is `against` (the picked champion is an enemy), `with` (an ally) or `self` (your own). Champions by Data Dragon's
 * alias. Nothing is written here: the notes were written ahead of time by the batch script. Each file is kept in memory
 * five minutes, so a new batch shows up within five minutes without a restart. No outside source, so no look-up limit.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SIDES: PairAdvice['side'][] = ['against', 'with', 'self'];
const KEEP_MS = 5 * 60 * 1000;

const notes = (alias: string) => keeper.get<ChampionNotes | null>(`notes:${alias}`, KEEP_MS, () => readChampionNotes(alias));

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const mine = url.searchParams.get('mine');
  const theirs = url.searchParams.get('theirs');
  const side = url.searchParams.get('side') as PairAdvice['side'] | null;
  if (!isChampionAlias(mine) || !isChampionAlias(theirs) || side === null || !SIDES.includes(side)) return json(400, { error: 'That pair is not one LEAGUEBOT can read.' });
  try {
    const [a, b] = await Promise.all([notes(mine), side === 'self' ? Promise.resolve(null) : notes(theirs)]);
    return json(200, pairFrom(a, b, mine, theirs, side));
  } catch {
    return json(500, { error: "LEAGUEBOT couldn't read its notes right now." });
  }
}
