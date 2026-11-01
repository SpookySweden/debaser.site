'use client';

import { relativeShort } from '../lib/ui/relative-time';
import { useNow } from '../lib/ui/use-now';

type RelativeShortProps = {
  /** The stored ISO instant; missing or unreadable prints as `--`. */
  at: string | null | undefined;
};

/**
 * How long ago, in one character: `22s`, `5m`, `3h`, `4d`, `2w`, `6m`, `1y`.
 *
 * For a column of accounts, where the words would be the widest thing on the row and the least of what
 * it says. The ladder is `relativeShort`'s and is the same one the long form walks, so a reading cannot
 * be `45m` here and `1 HOUR AGO` there.
 *
 * Client-side because it ages: the clock comes from `useNow`, so `22s` becomes `23s` on its own
 * instead of freezing at whatever the server happened to say. `suppressHydrationWarning` covers the
 * one case where server and browser can disagree - a request that crosses a tick.
 */
export default function RelativeShort({ at }: RelativeShortProps) {
  const now = useNow();

  return <span suppressHydrationWarning>{relativeShort(at, now)}</span>;
}
