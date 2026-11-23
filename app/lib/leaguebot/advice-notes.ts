/**
 * The shape of the Claude-written notes LEAGUEBOT keeps (SPEC-leaguebot-live-champs.md): one file per champion,
 * `<alias>.json` (Data Dragon's spelling, `Evelynn`, `MonkeyKing`), written ahead of time by
 * `scripts/leaguebot-advice-batch.mjs` into a folder on SERVER and read by `/api/leaguebot/advice`. Nothing is written
 * when someone clicks. Cooldowns are never in here: the panel shows Riot's own numbers for the current patch. Pure.
 */

export type NoteMark = '!' | '+' | '>';

export type NoteLine = { mark: NoteMark; text: string };

export type CcNote = {
  /** `P` for the passive. */
  key: 'P' | 'Q' | 'W' | 'E' | 'R';
  /** Plain words: `stun`, `root`, `knock-up`, `charm`, `slow`, ... */
  type: string;
  /** One line on how to dodge or play around it. */
  dodge: string;
};

export type ChampionNotes = {
  /** Data Dragon's alias, the file's name. */
  champion: string;
  /** The patch the kits were read from, `16.22.1`. */
  patch: string;
  /** Which model wrote this champion's own parts (its CC and Arena notes). */
  model: string;
  /** ISO time the champion's own parts were written. */
  writtenAt: string;
  /** Written with the long, deep prompt (Evelynn first). */
  deep: boolean;
  cc: CcNote[];
  /** Notes kept for the Arena support planned later; not shown yet. */
  arena: { duos: string[]; notes: string[] };
  /** This champion against each opponent, from this champion's side, keyed by the opponent's alias. */
  against: Record<string, { lines: NoteLine[]; model: string; deep: boolean }>;
  /** This champion alongside each ally, keyed by the ally's alias. */
  with: Record<string, { lines: NoteLine[]; model: string }>;
};

/** What `/api/leaguebot/advice` answers for one pair: your champion and the one picked. */
export type PairAdvice = {
  /** `against` when the picked champion is an enemy, `with` for an ally, `self` for your own champion. */
  side: 'against' | 'with' | 'self';
  /** Your champion's note about the picked one, or null when it isn't written yet. */
  lines: NoteLine[] | null;
  /** The picked champion's crowd control with dodge lines, or null when its file isn't written yet. */
  cc: CcNote[] | null;
  model: string | null;
  patch: string | null;
  deep: boolean;
};

/** A Data Dragon alias: letters only (`Evelynn`, `KSante`, `MonkeyKing`). Anything else is refused before it names a file. */
export function isChampionAlias(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z]{2,24}$/.test(value);
}

/** The model's name as the panel prints it (`claude-opus-5-5` -> `CLAUDE OPUS 5.5`). */
export function modelWords(model: string | null): string {
  if (!model) return 'CLAUDE';
  const m = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(model);
  return m ? `CLAUDE ${m[1].toUpperCase()} ${m[2]}.${m[3]}` : model.toUpperCase();
}
