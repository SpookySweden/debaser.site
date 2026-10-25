'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { UserDirectoryRow as DirectoryRow } from '../lib/profile/directory';
import { inkOnNameColour, nameColourDark, profileNameColour } from '../lib/profile/name-colours';
import { presenceLine } from '../lib/profile/presence';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { PLATE } from '../lib/ui/controls';
import ProfileAvatarLink from './ProfileAvatarLink';
import ProfileLink from './ProfileLink';
import ProfileName from './ProfileName';
import RelativeShort from './RelativeShort';
import StatusDot from './StatusDot';

/**
 * The row's hover fill: the account's name colour, in the value each theme draws the name in, and the ink
 * that reads on it (`.name-glow` in globals.css). Undefined for a name with no colour, which lights up in
 * the page's own ink instead.
 */
function glowStyle(chosen: string | undefined): CSSProperties | undefined {
  if (chosen === undefined) return undefined;
  const dark = nameColourDark(chosen) ?? chosen;

  return {
    '--glow': chosen,
    '--glow-ink': inkOnNameColour(chosen),
    '--glow-dark': dark,
    '--glow-ink-dark': inkOnNameColour(dark),
  } as CSSProperties;
}

/** What the side panel's one-letter marks stand for, said under the pointer. */
const ADMIN_TIP = 'Admin: the house account, which runs the archive';
const BANNED_TIP = 'Banned: their posts are hidden from everybody but the admin';

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
  /**
   * The side panel's row: a glance rather than a listing.
   *
   * The panel is 18rem of column, so it keeps what identifies an account and what says whether they
   * are about: the picture, the name, its marks (`[ A ]` and `[ X ]` short, with a tip saying what
   * each stands for), and how long ago they were last here in one character (`22s`).
   */
  compact?: boolean;
};

/**
 * One line of the user directory.
 *
 * Left to right: the lamp and how long ago the account was last here (`3w`, the side panel's reading;
 * the longer `LAST ONLINE ...` line is the lamp's tip), the account's picture and name (the name
 * in the colour that account chose, both opening its public profile), the `[ ADMIN ]` / `[ YOU ]` /
 * `[ BANNED ]` marks, and the buttons that ask something of it - a conversation, an invitation, or
 * whatever else the screen passing them in has to offer. No join date: it never changes, and the
 * profile has it (SPEC-efficiency.md).
 *
 * The lamp is drawn straight from `StatusDot` rather than through `ProfileName`,
 * and that is deliberate: the house account wears no lamp on the board - a post an
 * item owns is signed by the archive even though a visitor's comment opened it -
 * but this page is about accounts, and debaser.site is one of them.
 */
export default function UserDirectoryRow({
  row,
  viewerId,
  busy = false,
  onMessage,
  actions,
  compact = false,
}: UserDirectoryRowProps) {
  const author = { id: row.account.id, displayName: row.account.displayName };
  const showMessage = onMessage !== undefined && viewerId !== null && !row.you;
  const asked = showMessage || actions !== undefined;
  const { profile } = usePublicProfile(row.account.id);
  const glow = glowStyle(profileNameColour(profile));

  /**
   * The panel's row: one line, and only the parts a glance needs.
   *
   * The lamp is the whole of the presence reading here - no word beside it, because the colours are
   * explained once, in the list's title-line tip - and the last-seen reading is the compact one (`22s`).
   *
   * No join date: it is the one fact on this row that never changes, which makes it the right one to
   * leave to the profile. The `[ A ]` mark still rides the name, because it changes how the account
   * is read; `[ YOU ]` does too, because a reader scanning for themselves should find themselves.
   */
  if (compact) {
    return (
      <li
        className={`name-glow flex items-center gap-1 border-b border-ink px-2 py-1 text-label font-bold last:border-b-0 ${row.admin ? 'bg-sun-pale' : ''}`}
        style={glow}
      >
        <StatusDot status={row.status} record={row.record} />

        <ProfileAvatarLink author={author} size={20} showName={false} />

        <ProfileLink author={author} className="glow-link min-w-0 flex-1 truncate">
          <ProfileName author={author} lamp={false} />
        </ProfileLink>

        {row.admin ? (
          <span className="shrink-0 border border-ink-plate bg-ena px-1 text-ink-bar" title={ADMIN_TIP}>
            [ A ]
          </span>
        ) : null}
        {row.you ? <span className="shrink-0 border border-ink-plate bg-paper px-1 text-ink">[ YOU ]</span> : null}
        {row.account.banned === true ? (
          <span className="shrink-0 border border-ink-plate bg-bubble-pale px-1 text-ink-bar" title={BANNED_TIP}>
            [ X ]
          </span>
        ) : null}

        {/* How long ago, in one character. `ONLINE NOW` is the lamp's green and needs no number; a
            reading that could not be taken says `--` rather than inventing one. */}
        <span className="glow-text shrink-0 text-ink" title={presenceLine(row.status, row.record)}>
          {row.status === 'online' ? 'NOW' : <RelativeShort at={row.record?.lastSeenAt ?? null} />}
        </span>
      </li>
    );
  }

  return (
    <li
      className={`name-glow flex flex-wrap items-center gap-x-3 border-b border-ink p-1 text-label font-bold last:border-b-0 ${
        row.admin ? 'bg-sun-pale' : ''
      }`}
      style={glow}
    >
      {/* The lamp and its age, as the side panel's rows draw them: `NOW` while the lamp is green, else
          how long ago in one character (`3w`). A fixed narrow column, so the names still line up. */}
      <span
        className="inline-flex w-12 shrink-0 items-center gap-1"
        title={presenceLine(row.status, row.record)}
      >
        <StatusDot status={row.status} record={row.record} />
        <span className="glow-text text-ink">
          {row.status === 'online' ? 'NOW' : <RelativeShort at={row.record?.lastSeenAt ?? null} />}
        </span>
      </span>

      <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
        <ProfileAvatarLink author={author} size={28} showName={false} />
        <ProfileLink author={author} className="glow-link">
          <ProfileName author={author} lamp={false} />
        </ProfileLink>
        {row.admin ? (
          <span className="border border-ink-plate bg-ena px-1 text-ink-bar">[ ADMIN ]</span>
        ) : null}
        {row.you ? <span className="border border-ink-plate bg-paper px-1 text-ink">[ YOU ]</span> : null}
        {/* Banned is worth saying out loud: their posts are hidden from everybody
            but the admin, so the name would otherwise just look quiet. */}
        {row.account.banned === true ? (
          <span className="border border-ink-plate bg-bubble-pale px-1 text-ink-bar">[ BANNED ]</span>
        ) : null}
      </span>

      {asked ? (
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {showMessage ? (
            <button
              type="button"
              onClick={() => onMessage?.(row.account.id)}
              disabled={busy}
              className={PLATE}
              title="A message opens that conversation on the comms page"
            >
              {busy ? '[ OPENING... ]' : '[ MESSAGE ]'}
            </button>
          ) : null}
          {actions}
        </span>
      ) : null}
    </li>
  );
}
