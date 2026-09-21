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
import CommentRow, { commentRowData } from './CommentRow';
import TimeStamp from './TimeStamp';

const BUTTON =
  'cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-2 py-[2px] text-[10px] font-bold text-black hover:bg-gray-300 disabled:cursor-wait disabled:opacity-60';

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
 * Closed by default - one summary line, the count and the way in - because a profile is
 * read for its picture and its track: a list of remarks standing open under both would
 * bury the things being remarked on. Writing happens in a window (see
 * ./ElementCommentWindow) so the page keeps its shape while somebody is mid-sentence.
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
    <div className="min-w-0 space-y-1">
      {/* The header: what the thread is about, how much of it there is, and the two ways
          in - read it, or add to it. */}
      <div className="flex flex-wrap items-center justify-between gap-1 rounded-none border border-gray-500 bg-[#f0f0f0] px-2 py-1 text-[10px] font-bold text-black">
        <span>
          {noun} {element.tag} COMMENTS :: {thread.length}
          {writable ? '' : ' :: OFF'}
        </span>

        <span className="flex items-center gap-1">
          <button type="button" onClick={() => setOpen(!open)} className={BUTTON}>
            {open ? '[ HIDE ]' : '[ SHOW ]'}
          </button>

          {writable ? (
            <button type="button" onClick={onComment} className={BUTTON}>
              [ COMMENT ]
            </button>
          ) : null}
        </span>
      </div>

      {!open ? null : thread.length === 0 ? (
        <p className="rounded-none border border-gray-500 bg-white p-2 text-[10px] text-gray-700">
          {writable ? `NOTHING HAS BEEN SAID ABOUT ${element.tag} YET.` : `COMMENTS ON THE ${noun} ARE SWITCHED OFF.`}
        </p>
      ) : (
        <ul className="space-y-1">
          {thread.map((comment) => (
            <CommentRow key={comment.id} data={commentRowData(comment)} />
          ))}
        </ul>
      )}

      {/* The other versions, behind their own expander: switching is a reading choice,
          so it does not take the space the thread might need. */}
      {versions.length <= 1 ? null : (
        <div className="rounded-none border border-gray-500 bg-white p-1">
          <button type="button" onClick={() => setHistoryOpen(!historyOpen)} className={BUTTON}>
            {historyOpen ? '[ HIDE HISTORY ]' : `[ HISTORY (${versions.length}) ]`}
          </button>

          {historyOpen ? (
            <ul className="mt-1 space-y-1">
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
                    className={`flex flex-wrap items-center justify-between gap-1 rounded-none border border-gray-500 px-1 py-[2px] text-[10px] font-bold text-black ${
                      looking ? 'bg-[#ffffcc]' : 'bg-[#f0f0f0]'
                    }`}
                  >
                    <span className="min-w-0 truncate">
                      [ {version.tag} ]
                      {version.current ? ' [ CURRENT ]' : ''} :: {count} COMMENTS ::{' '}
                      <TimeStamp at={version.createdAt} />
                    </span>

                    <span className="flex items-center gap-1">
                      {onPlay === undefined || version.kind !== 'track' ? null : (
                        <button
                          type="button"
                          onClick={() => onPlay(version)}
                          className={BUTTON}
                          title="Play this version"
                        >
                          {playing?.(version) === true ? '[ ❚❚ ]' : '[ ▶ ]'}
                        </button>
                      )}

                      <button type="button" onClick={() => onSelect(version.id)} disabled={looking} className={BUTTON}>
                        {looking ? '[ LOOKING ]' : `[ READ ${version.tag} ]`}
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}
