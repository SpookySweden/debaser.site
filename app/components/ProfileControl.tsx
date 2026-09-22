'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import type { AvatarVersion } from '../lib/profile/types';
import { currentAvatarVersion } from '../lib/profile/visibility';
import { useAuth } from './AuthProvider';
import { useComms } from './CommsProvider';
import { NotificationMenuButton } from './NotificationBell';
import ProfileAvatar from './ProfileAvatar';
import ProfileName from './ProfileName';

const MENU_ITEM =
  'block w-full rounded-none border border-gray-500 bg-white px-2 py-[3px] text-left hover:bg-yellow-100';

const LOG_IN_BUTTON =
  'lg:hidden shrink-0 rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-3 py-1 text-xs font-bold text-black hover:bg-gray-300';

const PICTURE_BUTTON =
  'inline-flex cursor-pointer items-center gap-1 rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] p-[2px] text-black hover:bg-gray-300';

/**
 * Signed out: one large log-in button, where the window buttons used to be.
 *
 * Split out from the state around it so the two halves can be read (and rendered)
 * on their own: this one is a plain link to the account page, which is where the
 * forms - and the Google button - are.
 */
export function ProfileLogIn() {
  return (
    <Link href="/account" className={LOG_IN_BUTTON} title="Log in or create an account">
      [ LOG IN ]
    </Link>
  );
}

type ProfilePictureMenuProps = {
  userId: string;
  displayName: string;
  /** The picture version on display, straight from the profile store. */
  avatarVersion: AvatarVersion | undefined;
  /** Messages waiting, so the comms entry can say so without opening the page. */
  unreadTotal: number;
};

/**
 * Signed in: the visitor's own picture, and the pop-up it opens.
 *
 * This is the phone's answer to the tabs the banner drops: the directory, the
 * conversations (with the unread count) and the account, plus the way to their
 * public profile. Tapping anywhere else closes it, the way a Win95 pop-up behaves.
 */
export function ProfilePictureMenu({ userId, displayName, avatarVersion, unreadTotal }: ProfilePictureMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Open the account menu"
        title="Account, directory and comms"
        className={PICTURE_BUTTON}
      >
        <ProfileAvatar version={avatarVersion} displayName={displayName} size={26} hideVersionLabel />
        {unreadTotal === 0 ? null : <span className="pr-1 text-[10px] font-bold text-[#800000]">{unreadTotal}</span>}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />

          <div
            className="absolute right-0 top-full z-20 mt-1 w-56 space-y-1 rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] p-2 text-[10px] font-bold text-black"
            role="menu"
          >
            <p className="border-b border-gray-500 pb-1">
              <ProfileName author={{ id: userId, displayName }} lamp={false} />
            </p>

            <Link href="/users" className={MENU_ITEM} onClick={() => setOpen(false)} role="menuitem">
              [ USER DIRECTORY ]
            </Link>
            <Link href="/comms" className={MENU_ITEM} onClick={() => setOpen(false)} role="menuitem">
              [ COMMS{unreadTotal === 0 ? '' : ` (${unreadTotal})`} ]
            </Link>
            {/* Tags and replies, one row above the account: on a phone this is where the
                notification button lives, listed with the other buttons. */}
            <NotificationMenuButton />
            <Link href="/account" className={MENU_ITEM} onClick={() => setOpen(false)} role="menuitem">
              [ ACCOUNT ]
            </Link>
            <Link
              href={`/profile/${encodeURIComponent(userId)}`}
              className={MENU_ITEM}
              onClick={() => setOpen(false)}
              role="menuitem"
            >
              [ MY PUBLIC PROFILE ]
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * The top-right of the window on a phone: the account, and the way into it.
 *
 * It stands where the minimise / maximise / close buttons of a Windows 95 title bar
 * used to be, because those were decoration here and this is not. Which half shows
 * is the session's answer, and until that read lands this draws nothing at all -
 * better than a log-in button that turns into a picture a moment later.
 *
 * On a wide screen this is hidden: the side panel on the right does the same job
 * with room to breathe (see ./DesktopSidebar.tsx).
 */
export default function ProfileControl() {
  const { user, status } = useAuth();
  const { unreadTotal } = useComms();
  const { profile } = usePublicProfile(user?.id ?? null);

  if (status === 'loading') return null;
  if (user === null) return <ProfileLogIn />;

  return (
    <ProfilePictureMenu
      userId={user.id}
      displayName={user.displayName}
      avatarVersion={currentAvatarVersion(profile)}
      unreadTotal={unreadTotal}
    />
  );
}
