'use client';

import { useMemo, useState } from 'react';
import { POST_TARGETS, type ForumAnchorKey } from '../lib/forum/anchors';
import { deriveTags } from '../lib/forum/tags';
import type { ForumThread } from '../lib/forum/types';
import CommentComposer from './CommentComposer';
import { useForum } from './ForumProvider';

type NewPostFormProps = {
  onCreated?: (thread: ForumThread) => void;
};

/**
 * Reddit-style composer. A post can be filed straight onto the board or onto
 * any asset / text box on the site, which is how "comments under an asset"
 * and "new threads" end up in the same list.
 */
export default function NewPostForm({ onCreated }: NewPostFormProps) {
  const forum = useForum();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [targetKey, setTargetKey] = useState<ForumAnchorKey>(POST_TARGETS[0].key);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const target = POST_TARGETS.find((option) => option.key === targetKey) ?? POST_TARGETS[0];
  const anchor = target.anchor;
  const previewTags = useMemo(() => deriveTags({ text: `${title}\n${body}`, anchor }), [title, body, anchor]);

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
      const thread = await forum.createThread({ title: trimmedTitle, body: trimmedBody, anchor });
      setTitle('');
      setBody('');
      setStatus('THREAD FILED.');
      onCreated?.(thread);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'UNKNOWN ERROR');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
      <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
        <span>NEW POST</span>
        <span>[ COMPOSE ]</span>
      </div>

      <div className="p-3">
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

        <label htmlFor="new-post-target" className="mt-3 block text-[10px] font-bold text-black">
          FILE UNDER:
        </label>
        <select
          id="new-post-target"
          value={targetKey}
          onChange={(event) => setTargetKey(event.target.value as ForumAnchorKey)}
          className="mt-1 w-full rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-2 font-mono text-xs text-black outline-none"
        >
          {POST_TARGETS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.anchor.label} [{option.anchor.kind}]
            </option>
          ))}
        </select>

        <CommentComposer
          id="new-post-body"
          value={body}
          onChange={setBody}
          onSubmit={handleSubmit}
          submitLabel="[ FILE POST ]"
          placeholder="Write the post..."
          author={forum.author}
          previewTags={previewTags}
          busy={busy}
          error={error}
          status={status}
          rows={4}
        />
      </div>
    </section>
  );
}
