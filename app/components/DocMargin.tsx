'use client';

import type { Editor } from '@tiptap/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { positionOf } from '../lib/docs/anchors';
import { commentMarksKey, type CommentRange } from '../lib/docs/comment-marks';
import { getDocsRepository } from '../lib/docs/repository';
import type { DocComment, DocRole, DocViewer } from '../lib/docs/types';
import { FIELD, PLATE, PLATE_MAIN, TITLE_BAR } from '../lib/ui/controls';
import TimeStamp from './TimeStamp';

/** Words picked for a new comment: where they are (relative places) and what they say. */
export type CommentDraft = {
  anchorFrom: string;
  anchorTo: string;
  quote: string;
};

type DocMarginProps = {
  editor: Editor | null;
  docId: string;
  viewer: DocViewer | null;
  role: DocRole;
  draft: CommentDraft | null;
  onDraftDone: () => void;
};

/** How often the comments are read again, so one left by someone else turns up. */
const REREAD_MS = 15_000;
const GAP = 8;

/**
 * Margin comments: each beside the words it was left on, with its replies, resolvable.
 *
 * A comment's place is two Yjs relative positions (../lib/docs/anchors.ts), so it stays on its words
 * while the text around it changes. On a wide screen each sits level with its words (pushed down when
 * two would overlap); on a phone they are a list under the document, in the order their words come.
 */
