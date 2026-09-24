'use client';

import { useState } from 'react';
import { isUnread } from '../lib/notifications/feed';
import { ICON_BELL } from '../lib/ui/icons';
import NotificationMenu from './NotificationMenu';
import PopoutWindow from './PopoutWindow';
import { useNotifications } from './NotificationsProvider';

/** The square that says "there is something here you have not read". */
function UnreadDot() {
  return (
    <span
      aria-hidden
      className="ml-[2px] inline-block h-[6px] w-[6px] shrink-0 border border-black bg-bubble-pale align-middle"
    />
  );
}

/**
 * The notices key, sized and shaped like the comms block's `[ OPEN COMMS ]` plate beside it.
 *
 * It sits in the side panel under COMMS, so it wears that panel's furniture rather than a title bar's:
 * a full-width plate, in ink on the pale field, that inverts on hover the way every other plate does.
 * The glyph and the count, no word - what it is says itself in the accessible name
 * (`Notifications: 4 NEW`), which is also what the pointer reads on hover, so nothing is lost by
 * dropping the label from the face.
 */
const BELL_BUTTON =
  'inline-flex cursor-pointer items-center gap-1 rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-sun-pale px-2 py-[2px] text-[10px] font-bold text-ink hover:bg-ice';

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
  const unread = notifications.items.filter(isUnread).length;
  const signedIn = notifications.userId !== null;

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
        <span aria-hidden="true" className="text-[13px] leading-none">
          {ICON_BELL}
        </span>
        <span>[ {unread === 0 ? 'NOTICES' : `${unread} NEW`} ]</span>
        {unread === 0 ? null : <UnreadDot />}
      </button>

      {!open ? null : (
        <>
          <span className="fixed inset-0 z-30 block" onClick={() => setOpen(false)} aria-hidden />

          {/* Opening *upward* and to the left: this key is at the foot of a narrow column, so a menu
              below it would run off the bottom of the window. */}
          <span className="absolute bottom-full left-0 z-40 mb-1 block w-72">
            <NotificationMenu onClose={() => setOpen(false)} />
          </span>
        </>
      )}
    </span>
  );
}

const MENU_ITEM =
  'block w-full rounded-none border border-ink bg-paper px-2 py-[3px] text-left text-[10px] font-bold text-ink hover:bg-ice-pale';

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
