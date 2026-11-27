'use client';

import { useState } from 'react';
import { isSiteAccount } from '../lib/auth/builtin-account';
import type { ForumAuthor, ForumComment, ForumThread } from '../lib/forum/types';
import { FIELD, PLATE } from '../lib/ui/controls';
import { getModerationStore } from '../lib/moderation/repository';
import { useAuth } from './AuthProvider';
import { useForum } from './ForumProvider';
import { HideControl } from './ModerationKeys';
import { useModeration } from './ModerationProvider';
import { NOTE, explain } from '../lib/ui/explain';

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
  // The moderator list (SPEC-moderation.md, 1A), read from the database's `moderators` table, not the house account. What a moderator
  // can do anywhere (COMIC's studio asks this too); the tools drawn over the page ask `useModTools` instead.
  return useModeration().role.moderator;
}

/**
 * The moderator tools drawn on the page (the ADMIN and MOD rows, HIDE, BAN, the pin panel, a canvas's HIDE): only while the moderator
 * has them showing, with the `[ ⛨ MOD ]` key after their name, top right. Hidden by default (Luke, 2026-11-20: "make the settings
 * hidden by default instead of covering the page").
 */
export function useModTools(): boolean {
  return useModeration().toolsOn;
}

function failure(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

/**
 * The admin's controls for the account behind a post or a reply.
 *
 * A ban is heavier than removing a post: it stops that account writing anywhere, and
 * it hides what it has already written from everybody but the admin
 * (supabase/schema.sql, section 12). So the button asks for the reason in the
 * archive's own words first, and the row says `[ BANNED ]` once it is on - otherwise
 * a name that has gone quiet would look like it had simply stopped posting.
 *
 * Guests write with no account behind them, and the house account is never the one
 * to ban, so both get no controls at all.
 */
export function AuthorModeration({ author }: { author: ForumAuthor }) {
  const auth = useAuth();
  const moderation = useModeration();
  const admin = useModTools();
  const [naming, setNaming] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accountId = author.id;
  if (!admin || accountId === null || isSiteAccount(accountId)) return null;

  async function ban() {
    if (accountId === null) return;

    setBusy(true);
    setError(null);

    try {
      if (auth.user === null) return;
      // Through the moderators' function, which writes the log (SPEC-moderation.md, 9A).
      await getModerationStore().ban(auth.user.id, accountId, reason.trim());
      moderation.refresh();
      setNaming(false);
      setReason('');
    } catch (caught) {
      setError(failure(caught, 'THAT ACCOUNT COULD NOT BE BANNED.'));
    } finally {
      setBusy(false);
    }
  }

  async function lift() {
    if (accountId === null) return;

    setBusy(true);
    setError(null);

    try {
      if (auth.user === null) return;
      await getModerationStore().unban(auth.user.id, accountId);
      moderation.refresh();
    } catch (caught) {
      setError(failure(caught, 'THAT BAN COULD NOT BE LIFTED.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {author.banned === true ? (
        <span className="border border-ink-plate bg-bubble-pale px-1 text-ink-bar">[ BANNED ]</span>
      ) : null}

      {author.banned === true ? (
        <button
          type="button"
          onClick={() => void lift()}
          disabled={busy}
          className={PLATE}
          {...explain(
            'Lifts the ban on this account: it can write again, and what it wrote shows again.',
            undefined,
            NOTE.moderators,
          )}
        >
          {busy ? '[ WORKING... ]' : '[ UNBAN ]'}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setNaming(!naming)}
          disabled={busy}
          className={PLATE}
          {...explain(
            naming ? 'Folds the ban form away without banning anyone.' : 'Opens a box for the reason, before the ban itself.',
            'A ban stops the account writing anywhere on the site and hides what it has written from everybody but moderators.',
            NOTE.moderators,
          )}
        >
          {naming ? '[ CANCEL BAN ]' : '[ BAN ]'}
        </button>
      )}

      {naming ? (
        <span className="inline-flex w-full flex-wrap items-center gap-1">
          <label htmlFor={`ban-reason-${accountId}`}>REASON:</label>
          <input
            id={`ban-reason-${accountId}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="OFF-TOPIC, ABUSE, SPAM..."
            className={FIELD}
          />

          <button
            type="button"
            onClick={() => void ban()}
            disabled={busy}
            className={PLATE}
            {...explain(
              'Bans this account, with the reason typed beside it written to the moderation log.',
              'A ban stops the account writing anywhere on the site and hides what it has written from everybody but moderators. UNBAN lifts it.',
              NOTE.moderators,
            )}
          >
            {busy ? '[ BANNING... ]' : '[ CONFIRM BAN ]'}
          </button>

          <span className="bg-bubble-pale px-1 text-ink-bar">
            BLOCKS WRITING; HIDES THEIR POSTS.
          </span>
        </span>
      ) : null}

      {error === null ? null : <span className="bg-bubble-pale px-1 text-ink-bar">{error}</span>}
    </span>
  );
}

/** The admin's controls for a post: rewrite it, or take it off the board. */
export function ThreadModeration({ thread }: { thread: ForumThread }) {
  const forum = useForum();
  const moderation = useModeration();
  const admin = moderation.toolsOn;
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
    <div className="mt-1 space-y-1 text-label font-bold text-ink">
      <div className="flex flex-wrap items-center gap-1">
        <span className="border border-ink-plate bg-ena px-1 text-ink-bar">[ ADMIN ]</span>

        <button
          type="button"
          onClick={() => setEditing(!editing)}
          disabled={busy}
          className={PLATE}
          {...explain(
            editing ? 'Closes the editor without saving the changes.' : "Opens this post's title and words for rewriting.",
            'Moderators can correct any post on the board.',
            NOTE.moderators,
          )}
        >
          {editing ? '[ CANCEL EDIT ]' : '[ EDIT POST ]'}
        </button>

        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy}
          className={PLATE}
          {...explain(
            confirming
              ? 'Second press: deletes this post from the board for good.'
              : 'Deletes this post from the board. The first press only asks; a second press does it.',
            'For a post that breaks the rules. A post can also be edited instead.',
            NOTE.undo,
          )}
        >
          {busy ? '[ WORKING... ]' : confirming ? '[ CONFIRM REMOVE ]' : '[ REMOVE POST ]'}
        </button>

        <HideControl kind="thread" id={thread.id} authorId={thread.author.id} text={`${thread.title} :: ${thread.body}`} mark={moderation.markFor('thread', thread.id, thread.hidden)} />

        <AuthorModeration author={thread.author} />
      </div>

      {editing ? (
        <div className="space-y-1 border border-ink bg-ice-pale p-2">
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

          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className={PLATE}
            {...explain('Saves the rewritten title and words over the post.', 'Everyone reading the board sees the new version.', NOTE.moderators)}
          >
            {busy ? '[ SAVING... ]' : '[ SAVE POST ]'}
          </button>
        </div>
      ) : null}

      {error === null ? null : <p className="w-fit bg-bubble-pale px-1 text-ink-bar">{error}</p>}
    </div>
  );
}

/** The same controls for a reply - its text, and taking it off the board. */
export function CommentModeration({ comment }: { comment: ForumComment }) {
  const forum = useForum();
  const moderation = useModeration();
  const admin = moderation.toolsOn;
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
    <div className="mt-1 space-y-1 text-label font-bold text-ink">
      <div className="flex flex-wrap items-center gap-1">
        <span className="border border-ink-plate bg-ena px-1 text-ink-bar">[ ADMIN ]</span>

        <button
          type="button"
          onClick={() => setEditing(!editing)}
          disabled={busy}
          className={PLATE}
          {...explain(
            editing ? 'Closes the editor without saving the changes.' : "Opens this reply's words for rewriting.",
            'Moderators can correct any reply on the board.',
            NOTE.moderators,
          )}
        >
          {editing ? '[ CANCEL EDIT ]' : '[ EDIT REPLY ]'}
        </button>

        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy}
          className={PLATE}
          {...explain(
            confirming
              ? 'Second press: deletes this reply from the board for good.'
              : 'Deletes this reply from the board. The first press only asks; a second press does it.',
            'For a reply that breaks the rules. A reply can also be edited instead.',
            NOTE.undo,
          )}
        >
          {busy ? '[ WORKING... ]' : confirming ? '[ CONFIRM REMOVE ]' : '[ REMOVE REPLY ]'}
        </button>

        <HideControl kind="reply" id={comment.id} authorId={comment.author.id} text={comment.body} mark={moderation.markFor('reply', comment.id, comment.hidden)} />

        <AuthorModeration author={comment.author} />

        {/* Removing a reply takes the replies to it with it, which is worth saying. */}
        {confirming ? (
          <span className="bg-bubble-pale px-1 text-ink-bar">REMOVES ITS REPLIES TOO.</span>
        ) : null}
      </div>

      {editing ? (
        <div className="space-y-1 border border-ink bg-ice-pale p-2">
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

          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className={PLATE}
            {...explain('Saves the rewritten words over the reply.', 'Everyone reading the board sees the new version.', NOTE.moderators)}
          >
            {busy ? '[ SAVING... ]' : '[ SAVE REPLY ]'}
          </button>
        </div>
      ) : null}

      {error === null ? null : <p className="w-fit bg-bubble-pale px-1 text-ink-bar">{error}</p>}
    </div>
  );
}
