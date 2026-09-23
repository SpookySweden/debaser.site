'use client';

import { useState } from 'react';
import type { ProfileRepository } from '../lib/profile/types';

type ProfileCommentPinProps = {
  /** The account whose page this is: the owner whose pin it is. */
  userId: string;
  commentId: string;
  /** Whether the comment carries the pin now, which is what the next press undoes. */
  pinned: boolean;
  repository: ProfileRepository;
};

/**
 * The owner's pin, on one comment.
 *
 * A small blue pushpin beside the comment it is about. Pressed, the remark takes the leading row
 * of every run of three on the page's feed (see ../lib/profile/feed); pressed again it goes back
 * into the run behind them. It is drawn beside a row in every list the page keeps - the comments
 * on the profile itself (see ./PublicProfileWindow), and the remarks on the drawing and the track
 * (see ./ElementComments) - because the feed under the columns carries all three, so a pin on a
 * drawing's remark has somewhere to lead.
 *
 * It is drawn as a blue plate with the pushpin on it rather than as a tinted glyph, because an
 * emoji's own colours cannot be tinted and this one has to read as blue.
 *
 * The mark itself is a **character**, not artwork: nothing on this site draws an icon in code, and
 * everything else asked for with a symbol here is a character too (`▸`, `▶`, `♪`, `[ ⚙ ]`). A
 * hand-drawn pin belongs at assets/icons/ as a PNG, at which point this becomes an
 * `<Image src="/assets/icons/pin-blue.png" />` in a button the same size.
 *
 * It is the profile's own control, so the page draws it for the owner and for nobody else - and
 * both stores, and the database's policy, refuse anybody else anyway (see `setCommentPin` in
 * ../lib/profile/types.ts).
 */
export default function ProfileCommentPin({
  userId,
  commentId,
  pinned,
  repository,
}: ProfileCommentPinProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);

    try {
      await repository.setCommentPin(userId, commentId, !pinned);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'THAT PIN COULD NOT BE CHANGED.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-baseline gap-1">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        aria-pressed={pinned}
        aria-label={pinned ? 'Unpin this comment' : 'Pin this comment'}
        title={
          pinned
            ? 'UNPIN :: THE COMMENT GOES BACK AMONG THE OTHERS'
            : 'PIN :: THE COMMENT LEADS EVERY THIRD ROW OF THE WIRE'
        }
        className="cursor-pointer border-t border-l border-white border-r border-b border-black bg-[#000080] px-1 py-[1px] text-[9px] leading-none text-white hover:bg-[#0000c0] disabled:cursor-wait disabled:opacity-60"
      >
        <span aria-hidden="true">📌</span>
      </button>

      {error === null ? null : <span className="text-[9px] font-bold text-[#800000]">{error}</span>}
    </span>
  );
}