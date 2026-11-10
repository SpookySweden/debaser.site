import { createWindowSlot } from '../ui/window-slot';

/**
 * The reader (SPEC-books.md): which book is open and where. Drawn once in `layout.tsx` (./components/BookReader.tsx), over
 * whatever page it was opened from. `?read=<ref>&at=<paragraph>` on any page opens it there.
 */
export type ReaderState = { open: boolean; bookRef: string | null; title: string; at: number | null };

const CLOSED: ReaderState = { open: false, bookRef: null, title: '', at: null };
const slot = createWindowSlot<ReaderState>(CLOSED);

export const readerState = slot.state;
export const subscribeToReader = slot.subscribe;

export function openReader(bookRef: string, title: string, at: number | null = null): void {
  slot.set({ open: true, bookRef, title, at });
}

export function closeReader(): void {
  if (readerState().open) slot.set(CLOSED);
}

/** A Gutenberg book the reader can open: its MEDIA ref carries a Gutenberg number. */
export function isReadable(bookRef: string): boolean {
  return /^books:OL[1-9][0-9]{0,11}W-pg[1-9][0-9]{0,6}$/.test(bookRef);
}

export function readerFromSearch(search: string): { bookRef: string; at: number | null } | null {
  const params = new URLSearchParams(search);
  const ref = params.get('read');
  if (ref === null || !isReadable(ref)) return null;
  const at = Number(params.get('at'));
  return { bookRef: ref, at: Number.isInteger(at) && at >= 0 && at <= 1_000_000 ? at : null };
}
