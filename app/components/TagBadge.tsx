import Link from 'next/link';
import { tagColour, tagKey } from '../lib/forum/tag-vocabulary';
import type { ForumTag } from '../lib/forum/types';
import { markColour } from '../lib/ui/colour';

/**
 * Retro tag chips.
 *
 * A tag is a neutral bevelled chip with a small colour **key** in front of its label - the way a list
 * box of this era marked a category - rather than a chip painted wall-to-wall in its colour. Three
 * things come out of that one decision: a board full of tags reads as one board instead of a bag of
 * sweets, the same tag is still the same colour everywhere it appears (the key is the colour, so
 * DESIGN is DESIGN on a post, in the chooser and on a profile), and a colour nobody would have chosen
 * as a *fill* still works as a mark - which is what lets the picker offer sixteen hues without
 * shouting.
 *
 * The project's hard rule is 0px border-radius, so these are square-edged bevelled chips (the Win95
 * tag look), never rounded capsules - `rounded-none` is explicit on purpose.
 */

const CHIP_BASE =
  'inline-flex items-center gap-1 rounded-none border px-1.5 py-[1px] text-[10px] font-bold uppercase tracking-[0.02em]';

/**
 * The chip itself. The coloured kinds wear the site's raised grey; `source` is the retired
 * housekeeping tag and stays inset, which is how a reader can still tell the two apart at a glance.
 */
const KIND_CLASSES: Record<ForumTag['kind'], string> = {
  user: 'bg-[#e8e8e8] text-black border-t-white border-l-white border-r-[#808080] border-b-[#808080]',
  category: 'bg-[#e8e8e8] text-black border-t-white border-l-white border-r-[#808080] border-b-[#808080]',
  content: 'bg-[#e8e8e8] text-black border-t-white border-l-white border-r-[#808080] border-b-[#808080]',
  source: 'bg-[#f0f0f0] text-black border-t-[#808080] border-l-[#808080] border-r-white border-b-white',
};

/** Smaller chip for dense rows (post meta lines, left-hand columns). */
const CHIP_COMPACT = 'gap-[3px] px-1 py-0 text-[9px] tracking-0';

/** Shared chip styling, so the chooser and the badges look identical. */
export function tagChipClasses(tag: ForumTag, compact = false): string {
  return `${CHIP_BASE} ${KIND_CLASSES[tag.kind]}${compact ? ` ${CHIP_COMPACT}` : ''}`;
}

/** The key: a small square of the tag's colour, at the weight a mark wears. */
export function TagMark({ colour, compact = false }: { colour: string | undefined; compact?: boolean }) {
  if (colour === undefined) return null;

  return (
    <span
      aria-hidden="true"
      className={`${compact ? 'h-[6px] w-[6px]' : 'h-[8px] w-[8px]'} shrink-0 border border-[#404040]`}
      style={{ backgroundColor: colour }}
    />
  );
}

/**
 * The colour a tag's key wears: the colour chosen for the label, else the one its label hashes to,
 * at the weight a mark wears. Undefined for the retired housekeeping tags, which carry no colour.
 */
export function tagMarkColour(tag: ForumTag): string | undefined {
  if (tag.kind === 'source') return undefined;

  return markColour(tag.colour ?? tagColour(tag.label));
}

/** The same, straight from a colour: what the pickers preview before a tag exists. */
export function tagMarkColourFromColour(colour: string): string {
  return markColour(colour);
}

type TagBadgeProps = {
  tag: ForumTag;
  /** Optional usage count, shown by the chooser. */
  count?: number;
  /** Smaller chip for dense rows. */
  compact?: boolean;
};

export default function TagBadge({ tag, count, compact = false }: TagBadgeProps) {
  return (
    <Link
      href={`/forum#tag-${tagKey(tag.label)}`}
      title={`Show every post tagged ${tag.label}`}
      className={`${tagChipClasses(tag, compact)} hover:bg-gray-200`}
    >
      <TagMark colour={tagMarkColour(tag)} compact={compact} />
      {tag.label}
      {count === undefined || count === 0 ? null : ` (${count})`}
    </Link>
  );
}

type TagRowProps = {
  tags: ForumTag[];
  className?: string;
  emptyLabel?: string;
  /** Smaller chips. */
  compact?: boolean;
  /** Show only the first N tags, with a "+N" marker for the rest. */
  limit?: number;
};

export function TagRow({ tags, className, emptyLabel, compact = false, limit }: TagRowProps) {
  if (tags.length === 0) {
    return emptyLabel === undefined ? null : (
      <span className="text-[10px] text-gray-700">{emptyLabel}</span>
    );
  }

  const shown = limit === undefined ? tags : tags.slice(0, limit);
  const hidden = tags.length - shown.length;

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className ?? ''}`}>
      {shown.map((tag) => (
        <TagBadge key={tag.id} tag={tag} compact={compact} />
      ))}
      {hidden > 0 ? <span className="text-[9px] font-bold text-gray-700">+{hidden}</span> : null}
    </div>
  );
}
