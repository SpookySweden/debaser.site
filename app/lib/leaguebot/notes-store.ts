/**
 * Where the Claude-written notes are kept and how one pair is read from them (SPEC-leaguebot-live-champs.md, Luke's 2A:
 * a data folder on SERVER, not git or the database). `scripts/leaguebot-advice-batch.mjs` writes one `<alias>.json` per
 * champion there; `/api/leaguebot/advice` reads them. Server-side only (it reads files).
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isChampionAlias, type ChampionNotes, type PairAdvice } from './advice-notes';

/** SERVER's folder, unless `LEAGUEBOT_ADVICE_DIR` names another (a laptop, a test). */
export const DEFAULT_NOTES_DIR = 'I:\\DEBASER\\leaguebot-advice';

export function notesDir(): string {
  return process.env.LEAGUEBOT_ADVICE_DIR || DEFAULT_NOTES_DIR;
}

/** One champion's notes, or null when its file isn't written yet (or can't be read). */
export async function readChampionNotes(alias: string, dir = notesDir()): Promise<ChampionNotes | null> {
  if (!isChampionAlias(alias)) return null;
  try {
    // The comment keeps the build's file tracer from reading this as "every .json in the project" (Temp/check-build-trace.cjs).
    const parsed = JSON.parse(await readFile(path.join(/* turbopackIgnore: true */ dir, `${alias}.json`), 'utf8')) as ChampionNotes;
    return parsed && typeof parsed === 'object' && parsed.champion === alias ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * A champion's CC lines, or null while its own parts aren't written yet: a file can exist before then, holding only the
 * notes other champions' batches wrote about it.
 */
const ccOf = (notes: ChampionNotes | null) => (notes?.writtenAt ? notes.cc : null);

/** Your champion's note about the picked one (for allies, either side's), and the picked one's CC. Pure. */
export function pairFrom(mine: ChampionNotes | null, theirs: ChampionNotes | null, mineAlias: string, theirsAlias: string, side: PairAdvice['side']): PairAdvice {
  if (side === 'self') {
    return { side, lines: null, cc: ccOf(mine), model: mine?.model || null, patch: mine?.patch ?? null, deep: mine?.deep ?? false };
  }
  if (side === 'with') {
    const note = mine?.with[theirsAlias] ?? theirs?.with[mineAlias] ?? null;
    return { side, lines: note?.lines ?? null, cc: ccOf(theirs), model: note?.model || theirs?.model || null, patch: mine?.patch ?? theirs?.patch ?? null, deep: false };
  }
  const note = mine?.against[theirsAlias] ?? null;
  return { side, lines: note?.lines ?? null, cc: ccOf(theirs), model: note?.model || theirs?.model || null, patch: mine?.patch ?? theirs?.patch ?? null, deep: note?.deep ?? false };
}
