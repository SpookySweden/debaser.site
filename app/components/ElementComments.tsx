'use client';

import { useState } from 'react';
import {
  canCommentOnElement,
  elementComments,
  elementNoun,
  profileElements,
  visibleElementComments,
  type ProfileElement,
  type ProfileElementKind,
} from '../lib/profile/elements';
import type { PublicProfile } from '../lib/profile/types';
import { HYPER_ARROW, HYPER_LABEL, HYPER_TEXT } from '../lib/ui/hypertext';
import CommentRow, { commentRowData } from './CommentRow';
import TimeStamp from './TimeStamp';

/** Seconds of crawl per remark, so a long thread does not scroll any faster than a short one. */
const SECONDS_PER_ITEM = 7;

type ElementCommentsProps = {
  profile: PublicProfile;
  /** The version being read: its thread is the one shown. */
  element: ProfileElement;
  owner: boolean;
  /** Opens the one comment window for this element. */
  onComment: () => void;
  /** Picking another version switches the element *and* the thread. */
  onSelect: (versionId: string) => void;
  /** Tracks can be listened to from the history; pictures have nothing to play. */
  onPlay?: (element: ProfileElement) => void;
  /** True while that version is the one coming out of the player. */
  playing?: (element: ProfileElement) => boolean;
};

/**
 * The conversation attached to one element - a drawing or a track - sitting directly
 * under it.
 *
 * Both surfaces read the same here because they are the same thing: a version (tagged `P2`
 * or `M1`), a thread that belongs to that version, and a history of the others. The panel
 * takes the width of the thing above it, which is what makes the page lay out like a well
 * packed case: the drawing and its remarks in the narrow column, the track and its remarks
 * in the wide one, each thread bounded by the element it belongs to rather than pooled at
 * the foot of the page.
 *
 * It is also the quietest thing on the page, deliberately. A profile is read for its
 * picture and its track, so asking to add to a thread is a link - `comment`, in blue, the
 * way a page asked for things in 1995 - and the thread itself is behind one small arrow
 * carrying its count (`▸ 3`). A remark needs no plate of its own to be found.
 *
 * Folded, and there is something to read, the thread goes past as a single line underneath
 * (`.crawl`, the same crawl the board's wire uses): the whole thread on the width of the
 * column, one remark at a time, instead of a list that buries the drawing above it.
 * Writing happens in a window (see ./ProfileCommentWindow) so the page keeps its shape
 * while somebody is mid-sentence.
 */
export default function ElementComments({
  profile,
  element,
  owner,
  onComment,
  onSelect,
  onPlay,
  playing,
}: ElementCommentsProps) {
  const kind: ProfileElementKind = element.kind;
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const listed = owner ? elementComments(profile, kind) : visibleElementComments(profile, kind);
  // The thread is filtered from `listed` rather than from every comment: a visitor whose
  // owner has the thread switched off sees nothing here, not even the count.
  const thread = listed.filter((comment) =>
    element.kind === 'picture' ? comment.avatarVersionId === element.id : comment.songVersionId === element.id,
  );
  const versions = profileElements(profile, kind);
  const writable = canCommentOnElement(owner, profile.visibility, kind);
  const noun = elementNoun(kind);

  return (
    <div className="min-w-0">
      {/* The line under the element: what it is, the way in, and the fold. A caption to the
          drawing rather than a title bar - no box, because a box is what made this read as
          a button stack. */}
      <p className="flex flex-wrap items-baseline gap-x-2 text-[10px] font-bold text-black">
        <span className={HYPER_LABEL}>{element.tag}</span>

        {writable ? (
          <button
            type="button"
            onClick={onComment}
            className={HYPER_TEXT}
            title={`Leave a comment on ${element.tag}`}
          >
            comment
          </button>
        ) : (
          <span className="text-gray-700">comments off</span>
        )}

        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={HYPER_ARROW}
          aria-expanded={open}
          title={open ? `Fold the comments on ${element.tag} away` : `Show the comments on ${element.tag}`}
        >
          {open ? '▾' : '▸'}
          {thread.length === 0 ? '' : ` ${thread.length}`}
        </button>

        {versions.length <= 1 ? null : (
          <button
            type="button"
            onClick={() => setHistoryOpen(!historyOpen)}
            className={HYPER_TEXT}
            aria-expanded={historyOpen}
          >
            history ({versions.length})
          </button>
        )}
      </p>

      {open ? (
        thread.length === 0 ? (
          <p className="mt-1 text-[10px] text-black">
            {writable ? `nothing has been said about ${element.tag} yet.` : `comments on the ${noun} are off.`}
          </p>
        ) : (
          <ul className="mt-1 space-y-1">
            {thread.map((comment) => (
              <CommentRow key={comment.id} data={commentRowData(comment)} />
            ))}
          </ul>
        )
      ) : thread.length === 0 ? null : (
        /* Folded with something behind it: the thread crawls past in one line, so a remark
           can be read without opening anything and the fold never hides what it holds. The
           run is drawn twice so the loop has no seam (see app/globals.css). */
        <div className="mt-1 overflow-hidden rounded-none border border-gray-500 bg-black px-1 py-[2px]">
          <div
            className="crawl flex w-max items-center"
            style={{ animationDuration: `${Math.max(20, thread.length * SECONDS_PER_ITEM)}s` }}
          >
            {[0, 1].map((copy) => (
              <ul key={copy} className="flex items-center" aria-hidden={copy === 1 ? 'true' : undefined}>
                {thread.map((comment) => (
                  <CommentRow key={`${copy}-${comment.id}`} data={commentRowData(comment)} variant="compact" />
                ))}
              </ul>
            ))}
          </div>
        </div>
      )}

      {/* The other versions, behind their own fold: switching is a reading choice, so it
          does not take the space the thread might need. */}
      {historyOpen && versions.length > 1 ? (
        <ul className="mt-1 space-y-[2px]">
          {versions.map((version) => {
            const count = listed.filter((comment) =>
              version.kind === 'picture'
                ? comment.avatarVersionId === version.id
                : comment.songVersionId === version.id,
            ).length;
            const looking = version.id === element.id;

            return (
              <li
                key={version.id}
                className="flex flex-wrap items-baseline justify-between gap-x-2 bg-[#f0f0f0] px-1 text-[10px] font-bold text-black"
              >
                <span className="min-w-0 truncate">
                  <span className={HYPER_LABEL}>{version.tag}</span>
                  {version.current ? ' (current)' : ''} :: {count} comment{count === 1 ? '' : 's'} ::{' '}
                  <TimeStamp at={version.createdAt} />
                </span>

                <span className="flex items-baseline gap-x-2">
                  {onPlay === undefined || version.kind !== 'track' ? null : (
                    <button
                      type="button"
                      onClick={() => onPlay(version)}
                      className={HYPER_TEXT}
                      title={`Play ${version.tag}`}
                    >
                      {playing?.(version) === true ? 'pause' : 'play'}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onSelect(version.id)}
                    disabled={looking}
                    className={`${HYPER_TEXT} disabled:cursor-default disabled:text-gray-700 disabled:no-underline`}
                  >
                    {looking ? 'reading' : `read ${version.tag}`}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
