'use client';

import { useState } from 'react';
import { ARCHIVE_MEDIA } from '../lib/concepts/sheets';
import { threadDomId } from '../lib/forum/anchors';
import { countReplies, formatStamp } from '../lib/forum/format';
import { collectThreadImages, imageSourceLabel } from '../lib/forum/media';
import { buildPostLayout } from '../lib/forum/post-layout';
import { postCredit } from '../lib/forum/site-author';
import type { ForumThread } from '../lib/forum/types';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import AnchorLink from './AnchorLink';
import CommentComposer from './CommentComposer';
import CommentThreadList from './CommentThreadList';
import { useForum } from './ForumProvider';
import { ThreadModeration } from './ForumModerationControls';
import MediaThumbnail from './MediaThumbnail';
import PostAuthorRow from './PostAuthorRow';
import PostHoverPreview from './PostHoverPreview';
import SheetImage from './SheetImage';
import { TagRow } from './TagBadge';
import TimeStamp from './TimeStamp';

type ForumThreadCardProps = {
  thread: ForumThread;
  isOpen: boolean;
  onToggle: (threadId: string, open: boolean) => void;
};

/**
 * One collapsible post.
 *
 * The header is text, not a bar: collapsed, the title, the stamp, the poster and
 * the post's tags carry the row, and the drawing plus the poster's picture only
 * appear when the header is pointed at (`group-hover`). Expanding puts the
 * picture and the small tags in a left column with the body of the text beside
 * them - the rules live in app/lib/forum/post-layout.ts.
 *
 * A thread an item's comment box opened is credited to the item, so its header
 * names the site and shows the default pfp rather than repeating the account that
 * commented first; the comment below already carries that account's id.
 *
 * Native <details>/<summary> keeps the collapse behaviour (and the board's expand
 * all / collapse all, plus #thread-<id> jump links) without extra JS.
 */
export default function ForumThreadCard({ thread, isOpen, onToggle }: ForumThreadCardProps) {
  const forum = useForum();
  // The header reads the *credit's* profile, not the thread author's: an item's own
  // post is signed by the house account, so its dark blue name and its picture come
  // from that account and never from whoever commented first. `postCredit` decides
  // which of the two applies (app/lib/forum/site-author.ts).
  const { profile } = usePublicProfile(postCredit(thread).id);
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

  const images = collectThreadImages(thread);

  const layout = buildPostLayout({
    thread,
    isOpen,
    authorProfile: profile,
    postedLabel: `POSTED ${formatStamp(thread.createdAt)}`,
    repliesLabel: countReplies(thread.comments.length),
    imageSourceLabel: imageSourceLabel(images.source),
    postImage: images.preview,
  });

  // While the card is open its left column already draws the item's own sheet, so
  // the links back to that item must not pop a second copy of it on hover: the
  // preview is kept for the cases where the drawing lives somewhere else.
  const anchorPreview = isOpen && images.source === 'item' ? 'none' : 'hover';

  return (
    <article id={threadDomId(thread.id)} className="px-2 py-2">
      <details
        className="group"
        open={isOpen}
        onToggle={(event) => onToggle(thread.id, event.currentTarget.open)}
      >
        {/*
          Collapsed, only the title, the stamp, the poster and the post's tags are
          drawn. The poster's picture and the drawing are `group-hover` only, so
          the list stays tight until somebody points at the title or the name.
        */}
        <summary className="cursor-pointer select-none list-none">
          {/*
            Two columns: the row itself on the left, and the space that stays empty
            until somebody points at the row on the right - which is where the
            writing and the reply crawl show themselves. The space is held open in
            both states, so hovering never reflows the list.
          */}
          <div className="flex items-stretch gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 text-xs font-bold text-black">
                <span className="shrink-0 text-gray-700">{isOpen ? '[-]' : '[+]'}</span>
                <span className="min-w-0 flex-1 group-hover:underline">{layout.title}</span>
                <span className="shrink-0 text-[10px] text-gray-700">{layout.repliesLabel}</span>
              </div>

              {/* Posted stamp, poster (picture on hover), place line, displayed tags. */}
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-black">
                {/* The instant is the one blue thing in the header: POSTED stays black. */}
                <span className="font-bold">
                  POSTED <TimeStamp at={thread.createdAt} />
                </span>

                <PostAuthorRow
                  author={layout.author.credit}
                  avatar={layout.avatar}
                  avatarSize={56}
                  nameColour={layout.author.nameColour}
                  picture={layout.author.picture}
                  location={layout.author.location}
                  displayedTags={layout.author.displayedTags}
                />

                {layout.image === 'hover' && images.preview !== undefined ? (
                  <span className="hidden group-hover:inline-flex" title={layout.left.imageSource}>
                    <MediaThumbnail media={images.preview} size={72} />
                  </span>
                ) : null}
              </div>

              {isOpen ? null : <TagRow tags={layout.collapsedTags} className="mt-1" compact limit={8} />}

              {/* Only drawn for the house account: rewrite the post, or take it down. */}
              <ThreadModeration thread={thread} />
            </div>

            {isOpen ? null : (
              <PostHoverPreview body={layout.right.body} comments={thread.comments} />
            )}
          </div>
        </summary>

        {/*
          Expanded: the picture and the small tags down the left, the body of the
          text and the replies to their right - the text gets the width.
        */}
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <div className="sm:w-44 sm:shrink-0">
            {layout.left.image === undefined ? null : (
              <div className="rounded-none border border-black bg-white" title={layout.left.imageSource}>
                <SheetImage
                  src={layout.left.image.src}
                  alt={layout.left.image.alt}
                  width={layout.left.image.width}
                  height={layout.left.image.height}
                  sizes="(max-width: 768px) 45vw, 176px"
                />
              </div>
            )}

            <TagRow tags={layout.left.tags} className="mt-2" compact emptyLabel="NO TAGS" limit={6} />

            {images.count > 1 ? (
              <p className="mt-1 text-[9px] font-bold text-gray-700">
                +{images.count - 1} MORE IMAGE(S) IN THE REPLIES
              </p>
            ) : null}

            <div className="mt-1 text-[9px] font-bold text-gray-700">
              <AnchorLink anchor={thread.anchor} prefix="FILED UNDER" preview={anchorPreview} />
              <p className="mt-1">ORIGIN: {thread.origin.toUpperCase()}</p>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            {layout.right.isAnchorPost ? (
              <AnchorLink anchor={thread.anchor} preview={anchorPreview} />
            ) : (
              <p className="whitespace-pre-line text-xs leading-snug text-black">{layout.right.body}</p>
            )}

            <div className="mt-2 border-t border-gray-300 pt-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold text-black">
                <span>{layout.repliesLabel} ON THIS POST</span>
                <span>BOARD ID: {thread.id}</span>
              </div>

              <CommentThreadList
                thread={thread}
                avatarSize={48}
                emptyLabel="NO REPLIES YET. BE THE FIRST ANONYMOUS POSTER."
              />

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
        </div>
      </details>
    </article>
  );
}
