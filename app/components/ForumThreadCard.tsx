'use client';

import { useState } from 'react';
import { authorTag } from '../lib/auth/author';
import { threadDomId } from '../lib/forum/anchors';
import { countReplies, formatStamp } from '../lib/forum/format';
import type { ForumThread } from '../lib/forum/types';
import CommentComposer from './CommentComposer';
import { useForum } from './ForumProvider';
import { TagRow } from './TagBadge';

type ForumThreadCardProps = {
  thread: ForumThread;
  position: number;
  isOpen: boolean;
  onToggle: (threadId: string, open: boolean) => void;
};

/**
 * One collapsible thread. Uses native <details>/<summary> so the dropdown works
 * without extra JS chrome, but `open` stays controlled so the board can offer
 * expand all / collapse all and can jump to a specific thread via #thread-<id>.
 */
export default function ForumThreadCard({ thread, position, isOpen, onToggle }: ForumThreadCardProps) {
  const forum = useForum();
  const [reply, setReply] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replyStatus, setReplyStatus] = useState<string | null>(null);

  async function handleReply() {
    const body = reply.trim();

    if (body.length < 2) {
      setReplyError('REPLY IS TOO SHORT.');
      setReplyStatus(null);
      return;
    }

    setReplyBusy(true);
    setReplyError(null);

    try {
      await forum.addComment({ body, threadId: thread.id });
      setReply('');
      setReplyStatus('REPLY FILED.');
    } catch (caught) {
      setReplyError(caught instanceof Error ? caught.message : 'UNKNOWN ERROR');
    } finally {
      setReplyBusy(false);
    }
  }

  return (
    <article
      id={threadDomId(thread.id)}
      className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]"
    >
      <details open={isOpen} onToggle={(event) => onToggle(thread.id, event.currentTarget.open)}>
        <summary className="flex cursor-pointer select-none items-start gap-2 bg-[#000080] px-2 py-1 text-xs font-bold text-white">
          <span className="w-6 shrink-0">{isOpen ? '[-]' : '[+]'}</span>
          <span className="flex-1">
            {position}. {thread.title}
          </span>
          <span className="shrink-0">{countReplies(thread.comments.length)}</span>
        </summary>

        <div className="border-t border-gray-600 bg-white p-3 text-black">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold">
            <span>
              BY {authorTag(thread.author)} :: {formatStamp(thread.createdAt)}
            </span>
            <span>
              FILED UNDER: {thread.anchor.label} [{thread.anchor.kind}]
            </span>
          </div>

          <TagRow tags={thread.tags} className="mt-2" emptyLabel="NO TAGS" />

          <p className="mt-2 whitespace-pre-line text-xs leading-relaxed">{thread.body}</p>

          <div className="mt-3 border-t border-gray-400 pt-2">
            <p className="text-[10px] font-bold">
              REPLIES: {thread.comments.length} :: ORIGIN: {thread.origin.toUpperCase()}
            </p>

            {thread.comments.length === 0 ? (
              <p className="mt-2 text-[10px]">NO REPLIES YET. BE THE FIRST ANONYMOUS POSTER.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {thread.comments.map((comment, index) => (
                  <li key={comment.id} className="rounded-none border border-gray-500 bg-[#f0f0f0] p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold">
                      <span>
                        #{index + 1} {authorTag(comment.author)}
                      </span>
                      <span>{formatStamp(comment.createdAt)}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-line text-xs">{comment.body}</p>
                    <TagRow tags={comment.tags} className="mt-1" />
                  </li>
                ))}
              </ul>
            )}

            <CommentComposer
              id={`reply-${thread.id}`}
              value={reply}
              onChange={setReply}
              onSubmit={handleReply}
              submitLabel="[ FILE REPLY ]"
              placeholder="Reply to this thread..."
              author={forum.author}
              busy={replyBusy}
              error={replyError}
              status={replyStatus}
              rows={2}
            />
          </div>
        </div>
      </details>
    </article>
  );
}
