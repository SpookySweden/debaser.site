'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { authorTag } from '../lib/auth/author';
import { ARCHIVE_MEDIA } from '../lib/concepts/sheets';
import { threadDomId } from '../lib/forum/anchors';
import { countReplies, formatStamp } from '../lib/forum/format';
import { deriveTags } from '../lib/forum/tags';
import type { ForumAnchor } from '../lib/forum/types';
import AnchorLink from './AnchorLink';
import CommentComposer from './CommentComposer';
import { useForum } from './ForumProvider';
import MediaThumbnail from './MediaThumbnail';
import PopoutWindow from './PopoutWindow';
import { TagRow } from './TagBadge';

type CommentWindowProps = {
  anchor: ForumAnchor;
  onClose: () => void;
};

/**
 * The popped-up, encased Win95 window that holds one item's forum thread.
 *
 * Rendered as a dialog over the page: the title bar drags, ESC or a click on
 * the desktop behind it closes, and the composer files a comment against the
 * item's anchor - opening the thread on the board the first time.
 */
export default function CommentWindow({ anchor, onClose }: CommentWindowProps) {
  const forum = useForum();
  const thread = forum.threadForAnchor(anchor);

  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [commentTags, setCommentTags] = useState<string[]>([]);
  const [commentMediaId, setCommentMediaId] = useState('');

  const composerId = `comment-window-body-${anchor.id}`;
  const previewTags = useMemo(() => deriveTags({ text: body, anchor, maxTags: 3 }), [body, anchor]);

  // Put the caret in the textarea as the window opens.
  useEffect(() => {
    document.getElementById(composerId)?.focus();
  }, [composerId]);

  async function handleSubmit() {
    const trimmed = body.trim();

    if (trimmed.length < 2) {
      setError('COMMENT IS TOO SHORT.');
      setStatus(null);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const result = await forum.addComment({
        body: trimmed,
        anchor,
        userTags: commentTags,
        media: ARCHIVE_MEDIA.find((item) => item.id === commentMediaId)?.preview,
      });
      setBody('');
      setCommentTags([]);
      setCommentMediaId('');
      setStatus(result.createdThread ? 'THREAD OPENED ON THE BOARD.' : 'COMMENT FILED.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'UNKNOWN ERROR');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PopoutWindow
      title={`COMMENT WINDOW :: ${anchor.label}`}
      badge="[ THREAD ]"
      onClose={onClose}
      maxWidth="max-w-2xl"
      bodyClassName="bg-white"
      actions={
        thread === undefined ? null : (
          <Link
            href={`/forum#${threadDomId(thread.id)}`}
            className="rounded-none border border-black bg-[#c0c0c0] px-2 py-[2px] underline hover:bg-gray-300"
          >
            [ OPEN FULL THREAD ON THE BOARD ]
          </Link>
        )
      }
    >
      <div className="text-black">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold">
            <span>
              SOURCE: {anchor.kind.toUpperCase()} :: ID: {anchor.id}
            </span>
            <span>{thread === undefined ? 'NO THREAD YET' : countReplies(thread.comments.length)}</span>
          </div>

          {/* Link back to the item this window belongs to, with a hover preview */}
          <div className="mt-1">
            <AnchorLink anchor={anchor} prefix="LOOK AT" />
          </div>

          {thread === undefined ? (
            <>
              <p className="mt-2 text-xs font-bold">NO THREAD EXISTS FOR THIS ITEM YET.</p>
              <p className="mt-1 text-[10px]">
                Filing the first comment opens one on the forum board automatically.
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-xs font-bold">{thread.title}</p>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold">
                <span>
                  BY {authorTag(thread.author)} :: {formatStamp(thread.createdAt)}
                </span>
                <span>ORIGIN: {thread.origin.toUpperCase()}</span>
              </div>

              <TagRow tags={thread.tags} className="mt-1" />

              {thread.comments.length === 0 ? (
                <p className="mt-2 text-[10px] font-bold">THREAD IS EMPTY.</p>
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

                      {comment.media === undefined ? null : (
                        <div className="mt-1">
                          <MediaThumbnail media={comment.media} />
                        </div>
                      )}

                      <TagRow tags={comment.tags} className="mt-1" />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          <CommentComposer
            id={composerId}
            value={body}
            onChange={setBody}
            onSubmit={handleSubmit}
            submitLabel="[ FILE COMMENT ]"
            placeholder="Type the comment for this item..."
            author={forum.author}
            previewTags={previewTags}
            tags={commentTags}
            onTagsChange={setCommentTags}
            mediaId={commentMediaId}
            onMediaIdChange={setCommentMediaId}
            busy={busy}
            error={error}
            status={status}
            rows={3}
          />
      </div>
    </PopoutWindow>
  );
}
