'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import DesktopSidebar from './DesktopSidebar';
import ProfileControl from './ProfileControl';
import SiteNav from './SiteNav';
import Taskbar from './Taskbar';
import type { NavKey } from './SiteNav';
import { PANEL_INSET, PLATE_LINK, WINDOW_TITLE_BAR } from '../lib/ui/controls';

type SiteWindowProps = {
  /** Title bar text, e.g. `DEBASER_OS - v1.0 [FORUM BOARD]`. */
  title: string;
  /** The taskbar key this page owns, when it is one of them. */
  active?: NavKey;
  /** The right-hand end of the tray, e.g. `Forum Board Active`. */
  status?: string;
  /**
   * Set when this page is a window opened *over* the desktop rather than a page of its own.
   *
   * The site's desktop is the board (see `app/forum/page.tsx`): the music directory, the arcade and
   * the account directory are utilities that open from it, so each is drawn as one of its windows -
   * the title bar carries a `[ CLOSE ]` back to the board and the key the header lights is FORUM's,
   * because that is the surface underneath. Passing nothing keeps a page a page.
   */
  closeHref?: string;
  children: ReactNode;
};

/**
 * The DEBASER_OS window every page is drawn in.
 *
 * One frame for the whole site, so the chrome is written once: the title bar, the page, the side
 * panel on the right and the taskbar along the foot. Pages hand in their content alone.
 *
 * The title bar carries no minimise or maximise. They were decoration - there is no window manager
 * behind them on a page - so on a phone that corner holds the one thing worth reaching for from the
 * top of the window: the visitor's profile picture, or a log-in button before they have an account
 * (see ./ProfileControl.tsx). On a wide screen the corner stays empty and the side panel does that
 * job with room to breathe (see ./DesktopSidebar.tsx). A `[ CLOSE ]` does appear - a window opened
 * over the desktop has somewhere to close back to, and that is exactly what the plate says.
 *
 * Client-side because the chrome is: the taskbar reads the unread badge and opens the Start menu,
 * the profile control opens a menu, and the side panel remembers whether it is collapsed.
 */
export default function SiteWindow({ title, active, status = 'Ready', closeHref, children }: SiteWindowProps) {
  return (
    // The bottom padding is the player's: its bar is fixed to the bottom of the viewport, and the
    // window is short enough that the bar and the taskbar do not fight over the same strip of
    // screen (see ./MusicPlayer.tsx). The surface behind the window is the desktop's own tile.
    //
    // `select-none` is the chrome's, not the archive's: a page of writing is meant to be quoted
    // from, so the panel below turns selection back on for what it holds (and the taskbar, which is
    // no writing at all, keeps the window's).
    <main className="desktop-tile flex min-h-screen items-center justify-center p-2 pb-16 font-mono select-none sm:p-4 sm:pb-16">
      <div className="flex h-[84vh] w-[95vw] max-w-[1280px] flex-col rounded-none border-t-2 border-l-2 border-white border-r-2 border-b-2 border-black bg-[#c0c0c0] shadow-2xl">

        {/* Title Bar: the window title, the close plate when this is a window over the desktop, and
            the profile control on a phone. */}
        <div className={WINDOW_TITLE_BAR}>
          <span className="truncate">{title}</span>
          <span className="flex items-center gap-2">
            {closeHref === undefined ? null : (
              <Link href={closeHref} className={PLATE_LINK} title="Close this window and go back to the board">
                [ X CLOSE ]
              </Link>
            )}
            <ProfileControl />
          </span>
        </div>

        {/* The page tabs: the header, and the first thing under the title bar. */}
        <SiteNav active={active} />

        {/*
         * Taskbar: the Start menu and the tray, at the foot of the window.
         *
         * Written before the page and pulled to the foot with `order-last`, so a keyboard user reads
         * the page before the tray while the window still looks like a desktop.
         */}
        <Taskbar status={status} />

        {/* Page and side panel */}
        <div className="flex min-h-0 flex-1">
          <div
            className={`m-2 min-w-0 flex-1 overflow-y-auto ${PANEL_INSET} bg-white p-4 text-black select-text sm:p-6`}
          >
            {children}
          </div>

          <DesktopSidebar />
        </div>

      </div>
    </main>
  );
}
