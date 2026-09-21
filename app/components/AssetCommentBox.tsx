'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { threadDomId } from '../lib/forum/anchors';
import { countReplies } from '../lib/forum/format';
import { deriveTags } from '../lib/forum/tags';
import type { ForumAnchor } from '../lib/forum/types';
import CommentComposer from './CommentComposer';
import { useForum } from './ForumProvider';

type AssetCommentBoxProps = {
  /** Which asset / text box this comment box belongs to. */
  anchor: ForumAnchor;
  note?: string;
};

/**
 * Drop-in comment box for any site asset or text box.
 *
 * The first comment files a thread on the board automatically (titled
 * `RE: <anchor label>`); later comments land in the same thread, and the box
 * links straight to it via the `#thread-<id>` deep link the forum expands.
 */
export default function AssetCommentBox({ anchor, note }: AssetCommentBoxProps) {
  const forum = useForum();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [filedThreadId, setFiledThreadId] = useState<string | null>(null);

  const thread = forum.threadForAnchor(anchor);
  const commentCount = forum.commentCountForAnchor(anchor);
  const previewTags = useMemo(() => deriveTags({ text: body, anchor, maxTags: 3 }), [body, anchor]);
  const linkedThreadId = filedThreadId ?? thread?.id ?? null;

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
      const result = await forum.addComment({ body: trimmed, anchor });
      setBody('');
      setFiledThreadId(result.thread.id);
      setStatus(result.createdThread ? 'NEW THREAD OPENED ON THE BOARD.' : 'COMMENT ADDED TO THE EXISTING THREAD.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'UNKNOWN ERROR');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0]">
      <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-xs font-bold text-white">
        <span>COMMENTS: {anchor.label}</span>
        <span>[{commentCount}]</span>
      </div>

      <div className="p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold text-black">
          <span>
            SOURCE: {anchor.kind.toUpperCase()} :: ID: {anchor.id}
          </span>
          {linkedThreadId === null ? (
            <span>FIRST COMMENT OPENS A NEW THREAD</span>
          ) : (
            <Link
              href={`/forum#${threadDomId(linkedThreadId)}`}
              className="rounded-none border border-black bg-[#c0c0c0] px-2 py-[2px] underline hover:bg-gray-300"
            >
              [ OPEN THREAD ON THE BOARD ]
            </Link>
          )}
        </div>

        {note === undefined ? null : <p className="mt-2 text-[10px] text-black">{note}</p>}

        <p className="mt-2 text-[10px] text-black">EXISTING REPLIES: {countReplies(commentCount)}</p>

        <CommentComposer
          id={`comment-${anchor.id}`}
          value={body}
          onChange={setBody}
          onSubmit={handleSubmit}
          submitLabel="[ FILE COMMENT ]"
          placeholder="Leave a comment on this box..."
          author={forum.author}
          previewTags={previewTags}
          busy={busy}
          error={error}
          status={status}
          rows={3}
        />
      </div>
    </section>
  );
}
