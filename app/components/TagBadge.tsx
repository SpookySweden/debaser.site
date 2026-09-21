import Link from 'next/link';
import type { CSSProperties } from 'react';
import { tagColour, tagKey } from '../lib/forum/tag-vocabulary';
import type { ForumTag } from '../lib/forum/types';

/**
 * Retro "pill" badges.
 *
 * User picks are colour coded: the colour is derived from the tag's canonical
 * key, so the same tag - or a decidedly similar spelling of it - is always the
 * same colour. Automatic tags keep their fixed system styling so the two kinds
 * never look alike. Every badge links to the board filtered by that tag.
 *
 * Note: the project hard rule is 0px border-radius on every element, so these
 * pills are square-edged bevelled chips (Win95 tag look) instead of rounded
 * capsules - `rounded-none` is explicit on purpose.
 */
const KIND_CLASSES: Record<ForumTag['kind'], string> = {
  user: 'text-[#101010] border-t-white border-l-white border-r-[#707070] border-b-[#707070]',
  category: 'bg-[#000080] text-white border-t-white border-l-white border-r-[#404040] border-b-[#404040]',
  content: 'bg-[#c0c0c0] text-black border-t-white border-l-white border-r-[#808080] border-b-[#808080]',
  source: 'bg-[#f0f0f0] text-black border-t-[#808080] border-l-[#808080] border-r-white border-b-white',
};

const CHIP_BASE =
  'inline-flex items-center rounded-none border px-2 py-[2px] text-[10px] font-bold uppercase tracking-[0.08em]';

/** Shared chip styling, so the chooser and the badges look identical. */
export function tagChipClasses(tag: ForumTag): string {
  return `${CHIP_BASE} ${KIND_CLASSES[tag.kind]}`;
}

/** Coloured background for user tags; system tags stay grey/navy. */
export function tagChipStyle(tag: ForumTag): CSSProperties | undefined {
  return tag.kind === 'user' ? { backgroundColor: tag.colour ?? tagColour(tag.label) } : undefined;
}

/** Same chip background, straight from a colour (used by the picker). */
export function tagChipStyleFromColour(colour: string): CSSProperties {
  return { backgroundColor: colour };
}

type TagBadgeProps = {
  tag: ForumTag;
  /** Optional usage count, shown by the chooser. */
  count?: number;
};

export default function TagBadge({ tag, count }: TagBadgeProps) {
  return (
    <Link
      href={`/forum#tag-${tagKey(tag.label)}`}
      title={`Show every post tagged ${tag.label}`}
      className={`${tagChipClasses(tag)} hover:opacity-90`}
      style={tagChipStyle(tag)}
    >
      {tag.label}
      {count === undefined || count === 0 ? null : ` (${count})`}
    </Link>
  );
}

type TagRowProps = {
  tags: ForumTag[];
  className?: string;
  emptyLabel?: string;
};

export function TagRow({ tags, className, emptyLabel }: TagRowProps) {
  if (tags.length === 0) {
    return emptyLabel === undefined ? null : (
      <span className="text-[10px] text-gray-700">{emptyLabel}</span>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className ?? ''}`}>
      {tags.map((tag) => (
        <TagBadge key={tag.id} tag={tag} />
      ))}
    </div>
  );
}
