'use client';

import { useSyncExternalStore } from 'react';

/**
 * The stream room's visualiser (Luke, 2026-11-11, from the research he pasted): Butterchurn, Milkdrop in the browser, over
 * the room's screen. This file holds what isn't drawing: whether each viewer has it on in each room (their own choice,
 * never synced, like the canvas key), the calm presets it starts with, and the flashing-lights warning, asked once.
 */

const on = new Map<string, boolean>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVisualiserOn(roomId: string): boolean {
  return useSyncExternalStore(subscribe, () => on.get(roomId) === true, () => false);
}

export function setVisualiserOn(roomId: string, value: boolean): void {
  on.set(roomId, value);
  for (const listener of listeners) listener();
}

/**
 * The calm set it starts with: slower, softer looks from Butterchurn's own pack, picked by Claude by name and to be trimmed
 * by Luke on sight. ALL adds the rest of the pack, some of which flash hard. A name the pack doesn't have is skipped.
 */
export const CALM_PRESETS: readonly string[] = [
  'Flexi - alien fish pond',
  'martin - castle in the air',
  'martin - frosty caves 2',
  'martin - glass corridor',
  'Zylot - Star Ornament',
  'Aderrasi - Songflower (Moss Posy)',
  'Geiss - Reaction Diffusion 2',
  'cope + martin - mother-of-pearl',
  'martin - stormy sea (2010 update)',
  'Flexi + Martin - astral projection',
  'martin - reflections on black tiles',
  'Geiss - Cauldron - painterly 2 (saturation remix)',
  "TonyMilkdrop - Magellan's Nebula [Flexi - you enter first + multiverse]",
  'Flexi - infused with the spiral',
];

/** How long one look stays before the next blends in, and how long the blend takes. */
export const CYCLE_SECONDS = 20;
export const BLEND_SECONDS = 2.7;

/** The presets to cycle through: the calm ones the pack has, or every one. */
export function presetNames(all: readonly string[], wild: boolean): string[] {
  if (wild) return [...all];
  const calm = CALM_PRESETS.filter((name) => all.includes(name));
  return calm.length > 0 ? calm : [...all];
}

/** The next, previous or a random preset's place in the list, never the same one twice running for random. */
export function stepPreset(at: number, length: number, how: 'next' | 'previous' | 'random', random: () => number = Math.random): number {
  if (length <= 1) return 0;
  if (how === 'next') return (at + 1) % length;
  if (how === 'previous') return (at - 1 + length) % length;
  const pick = Math.floor(random() * (length - 1));
  return pick >= at ? pick + 1 : pick;
}

const WARNED = 'debaser-visualiser-warned';

/** Whether this browser has accepted the flashing-lights warning (kept in this browser only). */
export function warningAccepted(): boolean {
  try {
    return window.localStorage.getItem(WARNED) === 'yes';
  } catch {
    return false;
  }
}

export function acceptWarning(): void {
  try {
    window.localStorage.setItem(WARNED, 'yes');
  } catch {
    // Storage refused: the warning simply asks again next time.
  }
}

/* The sliders (Luke, 2026-11-14: "react properly to the audio playing and have accessable sliders") ------------- */

/**
 * What each viewer may turn, kept in their own browser and never synced:
 *   react       how much of the song's rise and fall reaches the picture, in percent. 100 is the song as it is, 0 feeds
 *               the picture silence (it then moves on its own), 200 doubles the swing between a quiet and a loud moment;
 *   speed       how fast the picture's own clock runs, in percent;
 *   brightness  how bright the picture is, in percent (lower for tired eyes, or a dark room);
 *   change      how many seconds one look stays before the next blends in.
 */
export type VisualiserSettings = { react: number; speed: number; brightness: number; change: number };
export type SliderKey = keyof VisualiserSettings;

export type SliderSpec = {
  key: SliderKey;
  /** The word beside it. */
  label: string;
  /** Its full name, for a screen reader. */
  name: string;
  min: number;
  max: number;
  /** One arrow-key press. */
  step: number;
  initial: number;
  /** The value in words: beside the slider, and read out as it moves. */
  say: (value: number) => string;
};

export const SLIDERS: readonly SliderSpec[] = [
  { key: 'react', label: 'REACT', name: 'How strongly it reacts to the sound', min: 0, max: 200, step: 10, initial: 130, say: (value) => (value === 0 ? 'OFF' : `${value}%`) },
  { key: 'speed', label: 'SPEED', name: 'How fast it moves', min: 25, max: 200, step: 5, initial: 100, say: (value) => `${value}%` },
  { key: 'brightness', label: 'BRIGHTNESS', name: 'How bright it is', min: 20, max: 100, step: 5, initial: 100, say: (value) => `${value}%` },
  { key: 'change', label: 'CHANGE EVERY', name: 'How many seconds a look stays before the next', min: 5, max: 120, step: 5, initial: CYCLE_SECONDS, say: (value) => `${value} SECONDS` },
];

export const DEFAULT_SETTINGS: VisualiserSettings = Object.fromEntries(SLIDERS.map((slider) => [slider.key, slider.initial])) as VisualiserSettings;

