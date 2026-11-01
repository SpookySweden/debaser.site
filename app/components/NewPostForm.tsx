'use client';

import { useEffect, useMemo, useState } from 'react';
import { TRACK_TARGET_GROUP, forumTrackFromArchive, trackTargetKey, trackTargets } from '../lib/audio/forum-tracks';
import { useCatalogue } from '../lib/media/catalogue';
import { postUse, previewFor, recordUses, replyUse } from '../lib/media/uses';
import { AUTO_FILED_BODY, BOARD_TARGET, POST_TARGETS, autoThreadTitle, postTargetTree } from '../lib/forum/anchors';
import { countReplies } from '../lib/forum/format';
import { mentionsIn } from '../lib/forum/mentions';
import { deriveTags } from '../lib/forum/tags';
import type { ForumThread, ForumTrack } from '../lib/forum/types';
import CommentComposer from './CommentComposer';
import { useComms } from './CommsProvider';
import { useForum } from './ForumProvider';
import { useMusicPlayer } from './MusicPlayerProvider';
import { useNotifications } from './NotificationsProvider';
import PicturePicker from './PicturePicker';
import PopoutWindow from './PopoutWindow';
import TreePicker from './TreePicker';

/** Destinations as folders and items, the shape a file dialog draws. */
const TARGET_TREE = postTargetTree();

type NewPostFormProps = {
  onClose: () => void;
  onCreated?: (thread: ForumThread) => void;
  /**
   * A track to start with, for the screens that open this window *because* of one: the music
   * directory's `[ INJECT ]` opens the composer with that file already filed, so the two presses
   * it costs are "start a post about this" and "file it".
   */
  initialTrack?: ForumTrack | null;
  /**
   * The destination to start on, as a key of the FILE UNDER tree. The music directory passes the
   * track's own key (`trackTargetKey`), so a post written from a row is filed *under* that track
   * rather than onto the board with the file attached.
   */
  initialTarget?: string;
};

/**
 * The composer, presented as a Win95 pop-up window.
 *
 * It stays out of the way until something opens it: the board's `+ NEW POST` key, or the
 * music directory's `[ INJECT ]` on a row, which opens it filed under that track. A post can be
 * filed straight onto the board (with attached media) or onto any item on the site - a sheet, a
 * text box, a track on the shelf.
 *
 * Filed onto an item, the words are a *comment* on that item's one thread, not a thread of their
 * own: the database keeps one thread per item (`forum_threads_anchor_key`), so a second titled post
 * under the same sheet used to fail with a duplicate-key error. The composer now opens the item's
 * thread if it has none (`COMMENTS ON <item>`, with the track on it when the item is one) and files
 * the comment there, which is also what the item's own comment box does - so the board, the box and
 * this window all read one thread per item (Luke, 2026-10-24).
 *
 * The window is organised the way a file dialog is, in two columns rather than two long
 * drop-downs: the destination is a tree of pages you open and click into, and the artwork is a pane
 * of thumbnails with the chosen sheet beside it. Both already show what is chosen, so the
 * `FILING INTO:` line that restated it in words was cut (SPEC-efficiency.md). Nothing here draws
 * artwork - a sheet is a file in the project assets folder, and the picker only points at it
 * (CLAUDE.md).
 */
