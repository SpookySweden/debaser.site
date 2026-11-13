'use client';

import type { ReactNode } from 'react';
import { KEY_FOCUS, PLATE_LARGE } from '../lib/ui/controls';

/**
 * One section of MEDIA's filter panel (Luke, 2026-11-13: "make it so that the search filters on the media page are
 * expandable, organised and much clearer"). A big heading key folds it open and shut; what is chosen in it is written
 * beside the heading, so a shut section still says where it stands. The keys inside are the site's largest key.
 *
 * Shut, its keys stay in the page (`hidden`), so a reader's place, the address and the box never depend on what is open.
 */

/** A heading key: the bracket key at the title size, a thumb tall at every width. */
export const FOLD_KEY = `key inline-flex min-h-tap cursor-pointer items-center px-1.5 py-1.5 text-title ${KEY_FOCUS} active:animate-flash active:translate-y-press active:bg-bubble active:text-ink-plate`;
/** A choice in a section: the largest bracket key. */
export const FILTER_KEY = PLATE_LARGE;
/** The choice that is on: a filled pill in the field ink, the same box as `FILTER_KEY` (its 2px outline is the rest of the padding). */
export const FILTER_KEY_ON = `key key-fill key-on [--key-fill:var(--color-ink)] px-1 py-1 text-key text-paper max-sm:min-h-tap max-sm:px-1 max-sm:py-2 max-sm:text-base`;

type Props = {
  /** The section's id: its panel is `<id>-panel`, and it is the name kept for which sections are open. */
  id: string;
  heading: string;
  /** What is chosen in it, in plain words: `ALL SOURCES`, `NEWEST FIRST`. */
  now: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
};

export default function WebFilterFold({ id, heading, now, open, onToggle, children }: Props) {
  return (
    <div className="rule-pixel py-1" data-filter-fold={id}>
      <div className="flex flex-wrap items-center gap-x-2">
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={`${id}-panel`} className={FOLD_KEY}>
          {`[ ${open ? '−' : '+'} ${heading} ]`}
        </button>
        <span className="text-key text-ink wrap-anywhere">{now}</span>
      </div>
      <div id={`${id}-panel`} role="group" aria-label={heading} hidden={!open} className="space-y-1 pt-1 pb-1 pl-2 max-sm:pl-0">
        {children}
      </div>
    </div>
  );
}
