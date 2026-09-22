'use client';

import { useState } from 'react';
import { isUnread } from '../lib/notifications/feed';
import NotificationMenu from './NotificationMenu';
import PopoutWindow from './PopoutWindow';
import { useNotifications } from './NotificationsProvider';

/** The square that says "there is something here you have not read". */
function UnreadDot({ count }: { count: number }) {
  return (
    <span
      aria-label={`${count} unread`}
      title={`${count} unread`}
      className="ml-1 inline-block h-2 w-2 shrink-0 border border-black bg-[#ff0000] align-middle"
    />
  );
}

const BELL_BUTTON =
  'inline-flex cursor-pointer items-center gap-1 rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] px-2 py-[2px] text-[10px] font-bold text-black hover:bg-gray-300';

/**
 * The bell at the top of the side panel's comms block.
 *
 * It says how many tags and replies are waiting before it is opened - the dot is unread, the
 * number is the count - and the pop-up under it is the menu itself. Clicking anywhere else
 * closes it, the way a Win95 pop-up behaves.
 */
export default function NotificationBell() {
  const notifications = useNotifications();
  const [open, setOpen] = useState(false);
  const unread = notifications.items.filter(isUnread).length;
  const signedIn = notifications.userId !== null;

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Notifications: ${notifications.summary}`}
        title={signedIn ? notifications.summary : 'Sign in to be tagged'}
        className={BELL_BUTTON}
      >
        [ ! ] NOTIFICATIONS
        {unread === 0 ? null : (
          <>
            <span className="text-[#800000]">{unread}</span>
            <UnreadDot count={unread} />
          </>
        )}
      </button>

      {!open ? null : (
        <>
          <span className="fixed inset-0 z-30 block" onClick={() => setOpen(false)} aria-hidden />

          <span className="absolute left-0 top-full z-40 mt-1 block w-72">
            <NotificationMenu onClose={() => setOpen(false)} />
          </span>
        </>
      )}
    </span>
  );
}

const MENU_ITEM =
  'block w-full rounded-none border border-gray-500 bg-white px-2 py-[3px] text-left text-[10px] font-bold text-black hover:bg-yellow-100';

/**
 * The same menu, as a phone does it: one row among the other buttons in the profile pop-up.
 *
 * Buttons, not an icon in a corner: on a phone the top bar belongs to the account picture, and a
 * tag is something you go and look at rather than something that floats over the page. The menu
 * opens as a draggable pop-up window, which is what a small screen has room for.
 */
export function NotificationMenuButton({ className = MENU_ITEM }: { className?: string }) {
  const notifications = useNotifications();
  const [open, setOpen] = useState(false);
  const unread = notifications.items.filter(isUnread).length;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} role="menuitem" className={`${className} cursor-pointer`}>
        [ NOTIFICATIONS{unread === 0 ? '' : ` (${unread})`} ]
        {unread === 0 ? null : <UnreadDot count={unread} />}
      </button>

      {!open ? null : (
        <PopoutWindow
          title={`NOTIFICATIONS :: ${notifications.summary}`}
          badge="[ TAGS + REPLIES ]"
          maxWidth="max-w-md"
          onClose={() => setOpen(false)}
        >
          <NotificationMenu chrome={false} onClose={() => setOpen(false)} />
        </PopoutWindow>
      )}
    </>
  );
}
