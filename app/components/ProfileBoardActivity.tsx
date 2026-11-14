'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { ForumThread } from '../lib/forum/types';
import { BOARD_ACTIVITY_STEP, boardActivityRows } from '../lib/profile/board-activity';
import { PLATE } from '../lib/ui/controls';
import TimeStamp from './TimeStamp';

type ProfileBoardActivityProps = {
  /** Whose activity it is. */
  userId: string;
  /** The whole board as this reader sees it: the list picks this account's posts and replies out of it. */
  threads: ForumThread[];
};

/**
 * Board activity: what this account has posted and replied to on the board, newest first.
 *
 * **Folded away until asked for** (Luke, 2026-11-14: "make board activity expandable and collapsd by default"): a
 * profile reads as a person first, so the title line is all there is until its key is pressed. The key carries
 * `aria-expanded`, which is what the site's one "this is open" look hangs on.
 *
 * **Every row leads straight to the thing it names** (the same day: "clicking on a comment or any kind of forum or
 * interaction under a users profile, in the list, needs to bring you more directly to the corresponding thread"): a
 * post's row to that post, a reply's row to that reply, each by the board's own address, and the board opens it on
 * whatever page it lives, in view and marked (`ForumBoard`'s address reader). The whole row is the link, so it is a
 * big thing to press. Replies are listed here too, since they are most of what a person does on a board.
 *
 * No counts (a profile shows a person, not a console): `[ MORE ]` brings the next rows while there are any.
 */
export default function ProfileBoardActivity({ userId, threads }: ProfileBoardActivityProps) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(BOARD_ACTIVITY_STEP);
  const rows = useMemo(() => boardActivityRows(threads, userId), [threads, userId]);

  return (
    <section data-board-activity={open ? 'open' : 'shut'}>
      <div className="title-line text-accent-ink">
        <span>BOARD ACTIVITY</span>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={PLATE}>
          {open ? '[ HIDE ▴ ]' : '[ SHOW ▾ ]'}
        </button>
      </div>

      {!open ? null : (
        <div className="p-3 text-ink">
          {rows.length === 0 ? (
            <p className="text-label font-bold text-ink">NOTHING YET.</p>
          ) : (
            <ul className="space-y-1">
              {rows.slice(0, shown).map((row) => (
                <li key={row.id} className="text-label font-bold">
                  <Link
                    href={row.href}
                    title={row.kind === 'post' ? 'Open this post on the board' : 'Open this reply on the board'}
                    className="flex flex-wrap items-baseline gap-x-2 hover:bg-ice max-sm:min-h-tap max-sm:items-center"
                  >
                    <TimeStamp at={row.at} />
                    <span className="border border-ink-plate bg-ena px-1 text-ink-bar">
                      [ {row.kind === 'post' ? 'POST' : 'REPLY'} ]
                    </span>
                    {row.kind === 'post' ? (
                      <span className="min-w-0 underline wrap-anywhere">{row.title}</span>
                    ) : (
                      <>
                        <span className="min-w-0 underline wrap-anywhere">&quot;{row.words}&quot;</span>
                        <span className="min-w-0 wrap-anywhere">ON {row.title}</span>
                      </>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {rows.length > shown ? (
            <button type="button" onClick={() => setShown(shown + BOARD_ACTIVITY_STEP)} className={`${PLATE} mt-2`}>
              [ MORE ▾ ]
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
