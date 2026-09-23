'use client';

import { useState } from 'react';
import { insertMention, mentionToken, mentionsIn, removeMention, type Mentionable } from '../lib/forum/mentions';
import ProfileName from './ProfileName';

type MentionPickerProps = {
  id: string;
  /** Accounts that can be tagged; an empty list hides the picker entirely. */
  accounts: Mentionable[];
  body: string;
  onChange: (body: string) => void;
  /**
   * The author this box answers: tagged without being asked (shown, not editable). A guest's
   * name can appear here - answering them tags them in the words - they simply cannot be told.
   */
  autoTag?: Mentionable | null;
};

/**
 * "Tag a user" strip for the composers.
 *
 * It writes into the post's own words rather than into a hidden field, so `@name` in the body is
 * the tag: what a reader sees is what the code reads, a tag can be typed by hand, and a post
 * pasted somewhere else keeps its tags. The chips below are simply the tags the body already
 * holds, so the strip can never disagree with the text above it.
 *
 * The account list comes from the comms store (every signed-in account the app knows), which is
 * passed in by the caller instead of being read here: a composer should be usable - and
 * testable - on its own.
 */
export default function MentionPicker({ id, accounts, body, onChange, autoTag = null }: MentionPickerProps) {
  const [picked, setPicked] = useState('');
  const mentioned = mentionsIn(body, accounts);

  if (accounts.length === 0) return null;

  return (
    <div className="mt-2 border border-ink bg-ice-pale p-1">
      <div className="flex flex-wrap items-center gap-1 text-[10px] font-bold text-ink">
        <label htmlFor={`${id}-mention`}>TAG A USER:</label>
        <select
          id={`${id}-mention`}
          value={picked}
          onChange={(event) => setPicked(event.target.value)}
          className="max-w-40 rounded-none border-2 border-t-black border-l-black border-r-white border-b-white bg-paper p-1 font-mono text-[10px] text-ink outline-none"
        >
          <option value="">PICK AN ACCOUNT...</option>
          {accounts
            .filter((account): account is Mentionable & { id: string } => account.id !== null)
            .map((account) => (
              <option key={account.id} value={account.id}>
                {account.displayName}
              </option>
            ))}
        </select>
        <button
          type="button"
          disabled={picked === ''}
          onClick={() => {
            const account = accounts.find((entry) => entry.id === picked);
            if (account === undefined) return;
            onChange(insertMention(body, account.displayName));
            setPicked('');
          }}
          className="cursor-pointer rounded-none border-t border-l border-white border-r border-b border-black bg-sun-pale px-2 py-[2px] font-bold hover:bg-ice disabled:cursor-not-allowed disabled:opacity-60"
        >
          [ TAG ]
        </button>
        <span className="font-normal text-ink">
          OR WRITE @NAME IN THE POST - IT IS THE SAME TAG.
        </span>
      </div>

      {mentioned.length === 0 ? null : (
        <ul className="mt-1 flex flex-wrap items-center gap-1">
          {mentioned.map((account) => (
            <li
              key={account.id ?? account.displayName}
              className="flex items-center gap-1 border border-ink bg-paper px-1 py-[1px] text-[10px] font-bold text-ink"
            >
              <ProfileName author={{ id: account.id, displayName: account.displayName }} lamp={false} />
              <span className="font-normal text-ink">{mentionToken(account.displayName)}</span>
              <button
                type="button"
                onClick={() => onChange(removeMention(body, account.displayName))}
                aria-label={`Stop tagging ${account.displayName}`}
                title="Remove this tag"
                className="cursor-pointer border border-ink bg-sun-pale px-1 text-[9px] font-bold text-ink hover:bg-ice"
              >
                x
              </button>
            </li>
          ))}
        </ul>
      )}

      {autoTag === null ? null : (
        <p className="mt-1 text-[10px] font-bold text-ink">
          ANSWERS THIS POST, SO{' '}
          <ProfileName author={{ id: autoTag.id, displayName: autoTag.displayName }} lamp={false} /> IS TAGGED
          AUTOMATICALLY.
        </p>
      )}
    </div>
  );
}
