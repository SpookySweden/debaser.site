'use client';

/** The notes on the page in front: everybody's when they are on the site, this browser's own until then. */
import { addSharedNote, deleteSharedNote, notesOnPage, ON_THE_ACCOUNT, type SharedNote } from './account';
import { notesOn, withNote, withoutNote, type Margin } from './margins';
import { changeMargins, margins, subscribeToMargins } from './margins-store';

export type NotesState = { page: string | null; notes: readonly SharedNote[] };
const NONE: NotesState = { page: null, notes: [] };
let held: NotesState = NONE;
const listeners = new Set<() => void>();
const set = (next: NotesState): void => {
  held = next;
  for (const listener of listeners) listener();
};
export const notesState = (): NotesState => held;
export const notesStateOnServer = (): NotesState => NONE;
export function subscribeToNotes(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

const own = (page: string, owner: { id: string; label: string }): SharedNote[] => notesOn(margins(), page).map((note) => ({ ...note, ownerId: owner.id, ownerLabel: owner.label }));

/** Read again for each page opened; in this browser, again when another tab of the site writes one. */
export function openNotesOn(page: string | null, owner: { id: string; label: string }): () => void {
  if (page === null) {
    set(NONE);
    return () => undefined;
  }
  if (!ON_THE_ACCOUNT) {
    set({ page, notes: own(page, owner) });
    return subscribeToMargins(() => set({ page, notes: own(page, owner) }));
  }
  set({ page, notes: [] });
  let gone = false;
  void notesOnPage(page)
    .catch(() => [])
    .then((notes) => {
      if (!gone && held.page === page) set({ page, notes });
    });
  return () => {
    gone = true;
  };
}

export async function addNote(note: Margin, owner: { id: string; label: string }): Promise<boolean> {
  if (!ON_THE_ACCOUNT) {
    changeMargins((all) => withNote(all, note));
    return true;
  }
  if (!(await addSharedNote(note).catch(() => false))) return false;
  if (held.page === note.page) set({ ...held, notes: [{ ...note, ownerId: owner.id, ownerLabel: owner.label }, ...held.notes] });
  return true;
}

export async function deleteNote(id: string): Promise<boolean> {
  if (!ON_THE_ACCOUNT) {
    changeMargins((all) => withoutNote(all, id));
    return true;
  }
  if (!(await deleteSharedNote(id).catch(() => false))) return false;
  set({ ...held, notes: held.notes.filter((each) => each.id !== id) });
  return true;
}
