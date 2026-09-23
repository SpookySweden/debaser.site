'use client';

import Link from 'next/link';
import { audioTagColour, audioTagKey, audioTagLabel } from '../lib/audio/tags';
import type { ForumTag } from '../lib/forum/types';
import { TagMark, tagChipClasses, tagMarkColour } from './TagBadge';

/**
 * An audio tag, worn as the site's own chip.
 *
 * A track's tags are the same chips a post's tags are - same shape, same colour
 * rule, same square bevel - because they are the same kind of thing: a word
 * somebody put on a file so it can be found again. The only difference is what
 * pressing one does, and that is the caller's choice: on a player inside a thread
 * a pill is a link into the filtered directory, and on the directory's filter bar
 * it is the filter itself.
 */

/** The chip record a label is drawn as: the same shape the board uses. */
function asChip(label: string): ForumTag {
  return {
    id: `audio-${audioTagKey(label)}`,
    kind: 'user',
    label: audioTagLabel(label),
    colour: audioTagColour(label),
  };
}

/** Where a tag badge leads: the directory, already filtered to it. */
export function audioTagHref(label: string): string {
  return `/music?tag=${encodeURIComponent(audioTagKey(label))}`;
}

type AudioTagPillProps = {
  tag: string;
  /** Given by the filter bar: the pill toggles the filter instead of linking to it. */
  onToggle?: (key: string) => void;
  /** True while this tag is the filter in force. */
  active?: boolean;
  /** How many files wear it, shown by the filter bar. */
  count?: number;
  compact?: boolean;
};

export default function AudioTagPill({ tag, onToggle, active = false, count, compact = false }: AudioTagPillProps) {
  const label = audioTagLabel(tag);
  const mark = tagMarkColour(asChip(tag));
  const className = `${tagChipClasses(asChip(tag), compact)} ${
    active ? 'outline-2 outline-black' : 'hover:bg-gray-200'
  }`;

  if (onToggle === undefined) {
    return (
      <Link href={audioTagHref(tag)} title={`Show every track tagged ${label}`} className={className}>
        <TagMark colour={mark} compact={compact} />
        {label}
        {count === undefined || count === 0 ? null : ` (${count})`}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onToggle(audioTagKey(tag))}
      aria-pressed={active}
      title={active ? `Stop filtering by ${label}` : `Filter by ${label}`}
      className={`cursor-pointer ${className}`}
    >
      <TagMark colour={mark} compact={compact} />
      {label}
      {count === undefined || count === 0 ? null : ` (${count})`}
    </button>
  );
}