export default function DocMargin({ editor, docId, viewer, role, draft, onDraftDone }: DocMarginProps) {
  const repository = useMemo(() => getDocsRepository(viewer?.id ?? null), [viewer?.id]);
  const [comments, setComments] = useState<DocComment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [textTick, setTextTick] = useState(0);
  const [tops, setTops] = useState<Record<string, number>>({});
  const [height, setHeight] = useState(0);
  const [wide, setWide] = useState(false);
  const list = useRef<HTMLDivElement | null>(null);
  const editing = role === 'owner' || role === 'edit';

  const read = useCallback(() => {
    repository
      .listComments(docId)
      .then((rows) => {
        setComments(rows);
        setError(null);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'COMMENTS DID NOT LOAD.'));
  }, [docId, repository]);

  useEffect(() => {
    read();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') read();
    }, REREAD_MS);
    return () => window.clearInterval(timer);
  }, [read]);

  // Text changes move the words a comment sits on.
  useEffect(() => {
    if (editor === null) return;
    let frameId = 0;
    const bump = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => setTextTick((value) => value + 1));
    };
    editor.on('update', bump);
    window.addEventListener('resize', bump);
    return () => {
      cancelAnimationFrame(frameId);
      editor.off('update', bump);
      window.removeEventListener('resize', bump);
    };
  }, [editor]);

  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const update = () => setWide(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const top = useMemo(() => comments.filter((comment) => comment.parentId === null), [comments]);
  const repliesOf = (id: string) => comments.filter((comment) => comment.parentId === id);

  // Where each comment's words are now.
  const placed = useMemo(() => {
    void textTick;
    return top.map((comment) => {
      const from = editor === null || comment.anchorFrom === null ? null : positionOf(editor, comment.anchorFrom);
      const to = editor === null || comment.anchorTo === null ? null : positionOf(editor, comment.anchorTo);
      return { comment, from, to };
    });
  }, [editor, textTick, top]);

  const ordered = useMemo(
    () =>
      [...placed]
        .filter((entry) => showResolved || !entry.comment.resolved)
        .sort((left, right) => (left.from ?? Number.MAX_SAFE_INTEGER) - (right.from ?? Number.MAX_SAFE_INTEGER)),
    [placed, showResolved],
  );

  // The shading in the document.
  useEffect(() => {
    if (editor === null || editor.isDestroyed) return;
    const ranges: CommentRange[] = placed
      .filter((entry) => !entry.comment.resolved && entry.from !== null && entry.to !== null)
      .map((entry) => ({
        id: entry.comment.id,
        from: entry.from ?? 0,
        to: entry.to ?? 0,
        active: entry.comment.id === active,
      }));
    editor.view.dispatch(editor.state.tr.setMeta(commentMarksKey, ranges).setMeta('addToHistory', false));
  }, [active, editor, placed]);

  // Level with the words, pushed down where two would overlap.
  // Measured a frame after drawing, so each card's height is its real one.
  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      const box = list.current;
      if (!wide || editor === null || editor.isDestroyed || box === null) return;

      const area = box.getBoundingClientRect();
      const next: Record<string, number> = {};
      let cursor = 0;
      const want = (from: number | null) => {
        if (from === null) return cursor;
        try {
          return editor.view.coordsAtPos(from).top - area.top;
        } catch {
          return cursor;
        }
      };

      const entries: { id: string; from: number | null }[] = [
        ...(draft === null ? [] : [{ id: 'draft', from: positionOf(editor, draft.anchorFrom) }]),
        ...ordered.map((entry) => ({ id: entry.comment.id, from: entry.from })),
      ].sort((left, right) => want(left.from) - want(right.from));

      for (const entry of entries) {
        const at = Math.max(want(entry.from), cursor);
        next[entry.id] = Math.round(at);
        const card = box.querySelector<HTMLElement>(`[data-card="${entry.id}"]`);
        cursor = at + (card?.offsetHeight ?? 60) + GAP;
      }

      const same = Object.keys(next).length === Object.keys(tops).length && Object.entries(next).every(([id, value]) => tops[id] === value);
      if (!same) setTops(next);
      if (Math.round(cursor) !== height) setHeight(Math.round(cursor));
    });
    return () => cancelAnimationFrame(frameId);
  }, [draft, editor, height, ordered, tops, wide]);

  const place = (id: string) => (wide && tops[id] !== undefined ? { position: 'absolute' as const, top: tops[id], left: 0, right: 0 } : undefined);

  async function leave(): Promise<void> {
    if (viewer === null || draft === null || body.trim().length === 0) return;
    setBusy(true);
    try {
      await repository.addComment({
        docId,
        parentId: null,
        body,
        anchorFrom: draft.anchorFrom,
        anchorTo: draft.anchorTo,
        quote: draft.quote,
        viewer,
      });
      setBody('');
      onDraftDone();
      read();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'THE COMMENT WAS NOT LEFT.');
    } finally {
      setBusy(false);
    }
  }

  async function answer(parentId: string): Promise<void> {
    if (viewer === null || reply.trim().length === 0) return;
    setBusy(true);
    try {
      await repository.addComment({
        docId,
        parentId,
        body: reply,
        anchorFrom: null,
        anchorTo: null,
        quote: '',
        viewer,
      });
      setReply('');
      setReplyTo(null);
      read();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'THE REPLY WAS NOT LEFT.');
    } finally {
      setBusy(false);
    }
  }

  async function act(work: () => Promise<void>): Promise<void> {
    try {
      await work();
      read();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'NOT CHANGED.');
    }
  }

  const resolvedCount = top.filter((comment) => comment.resolved).length;

  return (
    <aside className="min-w-0" aria-label="Margin comments">
      <div className={TITLE_BAR}>
        <span>COMMENTS</span>
        {resolvedCount === 0 ? null : (
          <button type="button" className={PLATE} onClick={() => setShowResolved((value) => !value)}>
            {showResolved ? '[ HIDE RESOLVED ]' : `[ RESOLVED ${resolvedCount} ]`}
          </button>
        )}
      </div>

      {error === null ? null : <p className="my-1 w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">{error}</p>}

      <div ref={list} className="relative" style={wide ? { minHeight: height } : undefined}>
        {draft === null ? null : (
          <section data-card="draft" className="doc-margin-card bg-paper" style={place('draft')}>
            <p className="doc-margin-quote">“{draft.quote}”</p>
            <label className="sr-only" htmlFor="doc-comment-new">
              Comment
            </label>
            <textarea
              id="doc-comment-new"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={2000}
              rows={3}
              className={FIELD}
              autoFocus
            />
            <div className="mt-1 flex flex-wrap gap-2">
              <button type="button" className={PLATE_MAIN} disabled={busy || body.trim().length === 0} onClick={() => void leave()}>
                [ ADD COMMENT ]
              </button>
              <button type="button" className={PLATE} onClick={onDraftDone}>
                [ CANCEL ]
              </button>
            </div>
          </section>
        )}

        {ordered.length === 0 && draft === null ? <p className="py-1 text-label text-ink">NONE YET.</p> : null}

        {ordered.map(({ comment, from }) => {
          const mine = viewer !== null && comment.authorId === viewer.id;
          return (
            <section
              key={comment.id}
              data-card={comment.id}
              className={`doc-margin-card bg-paper ${active === comment.id ? 'doc-margin-card--on' : ''}`}
              style={place(comment.id)}
              data-comment-card={comment.id}
              onPointerEnter={() => setActive(comment.id)}
              onPointerLeave={() => setActive((current) => (current === comment.id ? null : current))}
            >
              {comment.quote.length === 0 ? null : (
                <p className="doc-margin-quote">
                  “{comment.quote}”{from === null ? ' (WORDS GONE)' : ''}
                </p>
              )}
              <p className="text-label font-bold text-ink">
                {comment.authorLabel} <TimeStamp at={comment.createdAt} />
                {comment.resolved ? ` :: RESOLVED${comment.resolvedByLabel === null ? '' : ` BY ${comment.resolvedByLabel}`}` : ''}
              </p>
              <p className="whitespace-pre-wrap break-words text-label text-ink">{comment.body}</p>

              {repliesOf(comment.id).map((answerRow) => (
                <div key={answerRow.id} className="mt-1 border-l-line border-ink pl-2">
                  <p className="text-label font-bold text-ink">
                    {answerRow.authorLabel} <TimeStamp at={answerRow.createdAt} />
                  </p>
                  <p className="whitespace-pre-wrap break-words text-label text-ink">{answerRow.body}</p>
                  {viewer !== null && answerRow.authorId === viewer.id ? (
                    <button type="button" className={PLATE} onClick={() => void act(() => repository.deleteComment(answerRow.id))}>
                      [ DELETE ]
                    </button>
                  ) : null}
                </div>
              ))}

              {replyTo === comment.id ? (
                <div className="mt-1">
                  <label className="sr-only" htmlFor={`doc-reply-${comment.id}`}>
                    Reply
                  </label>
                  <textarea
                    id={`doc-reply-${comment.id}`}
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    maxLength={2000}
                    rows={2}
                    className={FIELD}
                    autoFocus
                  />
                  <div className="mt-1 flex flex-wrap gap-2">
                    <button type="button" className={PLATE} disabled={busy || reply.trim().length === 0} onClick={() => void answer(comment.id)}>
                      [ SEND ]
                    </button>
                    <button type="button" className={PLATE} onClick={() => setReplyTo(null)}>
                      [ CANCEL ]
                    </button>
                  </div>
                </div>
              ) : editing && viewer !== null ? (
                <div className="mt-1 flex flex-wrap gap-2">
                  <button type="button" className={PLATE} onClick={() => setReplyTo(comment.id)}>
                    [ REPLY ]
                  </button>
                  <button
                    type="button"
                    className={PLATE}
                    onClick={() => void act(() => repository.setResolved(comment.id, !comment.resolved, viewer))}
                  >
                    {comment.resolved ? '[ REOPEN ]' : '[ RESOLVE ]'}
                  </button>
                  {mine || role === 'owner' ? (
                    <button type="button" className={PLATE} onClick={() => void act(() => repository.deleteComment(comment.id))}>
                      [ DELETE ]
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
