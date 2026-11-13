'use client';

import type { SavedCharacter } from './library';
import { ensureCharacterOnAccount } from './library-sync';
import { getProfileCharacterRepository, shownCharacterChanged } from './profile-character-repository';
import type { Mood } from './sheet';

/**
 * Showing a saved character on its owner's profile: bake every motion once in this browser, then save the strip and the
 * choice (SPEC-profile-characters.md). The baking code (and three with it) is fetched only now, when it is needed.
 */
export async function showOnProfile(person: string, character: SavedCharacter, mood: Mood): Promise<void> {
  await ensureCharacterOnAccount(person, character);
  const { bakeCharacter } = await import('./bake');
  const { strip, sheet } = await bakeCharacter(character.figure, character.presetId);
  await getProfileCharacterRepository().show(person, { characterId: character.id, mood, strip, sheet });
  shownCharacterChanged(person);
}

export async function setProfileMood(person: string, mood: Mood): Promise<void> {
  await getProfileCharacterRepository().setMood(person, mood);
  shownCharacterChanged(person);
}

export async function hideFromProfile(person: string): Promise<void> {
  await getProfileCharacterRepository().hide(person);
  shownCharacterChanged(person);
}

/**
 * Which saved character was last LOADed onto the bench. Saving the bench makes a new saved character, so when the one
 * loaded was the one on show, the new one takes its place on the profile and is baked again: changing its shapes changes
 * what visitors see.
 */
let loaded: string | null = null;
export const noteLoadedCharacter = (id: string | null): void => {
  loaded = id;
};
export const loadedCharacter = (): string | null => loaded;
