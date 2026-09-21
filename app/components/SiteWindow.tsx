'use client';

import type { ReactNode } from 'react';
import DesktopSidebar from './DesktopSidebar';
import ProfileControl from './ProfileControl';
import SiteNav from './SiteNav';
import type { NavKey } from './SiteNav';

type SiteWindowProps = {
  /** Title bar text, e.g. `DEBASER_OS - v1.0 [FORUM BOARD]`. */
  title: string;
  /** The taskbar tab this page owns, when it is one of them. */
  active?: NavKey;
  /** The right-hand end of the status bar. */
  status?: string;
  children: ReactNode;
};

/**
 * The DEBASER_OS window every page is drawn in.
 *
 * One frame for the whole site, so the chrome is written once: the title bar, the
 * taskbar, the page, the side panel on the right and the status bar. Pages hand in
 * their content alone.
 *
 * The title bar no longer carries minimise, maximise and close. They were
 * decoration - there is no window manager behind them on a page - so on a phone
 * that corner holds the one thing worth reaching for from the top of the window:
 * the visitor's profile picture, or a log-in button before they have an account
 * (see ./ProfileControl.tsx). On a wide screen the corner stays empty and the side
 * panel does that job with room to breathe (see ./DesktopSidebar.tsx).
 *
 * Client-side because the chrome is: the taskbar reads the unread badge, the
 * profile control opens a menu, and the side panel remembers whether it is
 * collapsed.
 */
export default function SiteWindow({ title, active, status = 'Ready', children }: SiteWindowProps) {
  return (
    // The bottom padding is the player's: its bar is fixed to the bottom of the
    // viewport, and the window is short enough that the bar and the status bar do not
    // fight over the same strip of screen (see ./MusicPlayer.tsx).
    <main className="flex min-h-screen items-center justify-center bg-[#008080] p-2 pb-16 font-mono select-none sm:p-4 sm:pb-16">
      <div className="flex h-[84vh] w-[95vw] flex-col rounded-none border-t-2 border-l-2 border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] shadow-2xl">

        {/* Title Bar: the window title, and the profile control on a phone. */}
        <div className="flex items-center justify-between gap-2 bg-[#000080] px-3 py-1 text-sm font-bold text-white">
          <span className="truncate">{title}</span>
          <ProfileControl />
        </div>

        {/* Taskbar Navigation */}
        <SiteNav active={active} />

        {/* Page and side panel */}
        <div className="flex min-h-0 flex-1">
          <div className="m-2 min-w-0 flex-1 overflow-y-auto rounded-none border-2 border-gray-600 border-inset bg-white p-4 text-black sm:p-6">
            {children}
          </div>

          <DesktopSidebar />
        </div>

        {/* Status Bar */}
        <div className="flex justify-between border-t border-white bg-[#c0c0c0] px-3 py-1 text-xs text-black">
          <span>Status: {status}</span>
          <span>UTF-8</span>
        </div>

      </div>
    </main>
  );
}
