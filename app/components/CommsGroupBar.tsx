'use client';

import { useState } from 'react';
import type { AccountUser } from '../lib/auth/types';
import { isGroupOwner } from '../lib/comms/threads';
import { MAX_GROUP_MEMBERS, MAX_GROUP_NAME_LENGTH, type CommsThread } from '../lib/comms/types';
import { FIELD, PLATE } from '../lib/ui/controls';
import ProfileName from './ProfileName';

type CommsGroupBarProps = {
  thread: CommsThread;
  userId: string;
  /** id -> display name, for the member list and the hand-over picker. */
  nameFor: (id: string) => string;
  /** Every account that could be pulled into the group. */
  accounts: AccountUser[];
  onAdd: (userId: string) => Promise<void>;
  onRename: (name: string) => Promise<void>;
  onHandOver: (userId: string) => Promise<void>;
  onRemove: (userId: string) => Promise<void>;
  onLeave: () => Promise<void>;
};

/**
 * A group's own strip: who is in it, and what may be done to it - by whom.
 *
 * The rule this draws is the one the database enforces: a group belongs to the account that
 * opened it, so **the owner's controls are the owner's** and everybody else sees the member
 * list and one button, `[ LEAVE GROUP ]`. Renaming, handing the group on and taking a member
 * out are the owner's; leaving is anybody's; an owner who leaves hands the group to the next
 * member rather than leaving nobody in charge, which is why the button says so before it is
 * pressed.
 *
 * Hiding a control is not the protection - anybody can call the API - so this is the polite
 * half of a rule that `supabase/migrations/20260922_group_ownership.sql` enforces for real.
 * What it fixes is the other half: a member being *offered* a rename box and a hand-over menu
 * on somebody else's group, which is what made a take-over look like a feature.
 */
export default function CommsGroupBar({
  thread,
  userId,
  nameFor,
  accounts,
  onAdd,
  onRename,
  onHandOver,
  onRemove,
  onLeave,
}: CommsGroupBarProps) {
  const owner = isGroupOwner(thread, userId);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [handingOver, setHandingOver] = useState(false);
  const [draftName, setDraftName] = useState(thread.name);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [confirmingRemoval, setConfirmingRemoval] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** One shape for all five: do it, say what went wrong, stop saying it when it works. */
  async function attempt(work: () => Promise<void>) {
    setBusy(true);
    setError(null);

    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'THAT COULD NOT BE DONE.');
    } finally {
      setBusy(false);
    }
  }

  const addable = accounts.filter((account) => !thread.participants.includes(account.id));
  const others = thread.participants.filter((id) => id !== userId);

  return (
    <div className="mb-2 space-y-1 text-[10px] font-bold text-ink">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setAdding(!adding)} className={PLATE}>
          {adding ? '[ CANCEL ]' : '[ + ADD MEMBER ]'}
        </button>

        {!owner ? null : (
          <>
            <button
              type="button"
              onClick={() => {
                setRenaming(!renaming);
                setDraftName(thread.name);
              }}
              className={PLATE}
            >
              {renaming ? '[ CANCEL ]' : '[ RENAME ]'}
            </button>

            <button
              type="button"
              onClick={() => setHandingOver(!handingOver)}
              disabled={others.length === 0}
              className={PLATE}
            >
              {handingOver ? '[ CANCEL ]' : '[ HAND OVER ]'}
            </button>
          </>
        )}

        <button
          type="button"
          onClick={() => {
            if (!confirmingLeave) {
              setConfirmingLeave(true);
              return;
            }

            void attempt(async () => {
              await onLeave();
              setConfirmingLeave(false);
            });
          }}
          disabled={busy}
          className={PLATE}
        >
          {busy ? '[ WORKING... ]' : confirmingLeave ? '[ CONFIRM LEAVE ]' : '[ LEAVE GROUP ]'}
        </button>

        <span className="text-ink">
          {thread.participants.length} / {MAX_GROUP_MEMBERS} IN THE GROUP ::{' '}
          {owner ? 'YOU OWN IT' : `OWNED BY ${nameFor(thread.ownerId ?? '').toUpperCase()}`}
        </span>
      </div>

      {!confirmingLeave ? null : (
        <p className="text-bubble-pale">
          LEAVING TAKES YOU OUT OF THIS GROUP
          {owner
            ? ' AND HANDS IT TO WHOEVER HAS BEEN IN IT LONGEST - IF YOU ARE THE LAST ONE, THE GROUP GOES WITH YOU'
            : ''}
          . CLICK AGAIN TO CONFIRM.
        </p>
      )}

      {!renaming ? null : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-40 flex-1" htmlFor={`group-rename-${thread.id}`}>
            <span className="block">NEW NAME ({MAX_GROUP_NAME_LENGTH} CHARACTERS OR FEWER):</span>
            <input
              id={`group-rename-${thread.id}`}
              type="text"
              value={draftName}
              maxLength={MAX_GROUP_NAME_LENGTH}
              onChange={(event) => setDraftName(event.target.value)}
              className={FIELD}
            />
          </label>

          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void attempt(async () => {
                await onRename(draftName);
                setRenaming(false);
              })
            }
            className={PLATE}
          >
            [ SAVE NAME ]
          </button>
        </div>
      )}

      {!handingOver ? null : (
        <ul className="space-y-1">
          <li className="text-ink">HAND THIS GROUP TO:</li>
          {others.map((id) => (
            <li key={id}>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void attempt(async () => {
                    await onHandOver(id);
                    setHandingOver(false);
                  })
                }
                className={`${PLATE} w-full max-w-md text-left`}
              >
                {nameFor(id)}
                {id === thread.ownerId ? ' [ ALREADY THE OWNER ]' : ''}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Who is in it: a head count cannot show that the account somebody just added landed. */}
      <ul className="flex w-full flex-wrap items-center gap-1">
        {thread.participants.map((id) => (
          <li key={id} className="border border-ink bg-paper px-1">
            <ProfileName author={{ id, displayName: nameFor(id) }} lamp={false} />
            {id === userId ? <span className="ml-1 text-ink">[ YOU ]</span> : null}
            {id === thread.ownerId ? <span className="ml-1 text-ink">[ OWNER ]</span> : null}

            {/* The owner may take anybody but themselves out - taking yourself out is leaving. */}
            {!owner || id === userId ? null : (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (confirmingRemoval !== id) {
                    setConfirmingRemoval(id);
                    return;
                  }

                  void attempt(async () => {
                    await onRemove(id);
                    setConfirmingRemoval(null);
                  });
                }}
                className="ml-1 cursor-pointer text-bubble-pale underline hover:bg-sun-pale"
              >
                {confirmingRemoval === id ? 'SURE?' : 'remove'}
              </button>
            )}
          </li>
        ))}
      </ul>

      {!adding ? null : addable.length === 0 ? (
        <p className="text-ink">THERE IS NOBODY LEFT TO ADD.</p>
      ) : (
        <ul className="space-y-1">
          {addable.map((account) => (
            <li key={account.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void attempt(() => onAdd(account.id))}
                className={`${PLATE} w-full max-w-md text-left`}
              >
                + {account.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error === null ? null : <p className="text-bubble-pale">{error}</p>}
    </div>
  );
}

