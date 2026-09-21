import type { ForumTag } from '../lib/forum/types';

/**
 * Retro "pill" badges.
 *
 * Note: the project hard rule is 0px border-radius on every element, so these
 * pills are square-edged bevelled chips (Win95 tag look) instead of rounded
 * capsules - `rounded-none` is explicit on purpose.
 */
const KIND_CLASSES: Record<ForumTag['kind'], string> = {
  category: 'bg-[#000080] text-white border-t-white border-l-white border-r-[#404040] border-b-[#404040]',
  content: 'bg-[#c0c0c0] text-black border-t-white border-l-white border-r-[#808080] border-b-[#808080]',
  source: 'bg-[#f0f0f0] text-black border-t-[#808080] border-l-[#808080] border-r-white border-b-white',
};

export default function TagBadge({ tag }: { tag: ForumTag }) {
  return (
    <span
      title={`auto tag: ${tag.kind}`}
      className={`inline-flex items-center rounded-none border px-2 py-[2px] text-[10px] font-bold uppercase tracking-[0.08em] ${KIND_CLASSES[tag.kind]}`}
    >
      {tag.label}
    </span>
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
