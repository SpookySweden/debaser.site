'use client';

import { useState } from 'react';
import { PLATE } from '../lib/ui/controls';
import { useComms } from './CommsProvider';
import SpriteSlot from './SpriteSlot';
import StartMenu from './StartMenu';

type TaskbarProps = {
  /** What the status strip says: the page's own line. */
  status: string;
};

/**
 * The taskbar along the foot of the window: the Start button, and the tray.
 *
 * The window's keys are the header (see ./SiteNav.tsx), so the foot strip holds the two things a
 * desktop keeps at the foot of the screen and nowhere else: the way into everything - the Start
 * menu, which lists the same keys as the header *and* the debaser project's shelves - and the tray,
 * which is the page's status line, the encoding this window is written in and the notices bell.
 *
 * On a phone the plate is gone entirely. `hidden sm:inline-flex` is the whole of that rule, and it is
 * deliberate rather than incidental: a phone's only permanent control is the profile picture in the
 * title bar, which opens the same menu this plate does (see ./ProfileControl.tsx). A tray that kept
 * the plate would put navigation back on the screen the feed is supposed to own.
 *
 * It is drawn with `order-last` while being written before the page, so a keyboard user meets the
 * page's own content first and the tray last, which is the order they read in.
 *
 * Client-side because the menu opens: that is the only piece of state in the chrome.
 */
export default function Taskbar({ status }: TaskbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  // The menu's COMMS row carries the unread count, which is the only place it is listed in a menu.
  const { unreadTotal } = useComms();

  return (
    <div className="relative order-last flex flex-wrap items-center gap-1 border-t-2 border-white bg-sun px-1 py-[3px] text-[10px] font-bold text-ink">
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        // The name it is read with starts with the word on the plate, so the two never drift.
        aria-label="START :: the site menu"
        title="The site menu: every page, and the debaser project's shelves"
        // Pressed in while its menu is open, which is what a Start button does - and off the phone's
        // screen entirely, where the profile picture is the only door.
        className={`hidden sm:inline-flex ${
          menuOpen
            ? 'cursor-pointer rounded-none border-t-2 border-l-2 border-black border-r border-b border-white bg-ena px-2 py-[2px] text-[10px] font-bold text-sun'
            : PLATE
        }`}
      >
        [ START ]
      </button>

      {/* The space a hand-drawn sprite walks in: a looping GIF, 24x24, beside the Start button
          (see assets/sprites/README.txt). Nothing is drawn here - a slot is the room left for
          artwork, and it keeps its size and its dither until the file lands. */}
      <SpriteSlot
        src="/assets/sprites/walk-cycle.gif"
        alt="A little figure pacing the length of the taskbar"
        width={24}
        height={24}
        title="A pixel sprite loops here once assets/sprites/walk-cycle.gif is drawn"
      />

      {/* The tray: the page's own status line, and what the window is encoded in. On a phone the
          status line is left to fill the strip, so the foot of the window is one quiet line rather
          than a row of controls. */}
      <span className="ml-auto flex min-w-0 flex-wrap items-center gap-2 px-1 text-[10px] text-ink">
        <span className="truncate">Status: {status}</span>
        <span aria-hidden="true" className="max-sm:hidden">
          ::
        </span>
        <span className="max-sm:hidden">UTF-8</span>
      </span>

      {menuOpen ? <StartMenu onDismiss={() => setMenuOpen(false)} commsUnread={unreadTotal} /> : null}
    </div>
  );
}

