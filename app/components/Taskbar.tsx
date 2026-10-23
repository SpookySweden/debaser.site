'use client';

import { useState } from 'react';
import { PLATE } from '../lib/ui/controls';
import { useComms } from './CommsProvider';
import SpriteSlot from './SpriteSlot';
import StartMenu from './StartMenu';

/**
 * The taskbar along the foot of the window: the Start button, and the tray.
 *
 * The window's keys are the header (see ./SiteNav.tsx), so the foot strip holds the two things a
 * desktop keeps at the foot of the screen and nowhere else: the way into everything - the Start
 * menu, which lists the same keys as the header *and* the debaser project's shelves - and the sprite
 * slot beside it. The tray's `Status: ... :: UTF-8` line is gone (SPEC-efficiency.md, 2026-10-23): the
 * window's title already names the page, and an encoding is nothing a reader acts on.
 *
 * On a phone the whole strip is gone. A phone's only permanent control is the profile picture in the
 * title bar, which opens the same menu the Start key does (see ./ProfileControl.tsx), and with the
 * status line cut there was nothing left in the strip but a row of height the feed is supposed to own.
 *
 * It is drawn with `order-last` while being written before the page, so a keyboard user meets the
 * page's own content first and the tray last, which is the order they read in.
 *
 * Client-side because the menu opens: that is the only piece of state in the chrome.
 */
export default function Taskbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  // The menu's COMMS row carries the unread count, which is the only place it is listed in a menu.
  const { unreadTotal } = useComms();

  return (
    <div className="relative order-last flex flex-wrap items-center gap-1 border-t-line border-ink px-1 py-0.75 text-label text-ink max-sm:hidden">
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
            ? 'cursor-pointer key key-fill [--key-fill:var(--color-ink)] px-2 py-0.5 text-label font-bold text-paper'
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

      {menuOpen ? <StartMenu onDismiss={() => setMenuOpen(false)} commsUnread={unreadTotal} /> : null}
    </div>
  );
}

