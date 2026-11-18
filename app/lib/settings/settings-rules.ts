import { SYNCED_KEYS, SYNCED_NAMES, type SyncedName } from './settings-bus';

/**
 * The plain rules of settings that follow the account (SPEC-forum-v3.md, F1B, F2A and M1A), kept apart from the browser and
 * the database so `Temp/check-account-settings.cjs` asks them the same questions the site does.
 *
 * What `user_settings.settings` holds: `keys`, the browser's own stored value for each synced setting, as the text it is
 * stored as (each setting's own code already reads that text defensively, so a junk value falls back to its default), and
 * `made`, the five POST WHAT I MAKE TO THE BOARD switches.
 */

export type MadeKind = 'drawings' | 'characters' | 'files' | 'tracks' | 'letters';

export const MADE_KINDS: readonly { kind: MadeKind; label: string; line: string }[] = [
  { kind: 'drawings', label: 'DRAWINGS', line: 'A DRAWING YOU PUT ON THE ART SHELF' },
  { kind: 'characters', label: 'CHARACTERS', line: 'A CHARACTER YOU SHOW ON YOUR PROFILE' },
  { kind: 'files', label: 'FILES', line: 'A FILE YOU ADD TO /FILES' },
  { kind: 'tracks', label: 'TRACKS', line: 'A TRACK YOU PUT ON THE MUSIC SHELF' },
  { kind: 'letters', label: 'PUBLIC LETTERS', line: 'A LETTER YOU MAKE PUBLIC' },
];

export type MadeSwitches = Record<MadeKind, boolean>;

/** Every switch on by default (M1A: "on by default for things that are already public"). */
export const DEFAULT_MADE: MadeSwitches = { drawings: true, characters: true, files: true, tracks: true, letters: true };

export type SyncedValues = Partial<Record<SyncedName, string>>;

export type AccountSettings = { keys: SyncedValues; made: MadeSwitches };

/** One setting's stored text longer than this is not a choice, it is junk: left out. */
export const MAX_VALUE_LENGTH = 1500;

/** The whole row stays well under the table's 8 KB check. */
export const MAX_SETTINGS_LENGTH = 6000;

/** A row as the database or the mock holds it, read defensively: anything unrecognised is dropped, a missing switch is on. */
export function parseAccountSettings(raw: unknown): AccountSettings {
  const keys: SyncedValues = {};
  const made: MadeSwitches = { ...DEFAULT_MADE };
  if (typeof raw !== 'object' || raw === null) return { keys, made };
  const row = raw as { keys?: unknown; made?: unknown };

  if (typeof row.keys === 'object' && row.keys !== null) {
    for (const name of SYNCED_NAMES) {
      const value = (row.keys as Record<string, unknown>)[name];
      if (typeof value === 'string' && value.length <= MAX_VALUE_LENGTH) keys[name] = value;
    }
  }
  if (typeof row.made === 'object' && row.made !== null) {
    for (const { kind } of MADE_KINDS) {
      if ((row.made as Record<string, unknown>)[kind] === false) made[kind] = false;
    }
  }
  return { keys, made };
}

/**
 * What is saved: the settings in a fixed order, so the same choices are always the same text (a save that changes nothing
 * is skipped by comparing it). Over the size cap, the last settings in the list are left out until it fits.
 */
export function settingsForSaving(settings: AccountSettings): { keys: SyncedValues; made: MadeSwitches } {
  const keys: SyncedValues = {};
  for (const name of SYNCED_NAMES) {
    const value = settings.keys[name];
    if (typeof value === 'string' && value.length <= MAX_VALUE_LENGTH) keys[name] = value;
  }
  const made: MadeSwitches = { ...DEFAULT_MADE };
  for (const { kind } of MADE_KINDS) made[kind] = settings.made[kind] !== false;
  const body = { keys, made };
  const names = Object.keys(keys) as SyncedName[];
  while (JSON.stringify(body).length > MAX_SETTINGS_LENGTH && names.length > 0) {
    delete keys[names.pop() as SyncedName];
  }
  return body;
}

/**
 * On sign-in (F2A): the account's choices win, except a setting the reader changed while the account was still being read
 * (their press is newer). A setting the account has never saved keeps the browser's value, so a first sign-in after this
 * ships wipes nobody's look.
 */
export function valuesAfterSignIn(account: SyncedValues, browser: SyncedValues, changedMeanwhile: ReadonlySet<SyncedName>): SyncedValues {
  const out: SyncedValues = { ...browser };
  for (const name of SYNCED_NAMES) {
    const value = account[name];
    if (value !== undefined && !changedMeanwhile.has(name)) out[name] = value;
  }
  return out;
}

/** The storage key of each synced setting, for code that writes the browser's copy. */
export function storageKeyOf(name: SyncedName): string {
  return SYNCED_KEYS[name];
}

/* Read marks ------------------------------------------------------------------------------------------------------- */

const LOOKS_LIKE_AN_INSTANT = /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/;

/** How many marks the account keeps: the same few hundred the browser keeps (`../forum/read-state.ts`). */
export const MAX_ACCOUNT_MARKS = 300;

/** `user_settings.read_marks`, read defensively: only post id -> instant survives. */
export function parseReadMarks(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const [id, at] of Object.entries(raw as Record<string, unknown>)) {
    if (id.length === 0 || id.length > 200 || typeof at !== 'string' || !LOOKS_LIKE_AN_INSTANT.test(at)) continue;
    out[id] = at;
  }
  return out;
}

const instant = (value: string): number => {
  const parsed = Date.parse(value.includes(' ') ? value.replace(' ', 'T') : value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

/**
 * Two machines' marks as one (F1B): for each post the later opening wins, so NEW goes quiet on both once it was opened on
 * either. The newest `max` are kept, the oldest go first.
 */
export function mergeReadMarks(left: Record<string, string>, right: Record<string, string>, max = MAX_ACCOUNT_MARKS): Record<string, string> {
  const merged: Record<string, string> = { ...left };
  for (const [id, at] of Object.entries(right)) {
    const held = merged[id];
    if (held === undefined || instant(at) > instant(held)) merged[id] = at;
  }
  const entries = Object.entries(merged);
  if (entries.length <= max) return merged;
  return Object.fromEntries(entries.sort((a, b) => instant(b[1]) - instant(a[1])).slice(0, max));
}

/** Whether two sets of marks say the same thing (a save that would change nothing is skipped). */
export function sameMarks(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftIds = Object.keys(left);
  if (leftIds.length !== Object.keys(right).length) return false;
  return leftIds.every((id) => right[id] === left[id]);
}
