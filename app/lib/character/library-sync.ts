'use client';

import { USING_MOCK_AUTH } from '../auth/auth-repository';
import { getSupabaseBrowserClient } from '../supabase/client';
import { readFigure } from './figure';
import { mergeShelf, readLibrary, setLibraryHook, setLibraryViewer, writeSyncedShelf, type ShelfRow, type SavedCharacter } from './library';

/**
 * Saved characters on the account as well as in the browser (`user_characters`, Luke 2026-11-06). Signing in brings the two together:
 * whatever this browser holds goes up, which is how somebody back after the accounts were lost gets theirs saved, and whatever the account
 * holds comes down, which is how they follow a person to another machine. With no database (the mock accounts) the browser is the store.
 */

let account: string | null = null;
/** Which characters the account is known to hold, so a save or a removal only sends what changed. */
let known = new Set<string>();
let failed = false;
const failureListeners = new Set<() => void>();

function setFailed(value: boolean): void {
  if (failed === value) return;
  failed = value;
  failureListeners.forEach((listener) => listener());
}

export const charactersSaveFailed = (): boolean => failed;
export const serverCharactersSaveFailed = (): boolean => false;
export function subscribeToCharactersSaveFailed(listener: () => void): () => void {
  failureListeners.add(listener);
  return () => failureListeners.delete(listener);
}

const toRow = (person: string, character: SavedCharacter) => ({
  person,
  id: character.id,
  name: character.name,
  preset_id: character.presetId,
  figure: character.figure,
  saved_at: character.savedAt,
  deleted_at: null,
});

async function send(person: string, upload: readonly SavedCharacter[], removed: readonly string[]): Promise<void> {
  const client = getSupabaseBrowserClient();
  if (client === null) return;
  try {
    if (upload.length > 0) {
      const { error } = await client.from('user_characters').upsert(upload.map((character) => toRow(person, character)));
      if (error) throw error;
    }
    if (removed.length > 0) {
      const { error } = await client.from('user_characters').update({ deleted_at: new Date().toISOString() }).eq('person', person).in('id', [...removed]);
      if (error) throw error;
    }
    setFailed(false);
  } catch {
    // Kept in this browser. The next sign-in sends whatever the account is missing.
    setFailed(true);
  }
}

/**
 * Make sure one character is on the account now, not on the next sync: the profile can only show a character the account
 * holds (`profile_characters_guard`), and a save sends it up in the background. Nothing to do with the mock accounts.
 */
export async function ensureCharacterOnAccount(person: string, character: SavedCharacter): Promise<void> {
  if (USING_MOCK_AUTH) return;
  const client = getSupabaseBrowserClient();
  if (client === null) return;
  const { error } = await client.from('user_characters').upsert(toRow(person, character));
  if (error) throw new Error('COULD NOT SAVE THE CHARACTER TO YOUR ACCOUNT');
  known.add(character.id);
}

/** Who is signed in, from the saved-characters window. Null: nobody, or a guest. */
export async function syncCharacters(person: string | null): Promise<void> {
  if (person === account) return;
  account = person;
  known = new Set();
  setFailed(false);
  setLibraryViewer(person);
  if (person === null || USING_MOCK_AUTH) return;
  const client = getSupabaseBrowserClient();
  if (client === null) return;
  try {
    const { data: session } = await client.auth.getSession();
    // A guest has no account to keep anything on.
    if (session.session?.user.is_anonymous === true) {
      account = null;
      setLibraryViewer(null);
      return;
    }
    const { data, error } = await client.from('user_characters').select('id, name, preset_id, figure, saved_at, deleted_at').eq('person', person).limit(400);
    if (error) throw error;
    if (account !== person) return;
    const rows: ShelfRow[] = (data ?? []).flatMap((row) => {
      const figure = readFigure(row.figure);
      return figure === null ? [] : [{ id: row.id as string, name: row.name as string, presetId: row.preset_id as string, figure, savedAt: row.saved_at as string, deletedAt: (row.deleted_at as string | null) ?? null }];
    });
    const { shelf, upload } = mergeShelf(readLibrary(), rows);
    writeSyncedShelf(shelf);
    known = new Set(shelf.map((character) => character.id));
    await send(person, upload, []);
  } catch {
    setFailed(true);
  }
}

setLibraryHook((next) => {
  const person = account;
  if (person === null || USING_MOCK_AUTH) return;
  const ids = new Set(next.map((character) => character.id));
  const removed = [...known].filter((id) => !ids.has(id));
  const upload = next.filter((character) => !known.has(character.id));
  known = ids;
  void send(person, upload, removed);
});
