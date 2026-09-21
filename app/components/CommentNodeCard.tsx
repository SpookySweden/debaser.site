'use client';

import type { ReactNode } from 'react';
import { authorTag } from '../lib/auth/author';
import { countReplies, formatStamp } from '../lib/forum/format';
import { displayTags } from '../lib/forum/tags';
import type { ForumAuthor, ForumComment } from '../lib/forum/types';
import CommentComposer from './CommentComposer';
import MediaThumbnail from './MediaThumbnail';
import ProfileAvatarLink from './ProfileAvatarLink';
import ProfileLink from './ProfileLink';
import { TagRow } from './TagBadge';

export const COMMENT_SMALL_BUTTON =
  'cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-2 py-[2px] text-[10px] font-bold text-black hover:bg-gray-300 disabled:cursor-wait disabled:opacity-60';

type CommentNodeCardProps = {
  comment: ForumComment;
  /** Position among its siblings. */
  index: number;
  /** 0 for a top-level reply, rising with each nesting level. */
  depth: number;
  avatarSize: number;
  maxIndentDepth: number;
  /** Who a new reply is filed under. */
  viewer: ForumAuthor;
  /** Direct replies to this comment. */
  replyCount: number;
  replyOpen: boolean;
  repliesHidden: boolean;
  busy: boolean;
  error: string | null;
  status: string | null;
  draft: string;
  onDraftChange: (value: string) => void;
  onToggleReply: () => void;
  onToggleReplies: () => void;
  onSubmit: () => void;
  /** The nested replies, when they are on screen. */
  children?: ReactNode;
};

/**
 * One comment in the thread tree.
 *
 * Presentation only: the author's picture (no grey trim, so the drawing gets the
 * space), the body, any attached artwork, its tags, and the two small controls
 * that make the threading usable - `[ COMMENT ]` to answer this comment, and
 * `[ SHOW n REPLIES ] / [ HIDE n REPLIES ]` to fold the replies underneath.
 */
export default function CommentNodeCard({
  comment,
  index,
  depth,
  avatarSize,
  maxIndentDepth,
  viewer,
  replyCount,
  replyOpen,
  repliesHidden,
  busy,
  error,
  status,
  draft,
  onDraftChange,
  onToggleReply,
  onToggleReplies,
  onSubmit,
  children,
}: CommentNodeCardProps) {
  const indent = depth === 0 ? '' : depth <= maxIndentDepth ? 'ml-4 border-l-2 border-gray-300 pl-2' : 'ml-2';

  return (
    <li className={`flex items-start gap-2 ${indent}`}>
      <ProfileAvatarLink
        author={comment.author}
        size={depth === 0 ? avatarSize : Math.max(30, avatarSize - 12)}
        showName={false}
        variant="plain"
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold text-black">
          <span className="inline-flex flex-wrap items-center gap-1">
            #{index + 1}
            <ProfileLink author={comment.author}>{authorTag(comment.author)}</ProfileLink>
          </span>
          <span>{formatStamp(comment.createdAt)}</span>
        </div>

        <p className="mt-1 whitespace-pre-line text-xs text-black">{comment.body}</p>

        {comment.media === undefined ? null : (
          <div className="mt-1">
            <MediaThumbnail media={comment.media} size={96} />
          </div>
        )}

        <TagRow tags={displayTags(comment.tags)} className="mt-1" compact />

        <div className="mt-1 flex flex-wrap items-center gap-1">
          <button type="button" onClick={onToggleReply} title="Comment on this reply" className={COMMENT_SMALL_BUTTON}>
            {replyOpen ? '[ CANCEL ]' : '[ COMMENT ]'}
          </button>

          {children === undefined ? null : (
            <button type="button" onClick={onToggleReplies} className={COMMENT_SMALL_BUTTON}>
              {repliesHidden ? `[ SHOW ${countReplies(replyCount)} ]` : `[ HIDE ${countReplies(replyCount)} ]`}
            </button>
          )}
        </div>

        {replyOpen ? (
          <CommentComposer
            id={`reply-${comment.id}`}
            value={draft}
            onChange={onDraftChange}
            onSubmit={onSubmit}
            submitLabel="[ FILE COMMENT ]"
            placeholder="Add to this reply thread..."
            author={viewer}
            busy={busy}
            error={error}
            status={status}
            rows={2}
          />
        ) : null}

        {children}
      </div>
    </li>
  );
}
