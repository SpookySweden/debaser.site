'use client';

import { useEffect, useState } from 'react';

/** How often a clock-reading component is redrawn: the finest step a label can show, halved. */
export const CLOCK_TICK_MS = 30_000;

/**
 * The clock, for the parts of a page that say how long ago something was.
 *
 * A relative label is only true for a moment: "4 MINUTES AGO" has to become "5 MINUTES AGO" on its
 * own, or it is a stamp with a friendlier face. So a component that prints one reads the clock from
 * here and is redrawn when it moves - the same shape as the presence provider's own tick
 * (`lib/profile/presence.ts`), and for the same reason.
 *
 * The first value comes from the same `Date.now()` on the server and in the browser, and the label is
 * minute-resolution, so the two agree unless a request crosses a minute boundary - which is what the
 * `suppressHydrationWarning` on the one text node is for. Reading the clock into state rather than
 * during render is also what keeps a redraw from happening for a value that did not change: React
 * bails out when the number is the same.
 */
export function useNow(intervalMs: number = CLOCK_TICK_MS): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);

    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}
