'use client';

import { useState } from 'react';
import { PLATE } from '../lib/ui/controls';
import type { NavKey } from './SiteNav';
import SiteNav from './SiteNav';
import StartMenu from './StartMenu';

type TaskbarProps = {
  /** The key whose page is open, when the page is one of them. */
  active?: NavKey;
  /** What the status strip says: the page's own line. */
  status: string;
};

/**
 * The taskbar along the foot of the window.
 *
 * A desktop of this era kept its Start button, the buttons for its open windows and its tray on
 * one strip at the bottom, and this is that strip: `[ START ]` on the left, the site's keys as
 * task buttons beside it (the open page's pressed in), and the status and the encoding in the
 * tray on the right. It replaces a nav strip along the top plus a status line along the foot,
 * which were the same information drawn twice in two places.
 *
 * Nothing here scrolls away: the window is a fixed height with the page scrolling inside it, so
 * the strip is always at the foot of the screen the window draws. On a phone the task buttons
 * fold into the Start menu beside them - the same five keys, one list (see ./StartMenu.tsx).
 *
 * Client-side because the menu opens: that is the only piece of state in the chrome.
 */
export default function Taskbar({ active, status }: TaskbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="relative flex flex-wrap items-center gap-1 border-t-2 border-white bg-[#c0c0c0] px-1 py-[3px] text-[10px] font-bold text-black">
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        // Pressed in while its menu is open, which is what a Start button does.
        className={
          menuOpen
            ? 'cursor-pointer rounded-none border-t-2 border-l-2 border-black border-r border-b border-white bg-gray-300 px-2 py-[2px] text-[10px] font-bold text-black'
            : PLATE
        }
      >
        [ START ]
      </button>

      <SiteNav active={active} />

      {/* The tray: the page's own status line, and what the window is encoded in. */}
      <span className="ml-auto flex min-w-0 flex-wrap items-center gap-2 px-1 text-[9px] text-gray-700">
        <span>Status: {status}</span>
        <span aria-hidden="true">::</span>
        <span>UTF-8</span>
      </span>

      {menuOpen ? <StartMenu onDismiss={() => setMenuOpen(false)} /> : null}
    </div>
  );
}