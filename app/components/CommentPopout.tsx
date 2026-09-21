'use client';

import { useCallback, useState } from 'react';
import type { ForumAnchor } from '../lib/forum/types';
import { PLATE, PLATE_LARGE } from '../lib/ui/controls';
import CommentWindow from './CommentWindow';
import { useForum } from './ForumProvider';

type CommentPopoutProps = {
  /** The item this control belongs to (a picture, a text box, the board). */
  anchor: ForumAnchor;
  /** Tighter button for index rows. */
  compact?: boolean;
};

/**
 * The small comment control that sits on every item.
 *
 * Clicking it pops an encased Win95 window holding that item's forum thread, so
 * the artwork and text boxes stay clean until a reader actually wants the
 * discussion.
 */
export default function CommentPopout({ anchor, compact = false }: CommentPopoutProps) {
  const forum = useForum();
  const [isOpen, setIsOpen] = useState(false);
  const commentCount = forum.commentCountForAnchor(anchor);
  const close = useCallback(() => setIsOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        title={`Open the comment window for ${anchor.label}`}
        className={compact ? PLATE : PLATE_LARGE}
      >
        [ COMMENT{commentCount > 0 ? ` (${commentCount})` : ''} ]
      </button>

      {isOpen ? <CommentWindow anchor={anchor} onClose={close} /> : null}
    </>
  );
}