/** Whatever was stored, made safe: each value inside its slider's range and on one of its steps, a missing or broken one the default. */
export function cleanSettings(raw: unknown): VisualiserSettings {
  const from = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const clean = { ...DEFAULT_SETTINGS };
  for (const slider of SLIDERS) {
    const value = from[slider.key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const stepped = slider.min + Math.round((value - slider.min) / slider.step) * slider.step;
    clean[slider.key] = Math.min(slider.max, Math.max(slider.min, stepped));
  }
  return clean;
}

const SETTINGS = 'debaser-visualiser-settings';

/** This browser's sliders, or the defaults (kept in this browser only). */
export function readSettings(): VisualiserSettings {
  try {
    const stored = window.localStorage.getItem(SETTINGS);
    return stored === null ? { ...DEFAULT_SETTINGS } : cleanSettings(JSON.parse(stored));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: VisualiserSettings): void {
  try {
    window.localStorage.setItem(SETTINGS, JSON.stringify(cleanSettings(settings)));
  } catch {
    // Storage refused: the sliders work until the page is left.
  }
}

/** How loud a frame of sound is, 0 (silence) to 1: the root mean square of bytes that rest at 128. */
export function loudness(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    const sample = (bytes[index] - 128) / 128;
    sum += sample * sample;
  }
  return Math.sqrt(sum / bytes.length);
}

/** Below this a frame counts as silence (a paused song's copy is exactly 0; a codec's hiss is a little above). */
export const SILENCE = 0.002;

/**
 * REACT, as a number to multiply a frame of sound by before the picture sees it.
 *
 * The picture (Butterchurn) measures each moment against the song's own running average, so simply turning the sound up
 * changes nothing it does. What changes it is the *swing*: `now / usual` is how this moment compares with the last few
 * seconds, and raising that to a power stretches or flattens it. At 100% the sound passes as it is; above, loud moments
 * are pushed up and quiet ones down; below, they are pulled together and the whole is turned down, to nothing at 0.
 */
export function reactGain(react: number, now: number, usual: number): number {
  if (react <= 0) return 0;
  const strength = react / 100;
  const swing = usual > SILENCE && now > 0 ? Math.min(4, Math.max(0.2, Math.pow(now / usual, strength - 1))) : 1;
  const level = strength <= 1 ? strength : 1 + (strength - 1) * 0.5;
  return swing * level;
}

/** A frame of sound multiplied about its rest (128) into `out`, kept inside a byte. */
export function shapeSound(bytes: Uint8Array, out: Uint8Array, gain: number): void {
  for (let index = 0; index < bytes.length; index += 1) {
    const shaped = 128 + (bytes[index] - 128) * gain;
    out[index] = shaped < 0 ? 0 : shaped > 255 ? 255 : shaped;
  }
}

/** The usual loudness, moved a little toward this frame's: about three seconds of memory at sixty frames a second. */
export function usualLoudness(usual: number, now: number): number {
  return usual <= 0 ? now : usual * 0.99 + now * 0.01;
}

/** The level as eight squares, for a reader who wants to see that it hears: `■■■·····`. A whisper still lights one. */
export function levelMeter(level: number): string {
  const lit = level <= SILENCE ? 0 : Math.min(8, Math.max(1, Math.round(Math.sqrt(Math.min(1, level * 2.5)) * 8)));
  return '■'.repeat(lit) + '·'.repeat(8 - lit);
}

/**
 * How many drawn pixels the picture gets for each pixel of its box. A computer: the screen's own density, two at most.
 * A phone is shown the 1280px desktop fitted to its width (app/layout.tsx), so its box is drawn at a third of its size:
 * the picture is then drawn only as large as the phone really shows it, which is several times less work for the same
 * sharpness (found on 2026-11-14: at full size a phone-sized run drew about two frames a second).
 */
export function pictureScale(density: number, screenWidth: number, pageWidth: number): number {
  const dense = Number.isFinite(density) && density > 0 ? density : 1;
  const fitted = screenWidth > 0 && pageWidth > 0 ? Math.min(1, screenWidth / pageWidth) : 1;
  return Math.min(2, Math.max(0.5, dense * fitted));
}

/** The line that says, honestly, what it is doing about the sound. */
export function hearingNote(hearing: 'starting' | 'listening' | 'own-rhythm' | 'unsupported', deaf: 'player' | 'browser' | 'host' | null, still: boolean): string {
  if (hearing === 'unsupported') return "THIS BROWSER CAN'T DRAW THE VISUALISER";
  if (hearing === 'starting') return 'STARTING...';
  const motion = still ? 'A STILL PICTURE (REDUCE MOTION IS ON)' : 'MOVING ON ITS OWN';
  if (hearing === 'listening') return still ? `LISTENING · ${motion}` : 'LISTENING';
  if (deaf === 'browser') return `THIS BROWSER CAN'T LEND IT THE SOUND: ${motion}`;
  if (deaf === 'host') return `THIS SONG'S HOST KEEPS ITS SOUND TO ITSELF: ${motion}`;
  if (deaf === 'player') return `THIS PLAYER KEEPS ITS SOUND TO ITSELF: ${motion}`;
  // Nothing in the way, and nothing loaded yet to hear.
  return `WAITING FOR A SONG: ${motion}`;
}
