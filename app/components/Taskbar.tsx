'use client';

import { useState } from 'react';
import { PLATE } from '../lib/ui/controls';
import { useComms } from './CommsProvider';
import NotificationBell from './NotificationBell';
import StartMenu from './StartMenu';

type TaskbarProps = {
  /** What the status strip says: the page's own line. */
  status: string;
};

/**
 * The taskbar along the foot of the window: the Start button, and the tray.
 *
 * The page tabs are the window's header (see ./SiteNav.tsx), so the foot strip holds the three things
 * a desktop keeps at the foot of the screen and nowhere else: the way into everything - the Start
 * menu, which lists the same five keys as the header *and* the debaser project's shelves - and the
 * tray, which is the page's status line, the encoding this window is written in and the notices bell.
 * The bell is here rather than in the side panel because the side panel is wide-screen only, and a
 * notice is the one plate a phone most needs to reach.
 *
 * It is drawn with `order-last` while being written before the page, so a keyboard user meets the
 * page's own content first and the tray last, which is the order they read in.
 *
 * Client-side because the menu opens: that is the only piece of state in the chrome.
 */
export default function Taskbar({ status }: TaskbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  // The menu's COMMS row carries the unread count on a phone, where that row is the only place the
  // conversations are listed (the tabs above carry the count on a wide screen).
  const { unreadTotal } = useComms();

  return (
    <div className="relative order-last flex flex-wrap items-center gap-1 border-t-2 border-white bg-[#c0c0c0] px-1 py-[3px] text-[10px] font-bold text-black">
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        // On a phone this button holds every destination there is, so it has to say what it opens -
        // and the name it is read with still starts with the word on the plate.
        aria-label="START :: the site menu"
        title="The site menu: every page, and the debaser project's shelves"
        // Pressed in while its menu is open, which is what a Start button does.
        className={
          menuOpen
            ? 'cursor-pointer rounded-none border-t-2 border-l-2 border-black border-r border-b border-white bg-gray-300 px-2 py-[2px] text-[10px] font-bold text-black'
            : PLATE
        }
      >
        [ START ]
      </button>

      {/* The tray: the page's own status line, and what the window is encoded in. */}
      <span className="ml-auto flex min-w-0 flex-wrap items-center gap-2 px-1 text-[10px] text-gray-700">
        <span>Status: {status}</span>
        <span aria-hidden="true">::</span>
        <span>UTF-8</span>
        {/* The tray carries the notices too: a notice belongs beside the status line and the encoding,
            at the foot of every window on every screen, rather than inside one page's side panel. */}
        <NotificationBell />
      </span>

      {menuOpen ? <StartMenu onDismiss={() => setMenuOpen(false)} commsUnread={unreadTotal} /> : null}
    </div>
  );
}
