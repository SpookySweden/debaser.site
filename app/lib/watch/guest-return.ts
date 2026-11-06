/**
 * Logging in from the guest window: Google takes the browser away and brings it back to /account, so what somebody was about to say is kept in this tab
 * for a little while, and the room opens again with it (SPEC-guests.md).
 */

const KEY = 'debaser-guest-return';
const KEPT_MS = 15 * 60 * 1000;

type Kept = { roomId: string; draft: string; at: number };

function read(): Kept | null {
  try {
    const kept = JSON.parse(window.sessionStorage.getItem(KEY) ?? 'null') as Kept | null;
    if (kept === null || Date.now() - kept.at > KEPT_MS) return null;
    return kept;
  } catch {
    return null;
  }
}

export function keepGuestReturn(roomId: string, draft: string): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ roomId, draft, at: Date.now() }));
  } catch {
    // Without storage the words stay only in the box: nothing to do.
  }
}

export function forgetGuestReturn(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing was kept.
  }
}

/** The room to open again, without spending what was said. */
export function guestReturnRoom(): string | null {
  return read()?.roomId ?? null;
}

/** What this room's chat box starts with. */
export function guestReturnDraft(roomId: string): string {
  if (typeof window === 'undefined') return '';
  const kept = read();
  return kept === null || kept.roomId !== roomId ? '' : kept.draft;
}
