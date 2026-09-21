import Image from 'next/image';
import Link from 'next/link';
import { resolveAnchorTarget } from '../lib/forum/anchors';
import type { ForumAnchor } from '../lib/forum/types';

type AnchorLinkProps = {
  anchor: ForumAnchor;
  /** Text in front of the label, e.g. `GO TO` or `BACK TO`. */
  prefix?: string;
  /**
   * 'hover' pops the item's drawing when the link itself is pointed at. 'none'
   * drops the popup, for a caller that already draws that same drawing - the
   * board card shows the sheet in its left column, so a preview would repeat it.
   */
  preview?: 'hover' | 'none';
};

/**
 * Link back to the item a thread belongs to.
 *
 * This is what replaced the old "Auto-filed from a site comment box." filler: a
 * post made from a comment box is really a comment *on* something, so it points
 * straight at it. Where that item is artwork, hovering the link pops a preview
 * of the drawing (pure CSS, so it works without any client state).
 *
 * The popup belongs to the link alone - its own named group - so pointing at the
 * post around it never pops a picture the reader did not ask for.
 */
export default function AnchorLink({ anchor, prefix = 'GO TO', preview = 'hover' }: AnchorLinkProps) {
  const target = resolveAnchorTarget(anchor);
  const label = `↳ ${prefix}: ${anchor.label}`;

  if (target.href.length === 0) {
    return <span className="text-[10px] font-bold text-black">{label} [ LINK PENDING ]</span>;
  }

  return (
    <span className="group/link relative inline-block">
      <Link
        href={target.href}
        title={`Open ${anchor.label} at ${target.href}`}
        className="rounded-none border border-black bg-[#c0c0c0] px-2 py-[2px] text-[10px] font-bold text-black underline hover:bg-gray-300"
      >
        {label}
      </Link>

      {preview === 'none' ? null : (
        <span className="pointer-events-none absolute left-0 top-full z-30 mt-1 hidden w-48 border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] p-1 group-hover/link:block">
          {target.preview === undefined ? (
            <span className="block border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-2 text-[10px] font-bold text-black">
              {anchor.kind.toUpperCase()} ITEM
              <br />
              OPENS: {target.href}
            </span>
          ) : (
            <span className="block">
              <Image
                src={target.preview.src}
                alt={target.preview.alt}
                width={target.preview.width}
                height={target.preview.height}
                className="h-auto w-full rounded-none border border-gray-600 bg-white"
              />
              <span className="mt-1 block bg-white px-1 py-[2px] text-[10px] font-bold text-black">
                PREVIEW // {anchor.label}
              </span>
            </span>
          )}
        </span>
      )}
    </span>
  );
}
