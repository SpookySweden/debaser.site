import { getSupabaseBrowserClient, isSupabaseConfigured } from '../supabase/client';
import { createMockProfileCharacterRepository } from './mock-profile-character-repository';
import type { CharacterSheet, Mood } from './sheet';
import { createSupabaseProfileCharacterRepository } from './supabase-profile-character-repository';

/**
 * The character a person shows on their profile (SPEC-profile-characters.md): which of their saved ones, its mood, and
 * its baked picture strip. Anyone may read it; only the owner changes it. With Supabase it is `profile_characters` and the
 * `profile-characters` picture folder; with the mock accounts it is this browser's storage, the strip as a data address.
 */
export type ShownCharacter = {
  person: string;
  characterId: string;
  mood: Mood;
  /** Where the strip is, ready for an `<img>`: a public picture address, or a data address in the mock. */
  stripUrl: string;
  sheet: CharacterSheet;
  bakedAt: string;
  /** Baked before the newer motions: it plays older ones in their place until its owner's browser bakes it again. */
  stale: boolean;
};

export type ProfileCharacterRepository = {
  getShown(person: string): Promise<ShownCharacter | null>;
  /** Show a character, with its freshly baked strip. Replaces whatever was shown, and the old strip goes. */
  show(person: string, input: { characterId: string; mood: Mood; strip: Blob; sheet: CharacterSheet }): Promise<ShownCharacter>;
  setMood(person: string, mood: Mood): Promise<void>;
  /** Show nothing. */
  hide(person: string): Promise<void>;
};

function readSource(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value.trim();
}

/** The table when profiles are on Supabase (or `NEXT_PUBLIC_PROFILE_CHARACTER_DATA_SOURCE=supabase`). */
const REQUESTED =
  readSource(process.env.NEXT_PUBLIC_PROFILE_CHARACTER_DATA_SOURCE) ?? readSource(process.env.NEXT_PUBLIC_PROFILE_DATA_SOURCE);

export const PROFILE_CHARACTER_DATA_SOURCE: 'mock' | 'supabase' = REQUESTED === 'supabase' && isSupabaseConfigured ? 'supabase' : 'mock';

let repository: ProfileCharacterRepository | null = null;

export function getProfileCharacterRepository(): ProfileCharacterRepository {
  if (repository) return repository;
  const client = PROFILE_CHARACTER_DATA_SOURCE === 'supabase' ? getSupabaseBrowserClient() : null;
  repository = client ? createSupabaseProfileCharacterRepository(client) : createMockProfileCharacterRepository();
  return repository;
}

/** Told when a person's shown character changes in this browser, so a profile behind the customiser redraws at once. */
const listeners = new Set<(person: string) => void>();

export function subscribeToShownCharacters(listener: (person: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function shownCharacterChanged(person: string): void {
  listeners.forEach((listener) => listener(person));
}
