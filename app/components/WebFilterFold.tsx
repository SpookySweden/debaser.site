'use client';

import type { ReactNode } from 'react';
import { KEY_FOCUS, PLATE_LARGE } from '../lib/ui/controls';

/**
 * MEDIA's FILTERS panel pieces (Luke, 2026-11-13: "expandable, organised and much clearer"; 2026-11-14: "more space
 * efficient, showing all the selectable filters organised but not needing so many clicks").
 *
 * The panel folds as one (`[ + FILTERS ]` in WebStream.tsx); inside it every filter is one labelled row of keys, all
 * visible at once, so a choice is one press after opening. The keys are the site's largest.
 */

/** A heading key: the bracket key at the title size, a thumb tall at every width. */
export const FOLD_KEY = `key inline-flex min-h-tap cursor-pointer items-center px-1.5 py-1.5 text-title ${KEY_FOCUS} active:animate-flash active:translate-y-press active:bg-bubble active:text-ink-plate`;
/** A choice in a row: the largest bracket key. */
export const FILTER_KEY = PLATE_LARGE;
/** The choice that is on: a filled pill in the field ink, the same box as `FILTER_KEY` (its 2px outline is the rest of the padding). */
export const FILTER_KEY_ON = `key key-fill key-on [--key-fill:var(--color-ink)] px-1 py-1 text-key text-paper max-sm:min-h-tap max-sm:px-1 max-sm:py-2 max-sm:text-base`;

/** One filter: its name on the left, every choice beside it, wrapping as the page narrows. */
export function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="rule-pixel flex flex-wrap items-center gap-x-2 gap-y-1 py-1" data-filter-row={label}>
      <span className="w-36 shrink-0 text-key text-ink-quiet max-sm:w-full">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}
