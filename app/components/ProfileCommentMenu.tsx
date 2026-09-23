'use client';

import { useState } from 'react';
import type { ProfileCommentKind } from '../lib/profile/types';
import { HYPER_ARROW, HYPER_TEXT } from '../lib/ui/hypertext';

/**
 * One account's aspects, in the order the page reads: the drawing, the track, the profile.
 * The `kind` is the stored comment kind (`avatar` / `song` / `profile`), so the menu, the
 * window it opens and the row a comment lands in all name the same thing.
 */
const ASPECTS: { kind: ProfileCommentKind; label: string }[] = [
  { kind: 'avatar', label: 'profile picture' },
  { kind: 'song', label: 'music' },
  { kind: 'profile', label: 'general' },
];

export type ProfileCommentOption = {
  kind: ProfileCommentKind;
  /** `P2`, `M1`, or nothing for the profile itself. */
  tag?: string;
  /** False when the owner has that thread switched off, or nothing is filed to comment on. */
  available: boolean;
  /** Why it is not available, in the owner's own terms. */
  reason?: string;
};

type ProfileCommentMenuProps = {
  options: ProfileCommentOption[];
  /** Opens the comment window on the aspect that was picked. */
  onChoose: (kind: ProfileCommentKind) => void;
};

type ProfileCommentOptionsProps = {
  options: ProfileCommentOption[];
  onChoose: (kind: ProfileCommentKind) => void;
};

/**
 * The three choices, as a menu drops them down: full-width rows that highlight under the
 * pointer, the ones the owner has closed marked as closed with the reason.
 *
 * Separate from the button that opens it because it is the part with something to say - and
 * because a menu is closed until it is pressed, which means the only way to check what it
 * says is to be able to draw it on its own.
 */
export function ProfileCommentOptions({ options, onChoose }: ProfileCommentOptionsProps) {
  return (
    <ul
      role="menu"
      className="w-full max-w-md rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale py-[2px] shadow-[2px_2px_0_rgba(0,0,0,0.35)]"
    >
      {options.map((option) => {
        const label = ASPECTS.find((aspect) => aspect.kind === option.kind)?.label ?? option.kind;

        return (
          <li key={option.kind} role="none">
            <button
              type="button"
              role="menuitem"
              disabled={!option.available}
              onClick={() => onChoose(option.kind)}
              className={`flex w-full items-baseline justify-between gap-x-3 px-2 py-1 text-left text-[10px] font-bold ${
                option.available
                  ? 'cursor-pointer text-ink hover:bg-ena hover:text-white'
                  : 'cursor-default text-ink'
              }`}
              title={option.reason}
            >
              <span className="min-w-0 truncate">
                {option.available ? '' : '· '}
                {label}
                {option.tag === undefined ? '' : ` (${option.tag})`}
              </span>

              <span className="shrink-0 text-ink">{option.available ? '' : (option.reason ?? 'switched off')}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The profile's one comment button, and the menu of what a comment can be about.
 *
 * A profile can be commented on in three places - the drawing, the track, and the profile
 * itself - and each of them used to carry its own control, which meant three ways in that
 * looked like three different things to do. There is one now: `comment`, on its own line
 * under the title bar, and pressing it opens the menu. Choosing from the menu opens the
 * comment window on that aspect, so any of the three is two clicks from anywhere on the page
 * instead of one click to only the thing you happen to be standing next to.
 *
 * It is drawn on every profile, including ones with nothing filed and ones whose owner has
 * switched a thread off: an option being visible is not the same as an option being open, and
 * a reader who finds no button at all cannot tell "off" from "there is nothing here". The
 * menu says which it is, per aspect, and the window says it again before anybody types.
 *
 * It opens in place rather than in a portal, so it cannot be clipped by the panel it came from.
 */
export default function ProfileCommentMenu({ options, onChoose }: ProfileCommentMenuProps) {
  const [open, setOpen] = useState(false);
  const openable = options.filter((option) => option.available).length;

  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="flex items-baseline gap-x-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={HYPER_TEXT}
          aria-haspopup="menu"
          aria-expanded={open}
          title="Leave a comment on this profile"
        >
          comment
        </button>

        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={HYPER_ARROW}
          aria-hidden="true"
          tabIndex={-1}
          title={open ? 'Close the comment menu' : 'What can be commented on'}
        >
          {open ? '▴' : '▾'}
        </button>
      </span>

      <span className="text-[10px] font-bold text-ink">
        {openable === 0 ? 'nothing open to comments' : `${openable} of ${options.length} open to comments`}
      </span>

      {!open ? null : (
        <ProfileCommentOptions
          options={options}
          onChoose={(kind) => {
            setOpen(false);
            onChoose(kind);
          }}
        />
      )}
    </div>
  );
}
