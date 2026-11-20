'use client';

import { useEffect, useState } from 'react';
import { isUnread } from '../lib/notifications/feed';
import { TITLE_BAR_BUTTON } from '../lib/ui/controls';
import { ICON_BELL } from '../lib/ui/icons';
import NotificationMenu from './NotificationMenu';
import PopoutWindow from './PopoutWindow';
import { useNotifications } from './NotificationsProvider';

const OPEN_MENU_EVENT = 'debaser:open-notifications';

/** Opens the bell's menu from elsewhere (the balloon's `+2 MORE`). */
export function openNotificationMenu(): void {
  window.dispatchEvent(new Event(OPEN_MENU_EVENT));
}

/** The square that says "there is something here you have not read". */
function UnreadDot() {
  return (
    <span
      aria-hidden
      className="ml-0.5 inline-block h-[6px] w-[6px] shrink-0 border border-ink-plate bg-bubble-pale align-middle"
    />
  );
}

/**
 * The notices key, the same title-line key as the comms block's `[ COMMS ]` beside it.
 *
 * It sits on the COMMS title line, so it is the shared title-line key (`TITLE_BAR_BUTTON`) - the same
 * height as `[ COMMS ]`, so the line does not grow when the bell appears. The glyph and the count, no
 * word - what it is says itself in the accessible name (`Notifications: 4 NEW`), which is also what
 * the pointer reads on hover, so nothing is lost by dropping the label from the face.
 */
const BELL_BUTTON = `${TITLE_BAR_BUTTON} inline-flex items-center gap-1`;

/**
 * The notices key in the side panel, and the pop-up that answers it.
 *
 * It lives under COMMS rather than in the taskbar's tray, and next to the block it belongs to: a tag,
 * a reply and a message are the same kind of thing - something addressed to this account - and the
 * panel is where this account's things are. The tray was where it went when the panel could not hold
 * it; the panel can hold it now, so it is here, one row above the conversations it is about.
 *
 * The unread count rides on it (with the red square while anything is new) and the pop-up under it is
 * the menu itself. Clicking anywhere else closes it, the way a Win95 pop-up behaves.
 *
 * A phone never sees this: the panel is `lg:` only, so `NotificationMenuButton` below - the row in the
 * account pop-up - is what carries the notices there. Both read the same feed, so neither is a
 * second implementation of what is waiting.
 */
export default function NotificationBell() {
  const notifications = useNotifications();
  const [open, setOpen] = useState(false);
  // The balloon's `+2 MORE` opens this menu (openNotificationMenu, below).
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_MENU_EVENT, show);
    return () => window.removeEventListener(OPEN_MENU_EVENT, show);
  }, []);
  const unread = notifications.items.filter(isUnread).length;
  const signedIn = notifications.userId !== null;

  // Nothing waiting, nothing drawn. A bell on a quiet day is a row of furniture that teaches nobody
  // anything; the panel's own `[ COMMS ]` button already says how many conversations are open, so a
  // second resting count beside it would be two numbers for one question. The moment there is
  // something unread the key appears, and appearing *is* the alert.
  if (unread === 0) return null;

  return (
    <span className="relative block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Notifications: ${notifications.summary}`}
        title={signedIn ? `Notifications: ${notifications.summary}` : 'Sign in to be tagged'}
        className={BELL_BUTTON}
      >
        <span aria-hidden="true" className="text-label leading-none">
          {ICON_BELL}
        </span>
        <span>[ {unread} NEW ]</span>
        <UnreadDot />
      </button>

      {!open ? null : (
        <>
          <span className="fixed inset-0 z-30 block" onClick={() => setOpen(false)} aria-hidden />

          {/* Opening *upward* and to the left: this key is at the foot of a narrow column, so a menu
              below it would run off the bottom of the window. */}
          {/* Anchored by its right edge: the key sits near the panel's right side, so a menu running right was cut off. */}
          <span className="absolute bottom-full right-0 z-40 mb-1 block w-64">
            <NotificationMenu onClose={() => setOpen(false)} />
          </span>
        </>
      )}
    </span>
  );
}

const MENU_ITEM =
  'block w-full px-2 py-0.75 text-left text-label font-bold text-ink hover:bg-ice-pale';

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
        {unread === 0 ? null : <UnreadDot />}
      </button>

      {!open ? null : (
        <PopoutWindow
          title={`NOTIFICATIONS :: ${notifications.summary}`}
          maxWidth="max-w-md"
          onClose={() => setOpen(false)}
        >
          <NotificationMenu chrome={false} onClose={() => setOpen(false)} />
        </PopoutWindow>
      )}
    </>
  );
}
