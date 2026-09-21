'use client';

import { useState } from 'react';
import { isSiteAccount } from '../lib/auth/builtin-account';
import type { ForumComment, ForumThread } from '../lib/forum/types';
import { useAuth } from './AuthProvider';
import { useForum } from './ForumProvider';

const BUTTON =
  'cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-2 py-[2px] text-[10px] font-bold text-black hover:bg-gray-300 disabled:cursor-wait disabled:opacity-60';

const FIELD =
  'w-full rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-white p-1 text-xs text-black outline-none';

/**
 * Who may edit or remove what is already on the board.
 *
 * The board takes posts from guests, so the archive's own account is the one that
 * can rewrite a post or take it back down: `debaser.site`, the house account
 * (app/lib/auth/builtin-account.ts). Supabase enforces exactly the same rule with
 * the `is_admin()` policies in supabase/schema.sql - this hook only decides whether
 * to draw the controls, and the database refuses the write if anybody else tries
 * it. An author can still edit or remove their own row; the controls here are the
 * admin's.
 */
export function useAdmin(): boolean {
  const { user } = useAuth();

  return user !== null && isSiteAccount(user.id);
}

function failure(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

/** The admin's controls for a post: rewrite it, or take it off the board. */
export function ThreadModeration({ thread }: { thread: ForumThread }) {
  const forum = useForum();
  const admin = useAdmin();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [title, setTitle] = useState(thread.title);
  const [body, setBody] = useState(thread.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!admin) return null;

  async function save() {
    setBusy(true);
    setError(null);

    try {
      await forum.updateThread(thread.id, { title, body });
      setEditing(false);
    } catch (caught) {
      setError(failure(caught, 'THE POST COULD NOT BE SAVED.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirming) {
      setConfirming(true);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await forum.deleteThread(thread.id);
    } catch (caught) {
      setError(failure(caught, 'THE POST COULD NOT BE REMOVED.'));
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="mt-1 space-y-1 text-[10px] font-bold text-black">
      <div className="flex flex-wrap items-center gap-1">
        <span className="border border-black bg-[#000080] px-1 text-white">[ ADMIN ]</span>

        <button type="button" onClick={() => setEditing(!editing)} disabled={busy} className={BUTTON}>
          {editing ? '[ CANCEL EDIT ]' : '[ EDIT POST ]'}
        </button>

        <button type="button" onClick={() => void remove()} disabled={busy} className={BUTTON}>
          {busy ? '[ WORKING... ]' : confirming ? '[ CONFIRM REMOVE ]' : '[ REMOVE POST ]'}
        </button>

        {confirming ? <span className="text-[#800000]">CLICK AGAIN TO TAKE THE POST OFF THE BOARD.</span> : null}
      </div>

      {editing ? (
        <div className="space-y-1 border border-gray-500 bg-[#f0f0f0] p-2">
          <label htmlFor={`moderate-title-${thread.id}`} className="block">
            TITLE:
          </label>
          <input
            id={`moderate-title-${thread.id}`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={FIELD}
          />

          <label htmlFor={`moderate-body-${thread.id}`} className="block">
            POST:
          </label>
          <textarea
            id={`moderate-body-${thread.id}`}
            rows={4}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            className={FIELD}
          />

          <button type="button" onClick={() => void save()} disabled={busy} className={BUTTON}>
            {busy ? '[ SAVING... ]' : '[ SAVE POST ]'}
          </button>
        </div>
      ) : null}

      {error === null ? null : <p className="text-[#800000]">{error}</p>}
    </div>
  );
}

/** The same controls for a reply - its text, and taking it off the board. */
export function CommentModeration({ comment }: { comment: ForumComment }) {
  const forum = useForum();
  const admin = useAdmin();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [body, setBody] = useState(comment.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!admin) return null;

  async function save() {
    setBusy(true);
    setError(null);

    try {
      await forum.updateComment(comment.id, { body });
      setEditing(false);
    } catch (caught) {
      setError(failure(caught, 'THE REPLY COULD NOT BE SAVED.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirming) {
      setConfirming(true);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await forum.deleteComment(comment.id);
    } catch (caught) {
      setError(failure(caught, 'THE REPLY COULD NOT BE REMOVED.'));
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="mt-1 space-y-1 text-[10px] font-bold text-black">
      <div className="flex flex-wrap items-center gap-1">
        <span className="border border-black bg-[#000080] px-1 text-white">[ ADMIN ]</span>

        <button type="button" onClick={() => setEditing(!editing)} disabled={busy} className={BUTTON}>
          {editing ? '[ CANCEL EDIT ]' : '[ EDIT REPLY ]'}
        </button>

        <button type="button" onClick={() => void remove()} disabled={busy} className={BUTTON}>
          {busy ? '[ WORKING... ]' : confirming ? '[ CONFIRM REMOVE ]' : '[ REMOVE REPLY ]'}
        </button>

        {/* Removing a reply takes the replies to it with it, which is worth saying. */}
        {confirming ? (
          <span className="text-[#800000]">CLICK AGAIN TO REMOVE THIS REPLY AND THE REPLIES TO IT.</span>
        ) : null}
      </div>

      {editing ? (
        <div className="space-y-1 border border-gray-500 bg-[#f0f0f0] p-2">
          <label htmlFor={`moderate-comment-${comment.id}`} className="block">
            REPLY:
          </label>
          <textarea
            id={`moderate-comment-${comment.id}`}
            rows={3}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            className={FIELD}
          />

          <button type="button" onClick={() => void save()} disabled={busy} className={BUTTON}>
            {busy ? '[ SAVING... ]' : '[ SAVE REPLY ]'}
          </button>
        </div>
      ) : null}

      {error === null ? null : <p className="text-[#800000]">{error}</p>}
    </div>
  );
}
