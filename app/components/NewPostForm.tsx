'use client';

import { useEffect, useMemo, useState } from 'react';
import { ARCHIVE_MEDIA } from '../lib/concepts/sheets';
import { BOARD_TARGET, POST_TARGETS, postTargetTree } from '../lib/forum/anchors';
import { mentionsIn } from '../lib/forum/mentions';
import { deriveTags } from '../lib/forum/tags';
import type { ForumThread } from '../lib/forum/types';
import CommentComposer from './CommentComposer';
import { useComms } from './CommsProvider';
import { useForum } from './ForumProvider';
import MediaPicker from './MediaPicker';
import { useNotifications } from './NotificationsProvider';
import PopoutWindow from './PopoutWindow';
import TreePicker from './TreePicker';

/** Destinations as folders and items, the shape a file dialog draws. */
const TARGET_TREE = postTargetTree();

type NewPostFormProps = {
  onClose: () => void;
  onCreated?: (thread: ForumThread) => void;
};

/**
 * The composer, presented as a Win95 pop-up window.
 *
 * It stays out of the way until the board's [+ NEW POST...] control opens it: a post can be
 * filed straight onto the board (with attached media) or onto any item on the site, which is how
 * "comments under an asset" and "new threads" end up in the same list.
 *
 * The window is organised the way a file dialog is, in two columns rather than two long
 * drop-downs: the destination is a tree of pages you open and click into, the artwork is a pane
 * of thumbnails with the chosen sheet beside it, and the line under both restates the choice in
 * words. Nothing here draws artwork - a sheet is a file in the project assets folder, and the
 * picker only points at it (AGENTS.md).
 */
export default function NewPostForm({ onClose, onCreated }: NewPostFormProps) {
  const forum = useForum();
  const { accounts } = useComms();
  const notifications = useNotifications();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [targetKey, setTargetKey] = useState<string>(POST_TARGETS[0].key);
  const [mediaId, setMediaId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const target = POST_TARGETS.find((option) => option.key === targetKey) ?? POST_TARGETS[0];
  const anchor = target.anchor;
  const isBoardPost = target.key === BOARD_TARGET.key;
  const media = ARCHIVE_MEDIA.find((item) => item.id === mediaId);
  const previewTags = useMemo(() => deriveTags({ text: `${title}\n${body}`, anchor }), [title, body, anchor]);
  /** Whoever the words name with `@`: tagging them is what files a notification. */
  const mentions = useMemo(() => mentionsIn(body, accounts), [accounts, body]);

  // Focus the title field as the window opens.
  useEffect(() => {
    document.getElementById('new-post-title')?.focus();
  }, []);

  async function handleSubmit() {
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();

    if (trimmedTitle.length < 4) {
      setError('TITLE MUST BE AT LEAST 4 CHARACTERS.');
      setStatus(null);
      return;
    }

    if (trimmedBody.length < 4) {
      setError('POST BODY MUST BE AT LEAST 4 CHARACTERS.');
      setStatus(null);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const thread = await forum.createThread({
        title: trimmedTitle,
        body: trimmedBody,
        anchor,
        userTags: tags,
        media: media?.preview,
      });

      // Whoever the post names is told, after the post itself is filed: a tag that could not be
      // delivered must not lose the post (see `notifyTagged`).
      await notifications.notifyTagged({
        threadId: thread.id,
        threadTitle: thread.title,
        body: trimmedBody,
        mentions,
      });

      setTitle('');
      setBody('');
      setTags([]);
      setMediaId('');
      setStatus('THREAD FILED.');
      onCreated?.(thread);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'UNKNOWN ERROR');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PopoutWindow title="COMPOSER :: NEW POST" badge="[ FILE ]" onClose={onClose} maxWidth="max-w-2xl">
        <label htmlFor="new-post-title" className="block text-[10px] font-bold text-black">
          TITLE:
        </label>
        <input
          id="new-post-title"
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Subject line for the thread"
          className="mt-1 w-full rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-2 font-mono text-xs text-black outline-none"
        />

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="new-post-target" className="block text-[10px] font-bold text-black">
              FILE UNDER:
            </label>
            <div className="mt-1">
              <TreePicker
                id="new-post-target"
                groups={TARGET_TREE}
                value={targetKey}
                onChange={setTargetKey}
                openInitially={[BOARD_TARGET.group]}
              />
            </div>
          </div>

          <div>
            <span className="block text-[10px] font-bold text-black">CONTAINING MEDIA:</span>
            {isBoardPost ? (
              <div className="mt-1">
                <MediaPicker id="new-post-media" items={ARCHIVE_MEDIA} value={mediaId} onChange={setMediaId} />
              </div>
            ) : (
              <div className="mt-1 rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-2 text-[10px] font-bold text-black">
                FILED AGAINST: {anchor.label}
                <br />
                <span className="font-normal text-gray-700">
                  SHOWS UP UNDER THAT ITEM ON ITS PAGE, AND TAKES NO PICTURE OF ITS OWN.
                </span>
              </div>
            )}
          </div>
        </div>

        <p className="mt-2 text-[10px] font-bold text-black">
          FILING INTO: {target.group} :: {anchor.label} [{anchor.kind}]
          {media === undefined ? '' : ` :: ${media.label}`}
        </p>

        <CommentComposer
          id="new-post-body"
          value={body}
          onChange={setBody}
          onSubmit={handleSubmit}
          submitLabel="[ FILE POST ]"
          placeholder="Write the post... tag somebody with @name."
          author={forum.author}
          accounts={accounts}
          previewTags={previewTags}
          tags={tags}
          onTagsChange={setTags}
          busy={busy}
          error={error}
          status={status}
          rows={4}
        />
    </PopoutWindow>
  );
}
