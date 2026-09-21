'use client';

import { useState } from 'react';
import { authorTag } from '../lib/auth/author';
import { ARCHIVE_MEDIA } from '../lib/concepts/sheets';
import { isAutoFiledBody, threadDomId } from '../lib/forum/anchors';
import { countReplies, formatStamp } from '../lib/forum/format';
import { collectThreadImages, imageSourceLabel } from '../lib/forum/media';
import type { ForumThread } from '../lib/forum/types';
import AnchorLink from './AnchorLink';
import CommentComposer from './CommentComposer';
import { useForum } from './ForumProvider';
import MediaThumbnail from './MediaThumbnail';
import SheetImage from './SheetImage';
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
  const [replyTags, setReplyTags] = useState<string[]>([]);
  const [replyMediaId, setReplyMediaId] = useState('');

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
      await forum.addComment({
        body,
        threadId: thread.id,
        userTags: replyTags,
        media: ARCHIVE_MEDIA.find((item) => item.id === replyMediaId)?.preview,
      });
      setReply('');
      setReplyTags([]);
      setReplyMediaId('');
      setReplyStatus('REPLY FILED.');
    } catch (caught) {
      setReplyError(caught instanceof Error ? caught.message : 'UNKNOWN ERROR');
    } finally {
      setReplyBusy(false);
    }
  }

  const previewTags = thread.tags.slice(0, 4);
  const hiddenTagCount = thread.tags.length - previewTags.length;
  const images = collectThreadImages(thread);

  return (
    <article
      id={threadDomId(thread.id)}
      className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]"
    >
      <details open={isOpen} onToggle={(event) => onToggle(thread.id, event.currentTarget.open)}>
        {/*
          Preview content lives inside <summary>, so a collapsed post still shows
          the date, the item it belongs to, its tags and the first few lines -
          only long posts need expanding.
        */}
        <summary className="cursor-pointer select-none">
          <div className="flex items-start gap-2 bg-[#000080] px-2 py-1 text-xs font-bold text-white">
            <span className="w-5 shrink-0">{isOpen ? '[-]' : '[+]'}</span>
            <span className="flex-1">
              {position}. {thread.title}
            </span>
            <span className="shrink-0">{countReplies(thread.comments.length)}</span>
          </div>

          <div className="bg-white px-2 py-2 text-black">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold">
              <span>
                POSTED: {formatStamp(thread.createdAt)} :: BY {authorTag(thread.author)}
              </span>
              <span>
                FILED UNDER: {thread.anchor.label} [{thread.anchor.kind}]
              </span>
            </div>

            <div className="mt-1" onClick={(event) => event.stopPropagation()}>
              <TagRow tags={previewTags} emptyLabel="NO TAGS" />
              {hiddenTagCount <= 0 ? null : (
                <span className="text-[10px] font-bold text-gray-700"> +{hiddenTagCount} MORE</span>
              )}
            </div>

            <div className="mt-1 flex gap-2">
              <div className="min-w-0 flex-1">
                {isAutoFiledBody(thread.body) ? (
                  <div onClick={(event) => event.stopPropagation()}>
                    <AnchorLink anchor={thread.anchor} />
                  </div>
                ) : (
                  <p
                    className={`whitespace-pre-line text-xs leading-snug ${
                      isOpen ? '' : 'line-clamp-3'
                    }`}
                  >
                    {thread.body}
                  </p>
                )}
              </div>

              {/* Minimal image preview, visible before the post is expanded */}
              {images.preview === undefined ? null : (
                <div
                  className="shrink-0 text-center"
                  onClick={(event) => event.stopPropagation()}
                  title={imageSourceLabel(images.source)}
                >
                  <MediaThumbnail media={images.preview} />
                  {images.count > 1 ? (
                    <p className="mt-1 text-[10px] font-bold text-gray-700">+{images.count - 1} IMG</p>
                  ) : null}
                </div>
              )}
            </div>

            {isOpen ? null : (
              <p className="mt-1 text-[10px] font-bold text-gray-700">
                [ CLICK TO EXPAND: FULL POST, ATTACHMENTS AND {countReplies(thread.comments.length)} ]
              </p>
            )}
          </div>
        </summary>

        <div className="border-t border-gray-600 bg-white p-2 text-black">

          {thread.media === undefined ? null : (
            <div className="mt-2 w-full max-w-xs rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-1">
              <SheetImage
                src={thread.media.src}
                alt={thread.media.alt}
                width={thread.media.width}
                height={thread.media.height}
                sizes="(max-width: 768px) 100vw, 320px"
              />
            </div>
          )}

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

            <CommentComposer
              id={`reply-${thread.id}`}
              value={reply}
              onChange={setReply}
              onSubmit={handleReply}
              submitLabel="[ FILE REPLY ]"
              placeholder="Reply to this thread..."
              author={forum.author}
              tags={replyTags}
              onTagsChange={setReplyTags}
              mediaId={replyMediaId}
              onMediaIdChange={setReplyMediaId}
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