export default function NewPostForm({ onClose, onCreated, initialTrack = null, initialTarget }: NewPostFormProps) {
  const forum = useForum();
  const { accounts } = useComms();
  const notifications = useNotifications();
  // The shelf, so every track on it is a destination: a post can be filed under a song the way it
  // is filed under a sheet (app/lib/audio/forum-tracks.ts, `trackAnchor`).
  const { queue } = useMusicPlayer();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [targetKey, setTargetKey] = useState<string>(initialTarget ?? POST_TARGETS[0].key);
  const [mediaId, setMediaId] = useState('');
  const [track, setTrack] = useState<ForumTrack | null>(initialTrack);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const musicTargets = useMemo(() => trackTargets(queue), [queue]);
  const targetTree = useMemo(
    () =>
      musicTargets.length === 0
        ? TARGET_TREE
        : [
            ...TARGET_TREE,
            {
              label: TRACK_TARGET_GROUP,
              items: musicTargets.map((entry) => ({ key: entry.key, label: entry.anchor.label, note: 'track' })),
            },
          ],
    [musicTargets],
  );
  const target =
    POST_TARGETS.find((option) => option.key === targetKey) ??
    musicTargets.find((option) => option.key === targetKey) ??
    POST_TARGETS[0];
  const anchor = target.anchor;
  const isBoardPost = target.key === BOARD_TARGET.key;
  // Filed under a track, the post carries that file: the subject is what plays at the top of the
  // thread, so the MP3 control is not offered - there is nothing else to attach.
  const subjectTrack = useMemo(() => {
    if (anchor.kind !== 'track') return null;
    const file = queue.find((entry) => trackTargetKey(entry) === anchor.id);
    return file === undefined ? null : forumTrackFromArchive(file);
  }, [anchor, queue]);
  /**
   * Threads this window opened itself, by anchor id. The board's own list only learns of a new
   * thread when the repository's subscription delivers it, so a second comment filed from the same
   * window before then would open the item's thread twice - which the database refuses (one thread
   * per item, `forum_threads_anchor_key`).
   */
  const [openedHere, setOpenedHere] = useState<Record<string, ForumThread>>({});
  /** The item's thread, when it already has one: the comment joins it rather than opening another. */
  const existingThread = isBoardPost ? undefined : (forum.threadForAnchor(anchor) ?? openedHere[anchor.id]);
  const catalogue = useCatalogue();
  const media = previewFor(catalogue.items, mediaId);
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

    if (isBoardPost && trimmedTitle.length < 4) {
      setError('TITLE MUST BE AT LEAST 4 CHARACTERS.');
      setStatus(null);
      return;
    }

    if (trimmedBody.length < 4) {
      setError(`${isBoardPost ? 'POST BODY' : 'COMMENT'} MUST BE AT LEAST 4 CHARACTERS.`);
      setStatus(null);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      let thread: ForumThread;
      let status: string;

      if (isBoardPost) {
        thread = await forum.createThread({
          title: trimmedTitle,
          body: trimmedBody,
          anchor,
          userTags: tags,
          media,
          ...(track === null ? {} : { track }),
        });
        recordUses(catalogue.items, postUse(thread, forum.author.id), { mediaId, preview: media, ...(track === null ? {} : { track }) });
        status = 'THREAD FILED.';
      } else {
        // The item's one thread, opened here if nothing has been said about it yet - the track
        // itself rides on the thread, so it plays at the top rather than on every comment.
        const commentInput = {
          body: trimmedBody,
          userTags: tags,
          ...(subjectTrack === null && track !== null ? { track } : {}),
        };
        let opened = false;

        if (existingThread === undefined) {
          try {
            const home = await forum.createThread({
              title: autoThreadTitle(anchor),
              body: AUTO_FILED_BODY,
              anchor,
              userTags: [],
              ...(subjectTrack === null ? {} : { track: subjectTrack }),
            });
            opened = true;
            setOpenedHere((current) => ({ ...current, [anchor.id]: home }));

            try {
              const filed = await forum.addComment({ threadId: home.id, ...commentInput });
              thread = filed.thread;
              recordUses(catalogue.items, replyUse(filed.comment, thread, forum.author.id), commentInput);
            } catch (caught) {
              // Opened and then not commented on would leave an empty thread on the board: take it
              // down again, and let the comment's own refusal be the one that is shown.
              await forum.deleteThread(home.id).catch(() => undefined);
              setOpenedHere((current) => {
                const next = { ...current };
                delete next[anchor.id];
                return next;
              });
              throw caught;
            }
          } catch (caught) {
            if (opened) throw caught;
            // Somebody else opened the item's thread since the board was last read: the repository
            // finds it by its anchor and files the comment there, as the item's own comment box does.
            const filed = await forum.addComment({ anchor, ...commentInput });
            thread = filed.thread;
            recordUses(catalogue.items, replyUse(filed.comment, thread, forum.author.id), commentInput);
          }
        } else {
          const filed = await forum.addComment({ threadId: existingThread.id, ...commentInput });
          thread = filed.thread;
          recordUses(catalogue.items, replyUse(filed.comment, thread, forum.author.id), commentInput);
        }

        status = opened ? 'FILED.' : 'COMMENT FILED.';
      }

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
      setTrack(null);
      setStatus(status);
      onCreated?.(thread);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'UNKNOWN ERROR');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PopoutWindow title="NEW POST" onClose={onClose} maxWidth="max-w-2xl">
        {/* An item's thread has its title already (`COMMENTS ON <item>`), so the field is only asked
            for on a post of the board's own. */}
        {isBoardPost ? (
          <>
            <label htmlFor="new-post-title" className="block text-label font-bold text-ink">
              TITLE:
            </label>
            <input
              id="new-post-title"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1 w-full frame bg-paper p-2 font-mono text-prose text-ink outline-none max-sm:min-h-tap"
            />
          </>
        ) : null}

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="new-post-target" className="block text-label font-bold text-ink">
              FILE UNDER:
            </label>
            <div className="mt-1">
              <TreePicker
                id="new-post-target"
                groups={targetTree}
                value={targetKey}
                onChange={setTargetKey}
                openInitially={[BOARD_TARGET.group]}
              />
            </div>
          </div>

          <div>
            {isBoardPost ? (
              <PicturePicker id="new-post-media" value={mediaId} onChange={setMediaId} author={forum.author} heightClass="h-28" />
            ) : (
              <div className="p-2 text-label font-bold text-ink">
                COMMENT ON: {anchor.label}
                <br />
                <span className="text-ink-quiet">
                  {existingThread === undefined
                    ? 'NEW THREAD'
                    : countReplies(existingThread.comments.length)}
                </span>
              </div>
            )}
          </div>
        </div>

        <CommentComposer
          id="new-post-body"
          value={body}
          onChange={setBody}
          onSubmit={handleSubmit}
          submitLabel={isBoardPost ? '[ FILE POST ]' : '[ FILE COMMENT ]'}
          placeholder={isBoardPost ? 'Write the post...' : 'Write the comment...'}
          author={forum.author}
          accounts={accounts}
          previewTags={previewTags}
          tags={tags}
          onTagsChange={setTags}
          track={subjectTrack ?? track}
          onTrackChange={subjectTrack === null ? setTrack : undefined}
          busy={busy}
          error={error}
          status={status}
          rows={4}
        />
    </PopoutWindow>
  );
}
