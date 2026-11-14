import { createWindowSlot } from '../ui/window-slot';
import { blipGain, blipHz, speaks, type Voice } from './voice';

/**
 * The sound of a character talking, and the reader's choice to hear it (SPEC-character-speech.md; Luke, 2026-11-14).
 *
 * **Muted until chosen, and never a sound before a press.** The choice is one for the whole site and is remembered in
 * this browser (Luke: "B: Remember my choice"). A browser makes no sound until the reader has pressed something on the
 * page, so the machinery (one `AudioContext`) is only ever made inside a press or a key: the audio key's own press, or,
 * on a later visit with the choice remembered as ON, the reader's first press or key anywhere. Until then the bubbles
 * are silent, and nothing is made.
 *
 * A blip is one short tone per letter, made here in the browser: no recording, nothing downloaded.
 */

const STORAGE_KEY = 'debaser.speech.sound.v1';

const slot = createWindowSlot<boolean>(false);
let read = false;

/** What this session has made and sounded: read by the proof (`scripts/drive-character-speech.cjs`), never by the site. */
const stats = { contexts: 0, blips: 0 };

let context: AudioContext | null = null;
let volume = 0.8;
let waiting = false;

function remembered(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

/** The one `AudioContext`, made; null in a browser that has none. */
function make(): AudioContext | null {
  const Maker: typeof AudioContext | undefined = window.AudioContext;
  if (Maker === undefined) return null;
  stats.contexts += 1;
  return new Maker();
}

/** Makes the sound machinery, or wakes it. Only ever called from inside a press or a key. */
function unlock(): void {
  if (typeof window === 'undefined') return;
  const machinery = context ?? make();
  if (machinery === null) return;
  context = machinery;
  if (machinery.state === 'suspended') void machinery.resume().catch(() => undefined);
}

/** The choice was remembered as ON: the reader's next press or key anywhere is what lets the sound start. */
function unlockOnNextPress(): void {
  if (waiting || typeof window === 'undefined') return;
  waiting = true;
  const once = () => {
    window.removeEventListener('pointerdown', once);
    window.removeEventListener('keydown', once);
    waiting = false;
    if (slot.state()) unlock();
  };
  window.addEventListener('pointerdown', once);
  window.addEventListener('keydown', once);
}

/** Whether the reader has chosen to hear the characters. False on the server and until the browser's memory is read. */
export const speechSoundOn = slot.state;

/**
 * Reads the remembered choice, once: called by the audio key when it is first drawn (from an effect, so the page the
 * server drew and the page the browser first draws agree: both say OFF, and a remembered ON follows a moment later).
 */
export function recallSpeechSound(): void {
  if (read || typeof window === 'undefined') return;
  read = true;
  if (process.env.NODE_ENV !== 'production') {
    (window as unknown as { __debaserSpeech?: typeof stats }).__debaserSpeech = stats;
  }
  if (remembered()) {
    slot.set(true);
    unlockOnNextPress();
  }
}

export const subscribeToSpeechSound = slot.subscribe;

/** The audio key was pressed. Called from that press, which is what a browser needs before it will sound anything. */
export function setSpeechSound(on: boolean): void {
  slot.set(on);
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // A browser that refuses storage still talks; it just forgets on the next visit.
  }
  if (on) unlock();
}

/** The music bar's own volume (0 to 1): the voices follow it, at about half the music's level. */
export function setSpeechVolume(next: number): void {
  volume = next;
}

/** One letter has appeared in `voice`'s bubble: its blip, if the reader is listening and the letter is one that sounds. */
export function blip(voice: Voice, letter: string): void {
  if (!slot.state() || context === null || context.state !== 'running' || !speaks(letter)) return;
  const level = blipGain(volume);
  if (level <= 0) return;

  const now = context.currentTime;
  const length = voice.blipMs / 1000;
  const tone = context.createOscillator();
  const loudness = context.createGain();
  tone.type = voice.wave;
  tone.frequency.setValueAtTime(blipHz(voice, letter, Math.random), now);
  // A click-free blip: up in a few milliseconds, then down to nothing by its end.
  loudness.gain.setValueAtTime(0, now);
  loudness.gain.linearRampToValueAtTime(level, now + 0.004);
  loudness.gain.linearRampToValueAtTime(0, now + length);
  tone.connect(loudness);
  loudness.connect(context.destination);
  tone.start(now);
  tone.stop(now + length + 0.01);
  stats.blips += 1;
}
