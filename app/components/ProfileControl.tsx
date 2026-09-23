'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import type { AvatarVersion } from '../lib/profile/types';
import { currentAvatarVersion } from '../lib/profile/visibility';
import { useAuth } from './AuthProvider';
import { useNotifications } from './NotificationsProvider';
import { NotificationMenuButton } from './NotificationBell';
import { NAV_ITEMS } from './SiteNav';
import ProfileAvatar from './ProfileAvatar';
import ProfileName from './ProfileName';

const MENU_ITEM =
  'flex w-full items-center gap-2 rounded-none border border-ink bg-paper px-2 py-[3px] text-left text-ink hover:bg-ena hover:text-sun max-sm:min-h-11 max-sm:px-3 max-sm:text-sm';

const LOG_IN_BUTTON =
  'shrink-0 rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-sun px-3 py-1 text-xs font-bold text-ink hover:bg-ena hover:text-sun active:border-t-2 active:border-l-2 active:border-black active:border-r active:border-b active:border-white active:bg-bubble';

const PICTURE_BUTTON =
  'inline-flex cursor-pointer items-center gap-1 rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-sun p-[2px] text-ink hover:bg-ena hover:text-sun active:border-t-2 active:border-l-2 active:border-black active:border-r active:border-b active:border-white active:bg-bubble';

/**
 * The menu's panel: the raised yellow box every pop-up on this site is made of.
 *
 * It is anchored to the picture and opened *downward* on a phone, because the picture sits in the
 * title bar at the top of the window - a menu that opens upward from the top edge would be off the
 * screen. The 2px bevel, the square corners and the flat yellow are the same as everywhere else.
 */
const MENU_PANEL =
  'absolute right-0 top-full z-30 mt-1 w-64 space-y-1 rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun p-2 text-[10px] font-bold text-ink';


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
  /** How many notifications are waiting, for the mark on the picture. */
  unreadNotifications: number;
};

/**
 * Signed in: the visitor's own picture, and the pop-up it opens.
 *
 * This is the whole of the site's navigation on a hand's width of screen. The header band and the
 * Start plate are both wide-screen chrome now, so tapping the picture is the one intentional,
 * discoverable gesture that opens everything: the account, where you read, the arcade, the archive,
 * the directory and the conversations, plus the tags and replies waiting for you. Nothing here is
 * offered anywhere else on a phone, which is the point - a row that leads to the same place as
 * another row is a button spent on nothing, and the board is what the screen is for.
 *
 * Tapping anywhere else closes it, the way a Win95 pop-up behaves.
 */
