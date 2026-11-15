/**
 * MEDIA keeps its place (Luke's list, 2026-11-14, M14: "make it so that the media tab retains the way it was when you
 * switch around tabs so it doesnt have to search for everything again").
 *
 * When the MEDIA page goes (the reader opens FORUM, STREAM, a profile...), it leaves what it was showing here: the rows,
 * each source's next page, the box, the view it was in, and how far down the page was scrolled. Coming back shows it
 * exactly as it was, at once, and asks nothing.
 *
 * **What counts as coming back.** The same address it left at, or plain `/media` (the MEDIA key on the top bar), which
 * then takes the kept address back. Any other address (a shared search link, a creator's name pressed elsewhere) is a new
 * search, and so is a reload: this lives in the page's memory only, never in storage or the database.
 *
 * **How long.** An hour from when it was left. A list older than that is searched again, so it never goes stale for good.
 * A search still waiting on a source when the page went is not kept (half a list is not "as it was").
 *
 * Generic over what is kept, so the page decides its own fields; pure apart from the clock.
 */

/** How long a kept page counts as "as it was". */
export const KEEP_MS = 60 * 60 * 1000;

export type Kept<S> = {
  /** The address's query string (no `?`) when the page went. */
  address: string;
  /** When the page went. */
  at: number;
  /** How far down the page was scrolled. */
  scroll: number;
  state: S;
};

let kept: Kept<unknown> | null = null;

/** The page going: what it showed, kept for its return. */
export function keepMedia<S>(entry: Kept<S>): void {
  kept = entry;
}

/** Forget it (a check, or a page that wants a fresh start). */
export function forgetMedia(): void {
  kept = null;
}

/**
 * What to show for an address the page opens at, or null to search afresh. `address` is the query string without `?`.
 * Taking it leaves it in place, so a page drawn twice (React's checks in development) finds it both times.
 */
export function keptFor<S>(address: string, now: number = Date.now()): Kept<S> | null {
  if (kept === null) return null;
  if (now - kept.at > KEEP_MS || now < kept.at) {
    kept = null;
    return null;
  }
  return address === '' || address === kept.address ? (kept as Kept<S>) : null;
}
