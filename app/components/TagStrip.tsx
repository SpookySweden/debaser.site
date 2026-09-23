'use client';

import { useState } from 'react';
import type { ForumTag } from '../lib/forum/types';
import { TagLink } from './TagBadge';

type TagStripProps = {
  tags: ForumTag[];
  /** How many tokens before the rest fold behind `[+n]`; all of them when it is left out. */
  limit?: number;
  className?: string;
  /** Drawn in place of the strip when there is nothing to show (the open post's tag column). */
  emptyLabel?: string;
};

/**
 * The tags of a post or a reply, as a list rather than a row of chips.
 *
 * What this replaces cost three lines for six tags: each one a bevelled button with a border, a key
 * and a label. A tag list is not a row of buttons - it is a list - and a list of `theme:design`
 * tokens reads in one line (see `TagLink` in ./TagBadge.tsx), which is most of the space tagging was
 * taking from the board.
 *
 * The fold is the other half of it. The handful of tags that say what a post is *about* is what a
 * reader needs on a collapsed row; the rest sit behind `[+3]` until somebody asks for them, and
 * `[-]` puts them back. Nothing is hidden from a screen reader in the meantime: the fold draws a
 * shorter list, it does not hide one behind a tooltip.
 */
export default function TagStrip({ tags, limit, className, emptyLabel }: TagStripProps) {
  const [open, setOpen] = useState(false);

  if (tags.length === 0) {
    if (emptyLabel === undefined) return null;

    return <p className={`text-[10px] font-bold text-gray-700 ${className ?? ''}`}>{emptyLabel}</p>;
  }

  const folds = limit !== undefined && limit < tags.length;
  const shown = folds && !open ? tags.slice(0, limit) : tags;
  const hidden = tags.length - shown.length;

  return (
    <p
      className={`flex flex-wrap items-center gap-x-[10px] gap-y-[3px] text-[10px] leading-none text-black ${className ?? ''}`}
    >
      {shown.map((tag) => (
        <TagLink key={tag.id} tag={tag} />
      ))}

      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Show the rest of the tags"
          className="cursor-pointer font-bold text-gray-700 hover:underline"
        >
          {`[+${hidden}]`}
        </button>
      ) : null}

      {folds && open ? (
        <button
          type="button"
          onClick={() => setOpen(false)}
          title="Fold the tags back to one line"
          className="cursor-pointer font-bold text-gray-700 hover:underline"
        >
          [-]
        </button>
      ) : null}
    </p>
  );
}