export function ProfilePictureMenu({ userId, displayName, avatarVersion, unreadNotifications }: ProfilePictureMenuProps) {
  const [open, setOpen] = useState(false);
  const news = unreadNotifications === 0 ? '' : `, ${unreadNotifications} new`;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Open the account menu${news}`}
        title={unreadNotifications === 0 ? 'Account and notifications' : `Account and notifications (${unreadNotifications} new)`}
        className={PICTURE_BUTTON}
      >
        {/* A 26px square: the plain frame, because the framed notice ("NO PICTURE") is wider
            than the picture it stands in for and would push the title bar about. */}
        <ProfileAvatar
          version={avatarVersion}
          displayName={displayName}
          size={26}
          variant="plain"
          hideVersionLabel
        />
        {/* The mark, not a number: the count belongs to the row inside, and a phone's title bar has
            no room for a second line of text beside the picture. */}
        {unreadNotifications === 0 ? null : (
          <span
            aria-hidden
            className="ml-[2px] mr-1 inline-block h-[6px] w-[6px] shrink-0 border border-black bg-bubble-pale"
          />
        )}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />

          <div className={MENU_PANEL} role="menu">
            <p className="border-b-2 border-ink pb-1">
              <ProfileName author={{ id: userId, displayName }} lamp={false} />
            </p>

            {/* Tags and replies, first: it is the row that changes while you are reading. */}
            <NotificationMenuButton />

            <Link
              href={`/profile/${encodeURIComponent(userId)}`}
              className={MENU_ITEM}
              onClick={() => setOpen(false)}
              role="menuitem"
            >
              <span aria-hidden="true" className="w-4 shrink-0 text-center text-[13px]">
                ☻
              </span>
              <span>MY PUBLIC PROFILE</span>
            </Link>

            <p className="border-b-2 border-ink pb-1 pt-1">EVERYWHERE ELSE</p>

            {/* The one navigation drawer on a phone: every essential destination lives here, and the
                profile picture above is the only thing on screen that opens it (the header band and
                the Start plate are both wide-screen chrome now). HOME and FORUM are left out because
                this menu opens *from the board*, so both would be two ways back to where the reader
                already is. */}
            {NAV_ITEMS.filter((item) => item.key !== 'home' && item.key !== 'forum').map((item) => (
              <Link key={item.key} href={item.href} className={MENU_ITEM} onClick={() => setOpen(false)} role="menuitem">
                <span aria-hidden="true" className="w-4 shrink-0 text-center text-[13px]">
                  {item.mark}
                </span>
                <span>{item.label}</span>
              </Link>
            ))}

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
/**
 * The top-right of the window: the account, and the way into it.
 *
 * It stands where the minimise / maximise / close buttons of a Windows 95 title bar used to be,
 * because those were decoration here and this is not. Which half shows is the session's answer, and
 * until that read lands this draws nothing at all - better than a log-in button that turns into a
 * picture a moment later.
 *
 * On a wide screen it is hidden: the side panel on the right does the same job with room to breathe
 * (see ./DesktopSidebar.tsx), and the reader's own face there is a link rather than a menu.
 */
export default function ProfileControl() {
  const { user, status } = useAuth();
  const notifications = useNotifications();
  const { profile } = usePublicProfile(user?.id ?? null);

  if (status === 'loading') return null;

  return (
    // The wrapper is what a wide screen hides, so the two halves below stay about *what* to draw
    // rather than each carrying the same breakpoint.
    <div className="shrink-0 sm:hidden">
      {user === null ? (
        <GuestProfileMenu />
      ) : (
        <ProfilePictureMenu
          userId={user.id}
          displayName={user.displayName}
          avatarVersion={currentAvatarVersion(profile)}
          unreadNotifications={notifications.unread}
        />
      )}
    </div>
  );
}

/**
 * Signed out on a phone: the visitor's own anonymous picture, and the same menu.
 *
 * A guest gets the identical drawer rather than a lesser one - the whole site is one press away
 * whether or not somebody has signed in - with the way in put at the top of it. The picture itself
 * is the shared anonymous placeholder (see ./ProfileAvatar.tsx), so a visitor who has never been
 * here looks like an account that has not chosen a drawing yet, which is what they are.
 */
function GuestProfileMenu() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Open the site menu"
        title="Open the site menu"
        className={PICTURE_BUTTON}
      >
        <ProfileAvatar version={undefined} displayName="Anonymous" size={26} variant="plain" hideVersionLabel />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div className={MENU_PANEL} role="menu">
            <p className="border-b-2 border-ink pb-1">ANONYMOUS VISITOR</p>
            <p className="pb-1 text-[10px]">READING TAKES NO ACCOUNT. AN ACCOUNT SIGNS YOUR POSTS.</p>

            <Link href="/account" className={MENU_ITEM} onClick={() => setOpen(false)} role="menuitem">
              <span aria-hidden="true" className="w-4 shrink-0 text-center text-[13px]">
                ⚿
              </span>
              <span>CREATE ACCOUNT / LOG IN</span>
            </Link>

            {/* The same drawer a signed-in reader gets: one control opens the whole site. */}
            {NAV_ITEMS.filter((item) => item.key !== 'home' && item.key !== 'forum').map((item) => (
              <Link key={item.key} href={item.href} className={MENU_ITEM} onClick={() => setOpen(false)} role="menuitem">
                <span aria-hidden="true" className="w-4 shrink-0 text-center text-[13px]">
                  {item.mark}
                </span>
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

