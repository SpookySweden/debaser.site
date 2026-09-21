'use client';

import { useEffect, useMemo, useState } from 'react';
import { ARCHIVE_MEDIA } from '../lib/concepts/sheets';
import { BOARD_TARGET, POST_TARGETS, postTargetGroups } from '../lib/forum/anchors';
import { deriveTags } from '../lib/forum/tags';
import type { ForumThread } from '../lib/forum/types';
import CommentComposer from './CommentComposer';
import { useForum } from './ForumProvider';
import PopoutWindow from './PopoutWindow';
import SheetImage from './SheetImage';

/** Page sub-menus for the drop-down; a plain board post leads the list. */
const TARGET_GROUPS = postTargetGroups();

type NewPostFormProps = {
  onClose: () => void;
  onCreated?: (thread: ForumThread) => void;
};

/**
 * The composer, presented as a Win95 pop-up window.
 *
 * It stays out of the way until the board's [+ NEW POST...] control opens it: a
 * post can be filed straight onto the board (with attached media) or onto any
 * item on the site, which is how "comments under an asset" and "new threads"
 * end up in the same list.
 */
export default function NewPostForm({ onClose, onCreated }: NewPostFormProps) {
  const forum = useForum();
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
            <select
              id="new-post-target"
              value={targetKey}
              onChange={(event) => setTargetKey(event.target.value)}
              className="mt-1 w-full rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-2 font-mono text-xs text-black outline-none"
            >
              <option value={BOARD_TARGET.key}>
                {BOARD_TARGET.anchor.label} - GENERAL FORUM POST
              </option>
              {TARGET_GROUPS.map((entry) => (
                <optgroup key={entry.group} label={entry.group}>
                  {entry.targets.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.anchor.label} [{option.anchor.kind}]
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {isBoardPost ? (
            <div>
              <label htmlFor="new-post-media" className="block text-[10px] font-bold text-black">
                CONTAINING MEDIA:
              </label>
              <select
                id="new-post-media"
                value={mediaId}
                onChange={(event) => setMediaId(event.target.value)}
                className="mt-1 w-full rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-2 font-mono text-xs text-black outline-none"
              >
                <option value="">NONE - TEXT ONLY</option>
                {ARCHIVE_MEDIA.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="rounded-none border border-gray-500 bg-[#f0f0f0] p-2 text-[10px] font-bold text-black">
              FILED AGAINST: {anchor.label}
              <br />
              SHOWS UP UNDER THAT ITEM ON ITS PAGE.
            </div>
          )}
        </div>

        {media === undefined ? null : (
          <div className="mt-2 flex flex-wrap items-center gap-2 border border-gray-500 bg-[#f0f0f0] p-2">
            <span className="text-[10px] font-bold text-black">ATTACHED:</span>
            <span className="w-20 border border-gray-600 bg-white p-1">
              <SheetImage
                src={media.preview.src}
                alt={media.preview.alt}
                width={media.preview.width}
                height={media.preview.height}
                sizes="80px"
              />
            </span>
            <span className="text-[10px] font-bold text-black">{media.label}</span>
            <button
              type="button"
              onClick={() => setMediaId('')}
              className="cursor-pointer rounded-none border-t border-l border-white border-r border-b border-black bg-[#c0c0c0] px-2 py-[3px] text-[10px] font-bold text-black hover:bg-gray-300"
            >
              [ REMOVE MEDIA ]
            </button>
          </div>
        )}

        <p className="mt-2 text-[10px] font-bold text-black">
          FILING INTO: {target.group} :: {anchor.label} [{anchor.kind}]
        </p>

        <CommentComposer
          id="new-post-body"
          value={body}
          onChange={setBody}
          onSubmit={handleSubmit}
          submitLabel="[ FILE POST ]"
          placeholder="Write the post..."
          author={forum.author}
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
