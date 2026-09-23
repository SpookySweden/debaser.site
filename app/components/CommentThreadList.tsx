'use client';

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { buildCommentTree, type CommentNode } from '../lib/forum/comment-tree';
import { answeredAuthor, mentionsIn } from '../lib/forum/mentions';
import type { ForumThread, ForumTrack } from '../lib/forum/types';
import CommentNodeCard from './CommentNodeCard';
import { useComms } from './CommsProvider';
import { useForum } from './ForumProvider';
import { useNotifications } from './NotificationsProvider';

type CommentThreadListProps = {
  thread: ForumThread;
  /** Avatar edge length: the board uses larger pictures than the pop-up. */
  avatarSize?: number;
  /** Nesting levels that get their own indent before replies line up flat. */
  maxIndentDepth?: number;
  emptyLabel?: string;
};

/**
 * Replies, with reply threads.
 *
 * Every comment carries a small `[ COMMENT ]` control that opens a box right
 * under it, so a reply can answer the post (the composer at the foot of the
 * window or card) or answer an existing comment (this list). Comments that have
 * replies carry `[ SHOW n REPLIES ] / [ HIDE n REPLIES ]`, so a long thread can
 * be read without the deep ones pushing everything about.
 *
 * The same component draws the comment window on an asset and the replies under a
 * board post, so the two behave identically.
 */
export default function CommentThreadList({
  thread,
  avatarSize = 44,
  maxIndentDepth = 3,
  emptyLabel = 'NO REPLIES YET.',
}: CommentThreadListProps) {
  const forum = useForum();
  const { accounts } = useComms();
  const notifications = useNotifications();
  const nodes = useMemo(() => buildCommentTree(thread.comments), [thread.comments]);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** The MP3 each open reply box has attached, by the comment it answers. */
  const [draftTracks, setDraftTracks] = useState<Record<string, ForumTrack | null>>({});
  const [openReplyId, setOpenReplyId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [status, setStatus] = useState<{ id: string; message: string } | null>(null);

  async function submitReply(parentId: string) {
    const body = (drafts[parentId] ?? '').trim();

    if (body.length < 2) {
      setError({ id: parentId, message: 'REPLY IS TOO SHORT.' });
      setStatus(null);
      return;
    }

    setBusyId(parentId);
    setError(null);

    try {
      const attached = draftTracks[parentId] ?? null;
      await forum.addComment({
        body,
        threadId: thread.id,
        parentId,
        ...(attached === null ? {} : { track: attached }),
      });

      // Answering a reply tags whoever wrote it (app/lib/forum/mentions.ts), and the words may
      // tag accounts of their own: both are filed from the same call.
      await notifications.notifyTagged({
        threadId: thread.id,
        threadTitle: thread.title,
        body,
        mentions: mentionsIn(body, accounts),
        autoTagId: answeredAuthor(thread, parentId).id,
      });

      setDrafts((current) => ({ ...current, [parentId]: '' }));
      setDraftTracks((current) => ({ ...current, [parentId]: null }));
      setOpenReplyId(null);
      setStatus({ id: parentId, message: 'COMMENT FILED.' });
      // Keep the new reply on screen even if that comment's replies were folded.
      setCollapsedIds((current) => current.filter((id) => id !== parentId));
    } catch (caught) {
      setError({ id: parentId, message: caught instanceof Error ? caught.message : 'UNKNOWN ERROR' });
    } finally {
      setBusyId(null);
    }
  }

  function renderNode(node: CommentNode, siblingIndex: number): ReactNode {
    const { comment, children, depth } = node;
    const replyOpen = openReplyId === comment.id;
    const repliesHidden = collapsedIds.includes(comment.id);

    return (
      <CommentNodeCard
        key={comment.id}
        comment={comment}
        index={siblingIndex}
        depth={depth}
        avatarSize={avatarSize}
        maxIndentDepth={maxIndentDepth}
        viewer={forum.author}
        replyCount={children.length}
        replyOpen={replyOpen}
        repliesHidden={repliesHidden}
        accounts={accounts}
        busy={busyId === comment.id}
        error={error !== null && error.id === comment.id ? error.message : null}
        status={status !== null && status.id === comment.id ? status.message : null}
        draft={drafts[comment.id] ?? ''}
        onDraftChange={(value) => setDrafts((current) => ({ ...current, [comment.id]: value }))}
        track={draftTracks[comment.id] ?? null}
        onTrackChange={(next) => setDraftTracks((current) => ({ ...current, [comment.id]: next }))}
        onToggleReply={() => {
          setOpenReplyId(replyOpen ? null : comment.id);
          setError(null);
          setStatus(null);
        }}
        onToggleReplies={() =>
          setCollapsedIds((current) =>
            repliesHidden ? current.filter((id) => id !== comment.id) : [...current, comment.id],
          )
        }
        onSubmit={() => void submitReply(comment.id)}
      >
        {children.length === 0 || repliesHidden ? undefined : (
          <ul className="mt-2 space-y-2">
            {children.map((child, childIndex) => renderNode(child, childIndex))}
          </ul>
        )}
      </CommentNodeCard>
    );
  }

  if (thread.comments.length === 0) {
    return <p className="mt-2 text-[10px] font-bold text-black">{emptyLabel}</p>;
  }

  return <ul className="mt-2 space-y-2">{nodes.map((node, index) => renderNode(node, index))}</ul>;
}
