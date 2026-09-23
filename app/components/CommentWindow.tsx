'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ARCHIVE_MEDIA } from '../lib/concepts/sheets';
import { threadDomId } from '../lib/forum/anchors';
import { countReplies } from '../lib/forum/format';
import { mentionsIn } from '../lib/forum/mentions';
import { deriveTags, displayTags } from '../lib/forum/tags';
import type { ForumAnchor, ForumTrack } from '../lib/forum/types';
import AnchorLink from './AnchorLink';
import CommentComposer from './CommentComposer';
import CommentThreadList from './CommentThreadList';
import { useComms } from './CommsProvider';
import { useForum } from './ForumProvider';
import { useNotifications } from './NotificationsProvider';
import PopoutWindow from './PopoutWindow';
import TagStrip from './TagStrip';
import TimeStamp from './TimeStamp';

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
  const { accounts } = useComms();
  const notifications = useNotifications();
  const thread = forum.threadForAnchor(anchor);

  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [commentTags, setCommentTags] = useState<string[]>([]);
  const [commentMediaId, setCommentMediaId] = useState('');
  const [commentTrack, setCommentTrack] = useState<ForumTrack | null>(null);
  /** The MP3s filed on this item's post and its replies, counted for the line under the list. */
  const filedTracks = useMemo(() => {
    if (thread === undefined) return 0;

    return (thread.track === undefined ? 0 : 1) + thread.comments.filter((item) => item.track !== undefined).length;
  }, [thread]);

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
        ...(commentTrack === null ? {} : { track: commentTrack }),
      });

      // A comment under an item answers the thread already filed for it, if there is one:
      // whoever opened that thread is told, and so is anybody the words name.
      await notifications.notifyTagged({
        threadId: result.thread.id,
        threadTitle: result.thread.title,
        body: trimmed,
        mentions: mentionsIn(trimmed, accounts),
        autoTagId: thread?.author.id ?? null,
      });

      setBody('');
      setCommentTags([]);
      setCommentMediaId('');
      setCommentTrack(null);
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
            className="rounded-none border border-black bg-sun-pale px-2 py-[2px] underline hover:bg-ice"
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
              {/*
                The poster's name and picture already sit on their own reply in
                the list below, so this line only carries what the list does not.
              */}
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold">
                <span>
                  FILED <TimeStamp at={thread.createdAt} />
                </span>
                <span>ORIGIN: {thread.origin.toUpperCase()}</span>
              </div>

              {/* A thread with audio in it says so: the players are in the replies below. */}
              {filedTracks === 0 ? null : (
                <p className="mt-1 text-[10px] font-bold text-ena">
                  {filedTracks} MP3{filedTracks === 1 ? '' : 'S'} FILED HERE - PRESS PLAY ON ONE TO HEAR IT.
                </p>
              )}

              <TagStrip tags={displayTags(thread.tags)} className="mt-1" limit={5} />

              <CommentThreadList
                thread={thread}
                avatarSize={44}
                emptyLabel="NO COMMENTS YET. BE THE FIRST TO COMMENT ON THIS ITEM."
              />
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
            accounts={accounts}
            autoTag={thread?.author ?? null}
            previewTags={previewTags}
            tags={commentTags}
            onTagsChange={setCommentTags}
            mediaId={commentMediaId}
            onMediaIdChange={setCommentMediaId}
            track={commentTrack}
            onTrackChange={setCommentTrack}
            busy={busy}
            error={error}
            status={status}
            rows={3}
          />
      </div>
    </PopoutWindow>
  );
}
