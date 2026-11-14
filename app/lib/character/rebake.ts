'use client';

import { findSavedCharacter } from './library';
import { accountCharacter } from './library-sync';
import { getProfileCharacterRepository, shownCharacterChanged, type ShownCharacter } from './profile-character-repository';

/**
 * Baking a shown character again when its strip was baked before the newer motions (Luke's OK, 2026-11-14: "Yes,
 * quietly"). Until then every missing motion plays as an older one (`sheet.ts`), so nothing is ever broken; this only
 * brings the new ones in.
 *
 * It is the same save as pressing SHOW, to the owner's own row and picture and nobody else's: the figure is read from
 * this browser's shelf (or, failing that, one row of the account's), baked here, and shown again with its mood kept.
 * Only ever in the owner's own browser, on a computer (`Companion.tsx` asks, a few seconds after the page settles).
 *
 * Careful not to nag: once a page load, never while another tab is at it, and after three failures for the same strip
 * (no WebGL, a figure that is gone) it stops asking until the strip changes. The old strip stays up throughout.
 */

const LOCK_KEY = 'debaser.character.rebake.v1';
/** Another tab's bake is left alone this long. */
const LOCK_MS = 120_000;
const MAX_FAILS = 3;

type Lock = { strip: string; at: number; fails: number };

/** What this page load has already tried: one go each. */
const tried = new Set<string>();

function readLock(): Lock | null {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(LOCK_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return null;
    const lock = raw as Record<string, unknown>;
    if (typeof lock.strip !== 'string' || typeof lock.at !== 'number' || typeof lock.fails !== 'number') return null;
    return { strip: lock.strip, at: lock.at, fails: lock.fails };
  } catch {
    return null;
  }
}

function writeLock(lock: Lock | null): void {
  try {
    if (lock === null) window.localStorage.removeItem(LOCK_KEY);
    else window.localStorage.setItem(LOCK_KEY, JSON.stringify(lock));
  } catch {
    // Storage off or full: this page load's own `tried` still holds it to one go.
  }
}

/** Whether to bake now, by what the lock says. */
function shouldRebake(lock: Lock | null, strip: string, now: number): boolean {
  if (lock === null || lock.strip !== strip) return true;
  if (lock.fails >= MAX_FAILS) return false;
  return now - lock.at >= LOCK_MS;
}

export async function rebakeShown(person: string, shown: ShownCharacter): Promise<'baked' | 'skipped' | 'failed'> {
  if (!shown.stale || shown.person !== person) return 'skipped';
  const strip = `${person}:${shown.bakedAt}`;
  if (tried.has(strip)) return 'skipped';
  tried.add(strip);
  const lock = readLock();
  const now = Date.now();
  if (!shouldRebake(lock, strip, now)) return 'skipped';
  const fails = lock !== null && lock.strip === strip ? lock.fails : 0;
  writeLock({ strip, at: now, fails });

  try {
    const character = findSavedCharacter(shown.characterId, person) ?? (await accountCharacter(person, shown.characterId));
    // The figure is nowhere to be read: it stays on the older motions, and isn't asked about again.
    if (character === null) {
      writeLock({ strip, at: now, fails: MAX_FAILS });
      return 'skipped';
    }
    const { bakeCharacter } = await import('./bake');
    const baked = await bakeCharacter(character.figure, character.presetId);
    await getProfileCharacterRepository().show(person, { characterId: shown.characterId, mood: shown.mood, strip: baked.strip, sheet: baked.sheet });
    writeLock(null);
    shownCharacterChanged(person);
    return 'baked';
  } catch {
    writeLock({ strip, at: now, fails: fails + 1 });
    return 'failed';
  }
}
