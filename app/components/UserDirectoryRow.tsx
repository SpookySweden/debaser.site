'use client';

import type { ReactNode } from 'react';
import type { UserDirectoryRow as DirectoryRow } from '../lib/profile/directory';
import { presenceLabel, presenceLine } from '../lib/profile/presence';
import { PLATE } from '../lib/ui/controls';
import ProfileAvatarLink from './ProfileAvatarLink';
import ProfileLink from './ProfileLink';
import ProfileName from './ProfileName';
import StatusDot from './StatusDot';
import TimeStamp from './TimeStamp';

type UserDirectoryRowProps = {
  row: DirectoryRow;
  /** The signed-in account, or null: only a signed-in visitor gets a message button. */
  viewerId: string | null;
  /** True while this row's conversation is being opened. */
  busy?: boolean;
  /** Opens the conversation with this account. The row is inert without it. */
  onMessage?: (otherId: string) => void;
  /**
   * Anything else this screen can do with the account, drawn where the message button goes.
   *
   * The arcade invites where the directory messages, and both are a verb on the same account - so
   * the slot is here rather than a second row component: one row means the lamp, the picture, the
   * coloured name and the `[ ADMIN ]` / `[ YOU ]` / `[ BANNED ]` marks are the same on both screens,
   * and there is no second copy of them to fall out of step.
   */
  actions?: ReactNode;
};

/**
 * One line of the user directory.
 *
 * Left to right: the lamp and what it means, the account's picture and name (the
 * name in the colour that account chose, both opening its public profile), the
 * `[ ADMIN ]` / `[ YOU ]` / `[ BANNED ]` marks, when the account was made, and the
 * buttons that ask something of it - a conversation, an invitation, or whatever else
 * the screen passing them in has to offer.
 *
 * On a phone the lamp takes its own line and the rest follows under it: the lamp's own
 * column is 13rem, which at a hand's width is the whole row.
 *
 * The lamp is drawn straight from `StatusDot` rather than through `ProfileName`,
 * and that is deliberate: the house account wears no lamp on the board - a post an
 * item owns is signed by the archive even though a visitor's comment opened it -
 * but this page is about accounts, and debaser.site is one of them.
 */
export default function UserDirectoryRow({ row, viewerId, busy = false, onMessage, actions }: UserDirectoryRowProps) {
  const author = { id: row.account.id, displayName: row.account.displayName };
  const showMessage = onMessage !== undefined && viewerId !== null && !row.you;
  const asked = showMessage || actions !== undefined;

  return (
    <li
      className={`flex flex-wrap items-center gap-x-3 border-b border-gray-500 p-1 text-[10px] font-bold last:border-b-0 ${
        row.admin ? 'bg-[#dcdcdc]' : ''
      }`}
    >
      <span
        className="inline-flex w-full shrink-0 items-center gap-1 sm:w-52"
        title={presenceLine(row.status, row.record)}
      >
        <StatusDot status={row.status} record={row.record} />
        {presenceLabel(row.status)}
        {row.status === 'online' || row.record === undefined ? null : (
          <span className="text-gray-700">
            :: <TimeStamp at={row.record.lastSeenAt} />
          </span>
        )}
      </span>

      <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
        <ProfileAvatarLink author={author} size={28} showName={false} />
        <ProfileLink author={author}>
          <ProfileName author={author} lamp={false} />
        </ProfileLink>
        {row.admin ? (
          <span className="border border-black bg-ena px-1 text-white">[ ADMIN ]</span>
        ) : null}
        {row.you ? <span className="border border-black bg-white px-1">[ YOU ]</span> : null}
        {/* Banned is worth saying out loud: their posts are hidden from everybody
            but the admin, so the name would otherwise just look quiet. */}
        {row.account.banned === true ? (
          <span className="border border-black bg-[#800000] px-1 text-white">[ BANNED ]</span>
        ) : null}
      </span>

      {row.account.createdAt.length === 0 ? null : (
        <span className="text-gray-700">
          JOINED <TimeStamp at={row.account.createdAt} />
        </span>
      )}

      {asked ? (
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {showMessage ? (
            <button type="button" onClick={() => onMessage?.(row.account.id)} disabled={busy} className={PLATE}>
              {busy ? '[ OPENING... ]' : '[ MESSAGE ]'}
            </button>
          ) : null}
          {actions}
        </span>
      ) : null}
    </li>
  );
}
