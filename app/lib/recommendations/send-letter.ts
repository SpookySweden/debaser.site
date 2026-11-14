import { placeCard } from '../letters/placement';
import { getLettersRepository } from '../letters/repository';
import type { Letter, LetterItem, LetterThing, Placement } from '../letters/types';
import { getRecommendationsRepository, setRecommendationsViewer } from './repository';
import { refreshRecommendations } from './store';
import { RECOMMENDATION_ITEMS_MAX, RECOMMENDATION_MESSAGE_MAX, RECOMMENDATION_PEOPLE_MAX, type RecommendationLetter } from './types';

/**
 * Sending a whole letter to people (SPEC-letter-drag.md, Luke 2026-11-14: "drag and drop letters from the profile page to
 * users on the sidebar or directly to a users character to reccomend them the letter"). What goes is a copy of the letter
 * as it is now, its look and where each thing sits, through the same guarded `recommendation_send` the RECOMMENDATIONS
 * page uses: nothing new is stored, and the database still refuses guests, yourself, and more than 50 sends a day.
 */

/** What a letter looks like, without where its cards sit: what the composer keeps while a queue is being built. */
export type LetterLook = Omit<RecommendationLetter, 'places'>;

export function lookOf(letter: Pick<Letter, 'name' | 'description' | 'textColour' | 'stampUrl' | 'stampOpacity' | 'stampDensity'>): LetterLook {
  return {
    name: letter.name,
    description: letter.description,
    textColour: letter.textColour,
    stampUrl: letter.stampUrl,
    stampOpacity: letter.stampOpacity,
    stampDensity: letter.stampDensity,
  };
}

/** Where each of a letter's things sits on its canvas, by `kind:ref`. */
export function placesByThing(items: readonly Pick<LetterItem, 'kind' | 'ref' | 'x' | 'y' | 'turn'>[]): Record<string, Placement> {
  return Object.fromEntries(items.map((item) => [`${item.kind}:${item.ref}`, { x: item.x, y: item.y, turn: item.turn }]));
}

/** The letter as a recommendation carries it: its look, and one spot per thing in the order sent. A thing with no spot of its own lands clear of the others. */
export function letterCopy(look: LetterLook, things: readonly Pick<LetterThing, 'kind' | 'ref'>[], placeOf: Record<string, Placement>): RecommendationLetter {
  const places: Placement[] = [];
  for (const thing of things) places.push(placeOf[`${thing.kind}:${thing.ref}`] ?? placeCard(places));
  return { ...look, places };
}

/** The note a passed-on letter carries, so it never looks like the sender's own: `FROM NAME'S LETTERS`, then what the sender wrote. */
export function letterNote(note: string, ownerName: string | null): string {
  const said = note.trim();
  if (ownerName === null) return said.slice(0, RECOMMENDATION_MESSAGE_MAX);
  const from = `FROM ${ownerName.trim() || 'SOMEONE'}'S LETTERS`;
  return (said.length > 0 ? `${from}: ${said}` : from).slice(0, RECOMMENDATION_MESSAGE_MAX);
}

export const EMPTY_LETTER = 'EMPTY LETTER: NOTHING TO SEND';

/** What the sender is told once it has gone: SENT "MIXTAPE" TO NAME, or TO 3 PEOPLE, and whether a long letter was cut. */
export function sentLine(letterName: string, names: readonly string[], left: number): string {
  const who = names.length === 1 ? names[0] : names.length + ' PEOPLE';
  return 'SENT "' + letterName + '" TO ' + who + (left > 0 ? ' (ITS FIRST ' + RECOMMENDATION_ITEMS_MAX + ' THINGS)' : '');
}

export type SentLetter = { id: string; things: number; left: number };

/**
 * Sends `letter` to `to`. `ownerName` is the letter's owner when it isn't the sender (a public letter passed on), else null.
 * An empty letter is refused here; a letter holding more than a recommendation can (50) sends its first 50 and says how
 * many were left behind.
 */
export async function sendLetterTo(input: {
  letter: Letter;
  to: readonly string[];
  note?: string;
  ownerName: string | null;
  items?: readonly LetterItem[];
  /** Who is sending: only the made-up store needs telling (the real one asks the session), and until now only the RECOMMENDATIONS page told it. */
  sender?: { id: string; name: string };
}): Promise<SentLetter> {
  if (input.sender) setRecommendationsViewer(input.sender);
  const to = [...new Set(input.to)].slice(0, RECOMMENDATION_PEOPLE_MAX);
  if (to.length === 0) throw new Error('PICK SOMEONE TO SEND IT TO.');
  const items = input.items ?? (await getLettersRepository().items(input.letter.id));
  if (items.length === 0) throw new Error(EMPTY_LETTER);
  const sent = items.slice(0, RECOMMENDATION_ITEMS_MAX);
  const things: LetterThing[] = sent.map((item) => ({ kind: item.kind, ref: item.ref, title: item.title, picture: item.picture }));
  const id = await getRecommendationsRepository().send({
    message: letterNote(input.note ?? '', input.ownerName),
    isPublic: false,
    things,
    to,
    letter: letterCopy(lookOf(input.letter), things, placesByThing(sent)),
  });
  refreshRecommendations();
  return { id, things: sent.length, left: items.length - sent.length };
}
