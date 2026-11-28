'use client';

import { useState } from 'react';
import type { AccountUser } from '../lib/auth/types';
import { isGroupOwner } from '../lib/comms/threads';
import { MAX_GROUP_MEMBERS, MAX_GROUP_NAME_LENGTH, type CommsThread } from '../lib/comms/types';
import { FIELD, PLATE } from '../lib/ui/controls';
import ProfileName from './ProfileName';
import { explain, NOTE } from '../lib/ui/explain';

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
 * half of a rule that `supabase/migrations/20260922000016_group_ownership.sql` enforces for real.
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
    <div className="mb-2 space-y-1 text-label font-bold text-ink">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setAdding(!adding)} className={PLATE} {...explain(adding ? 'Closes the list without adding anybody.' : 'Lists the accounts that are not in this group yet.', adding ? 'The group stays as it was.' : 'To bring somebody else into the group.')}>
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
              {...explain(renaming ? 'Closes the name box without renaming.' : 'Opens a box to type a new name for the group.', renaming ? 'The group keeps its name.' : 'Nothing changes until you press SAVE NAME. Only the owner sees this key.')}
            >
              {renaming ? '[ CANCEL ]' : '[ RENAME ]'}
            </button>

            <button
              type="button"
              onClick={() => setHandingOver(!handingOver)}
              disabled={others.length === 0}
              className={PLATE}
              {...explain(handingOver ? 'Closes the list and keeps the group yours.' : 'Lists the members so you can make one of them the owner.', handingOver ? 'Nothing changes.' : 'To pass on the renaming and removing. Only the owner sees this key.')}
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
          {...explain(confirmingLeave ? 'Takes you out of this group now.' : 'Asks you to confirm that you want to leave this group.', confirmingLeave ? 'An owner who leaves passes the group on; the last one out deletes it and its messages for good.' : 'Nothing happens until you press CONFIRM LEAVE.', NOTE.others)}
        >
          {busy ? '[ WORKING... ]' : confirmingLeave ? '[ CONFIRM LEAVE ]' : '[ LEAVE GROUP ]'}
        </button>

        <span className="text-ink">
          {thread.participants.length}/{MAX_GROUP_MEMBERS}
        </span>
      </div>

      {!confirmingLeave || !owner ? null : (
        <p className="w-fit bg-bubble-pale px-1 text-ink-bar">
          {others.length === 0 ? 'THE GROUP GOES WITH YOU.' : 'OWNERSHIP PASSES TO THE LONGEST MEMBER.'}
        </p>
      )}

      {!renaming ? null : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-40 flex-1" htmlFor={`group-rename-${thread.id}`}>
            <span className="block">NEW NAME:</span>
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
            {...explain('Gives the group the name in the box.', 'So everybody in it can tell what it is for.', NOTE.others)}
          >
            [ SAVE NAME ]
          </button>
        </div>
      )}

      {!handingOver ? null : (
        <ul className="space-y-1">
          <li className="text-ink">HAND TO:</li>
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
                {...explain('Makes this person the group\'s owner.', 'They get the rename, hand over and remove keys, and you lose them.', 'NO QUESTION IS ASKED. ONLY THE NEW OWNER CAN HAND IT BACK.')}
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
                className="ml-1 cursor-pointer bg-bubble-pale px-1 text-ink-bar underline hover:bg-ena"
                {...explain(confirmingRemoval === id ? 'Takes this person out of the group now.' : 'Asks whether to take this person out of the group.', confirmingRemoval === id ? 'The group closes to them.' : 'Nothing happens until you press SURE?. Only the owner sees this key.', NOTE.others)}
              >
                {confirmingRemoval === id ? 'SURE?' : 'remove'}
              </button>
            )}
          </li>
        ))}
      </ul>

      {!adding ? null : addable.length === 0 ? (
        <p className="text-ink">NOBODY TO ADD.</p>
      ) : (
        <ul className="space-y-1">
          {addable.map((account) => (
            <li key={account.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void attempt(() => onAdd(account.id))}
                className={`${PLATE} w-full max-w-md text-left`}
                {...explain('Adds this person to the group.', 'They can read it and write in it from then on.', NOTE.others)}
              >
                + {account.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error === null ? null : <p className="w-fit bg-bubble-pale px-1 text-ink-bar">{error}</p>}
    </div>
  );
}

