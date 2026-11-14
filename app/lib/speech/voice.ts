/**
 * A character's voice, worked out and never chosen (SPEC-character-speech.md; Luke, 2026-11-14: "Make our own blip
 * voice", and of whose voice is whose: "A: From the character").
 *
 * The voice is one short blip per letter, the Undertale way. Two things decide how a character sounds:
 *
 *   - **its height:** a taller character is deeper (the strip's own height in blocks, floor to head);
 *   - **its account:** a quirk hashed from the account's id (which wave, how long a blip, how much the pitch wobbles
 *     from letter to letter, and a small shift of its own), so two characters of one height are still two voices.
 *
 * Nothing is stored and nothing is random here: the same character always has the same voice. The wobble from letter
 * to letter is the caller's dice (`blipHz`), which is what makes it sound like talking instead of a tone.
 *
 * Pure, so `Temp/check-character-speech.cjs` can hold it.
 */

export type Voice = {
  /** The shape of the sound: a square wave is reedy, a triangle is soft. */
  wave: 'square' | 'triangle';
  /** The pitch it speaks around, in hertz. */
  hz: number;
  /** How far a letter may stray from that pitch, as a share of it. */
  wobble: number;
  /** How long one blip sounds, in milliseconds. */
  blipMs: number;
};

/** The heights a figure comes in, in blocks: the tallest preset is 30 tall. */
const SHORT = 8;
const TALL = 30;
/** The pitch of the shortest and of the tallest: high and small, low and big. */
const HIGH_HZ = 520;
const LOW_HZ = 180;
/** A figure with no character of its own (the placeholder field): a plain middle voice. */
const MIDDLE_HZ = 340;

/** A small, steady number out of an account's id: the same id is always the same number. */
function hashOf(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * The voice of `accountId`'s character, `height` blocks tall (null for a figure with no character of its own).
 */
export function voiceFor(accountId: string, height: number | null): Voice {
  const hash = hashOf(accountId);
  const share = height === null ? null : Math.min(1, Math.max(0, (height - SHORT) / (TALL - SHORT)));
  const base = share === null ? MIDDLE_HZ : HIGH_HZ - share * (HIGH_HZ - LOW_HZ);
  // The account's own shift: up to 8% either way, so two figures of one height are not one voice.
  const shift = 1 + (((hash >>> 8) % 161) - 80) / 1000;

  return {
    wave: hash % 2 === 0 ? 'square' : 'triangle',
    hz: Math.round(base * shift),
    wobble: 0.03 + ((hash >>> 4) % 8) / 100,
    blipMs: 40 + ((hash >>> 12) % 21),
  };
}

/** Whether a letter makes a sound: letters and digits do; a space, a mark of punctuation and a symbol are silent. */
export function speaks(letter: string): boolean {
  return /[\p{L}\p{N}]/u.test(letter);
}

const VOWELS = 'aeiouyAEIOUY';

/**
 * The pitch of one letter in `voice`: around the voice's own, a vowel a little higher (an open sound), and strayed by
 * the dice within the voice's wobble.
 */
export function blipHz(voice: Voice, letter: string, random: () => number): number {
  const open = VOWELS.includes(letter) ? 1.12 : 1;
  const stray = 1 + (random() * 2 - 1) * voice.wobble;
  return voice.hz * open * stray;
}

/** How loud a blip is against the music bar's own volume (0 to 1): about half the music's level, and never clipping. */
export function blipGain(musicVolume: number): number {
  const volume = Number.isFinite(musicVolume) ? Math.min(1, Math.max(0, musicVolume)) : 0;
  return volume * 0.5 * 0.24;
}
