'use client';

import type { ReactNode } from 'react';
import DesktopSidebar from './DesktopSidebar';
import ProfileControl from './ProfileControl';
import SiteNav from './SiteNav';
import Taskbar from './Taskbar';
import type { NavKey } from './SiteNav';
import { WINDOW_TITLE_BAR } from '../lib/ui/controls';
import GuestPrompt from './GuestPrompt';

type SiteWindowProps = {
  /** Title bar text, e.g. `DEBASER_OS - v1.0 [FORUM BOARD]`. */
  title: string;
  /** The taskbar key this page owns, when it is one of them. */
  active?: NavKey;
  /**
   * What the page is for, as the hover tip of the window's title. Every page used to say it in a
   * paragraph under a big `DEBASER.SITE // X` heading, on screen for good (SPEC-efficiency.md moved
   * every explanation into a tip; the heading stays for screen readers only).
   */
  tip?: string;
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
export default function SiteWindow({ title, active, tip, children }: SiteWindowProps) {
  return (
    // The surface behind the window is the desktop's own tile. (The room kept for the player's bar and
    // the guest strip is the two spacers, below.)
    //
    // `select-none` is the chrome's, not the archive's: a page of writing is meant to be quoted
    // from, so the panel below turns selection back on for what it holds (and the taskbar, which is
    // no writing at all, keeps the window's).
    //
    // `84dvh` rather than `84vh`: on a phone `vh` is measured against the *largest* viewport, the one
    // with the URL bar retracted, so a reader who has not scrolled yet gets a window taller than the
    // screen they are looking at. `dvh` follows the visible viewport instead, so the frame fits
    // whether the bar is showing or not. The plain `h-[84vh]` is kept in front of it as the fallback
    // for a browser without `dvh`, which was Baseline in 2022 and is older than anything this site
    // supports - but a fallback that costs one class is cheaper than guessing.
    //
    // Two strips are fixed over the page and publish how much of the screen they cover
    // (../lib/ui/use-edge-reserve.ts): the guest fault across the top (`--top-bar`) and the docked
    // player across the foot (`--bottom-bar`). A spacer at each end of this column keeps that much room,
    // and the window, `my-auto` between them, shrinks when the screen is short - so its title and its
    // taskbar are never behind either strip. With no strip drawn the spacers fall back to what the
    // padding used to keep: nothing at the top, 4rem at the foot (the folded player's key).
    <main className="desktop-tile flex h-dvh flex-col items-center p-2 font-mono select-none sm:p-4">
      <div aria-hidden="true" className="h-[var(--top-bar,0px)] shrink-0" />
      <div className="my-auto flex h-[84vh] max-h-[84dvh] min-h-[16rem] w-[95vw] max-w-[1280px] flex-col frame bg-sun-pale">

        {/* Title Bar: the window title and the profile control on a phone. The same on every page:
            USERS and MEDIA used to carry a `[ × ]` close key here, which pushed their title and its
            rules left of every other page's (Luke, 2026-10-24) - a page is not a window over the
            board, and the band under this bar already goes everywhere. */}
        <div className={WINDOW_TITLE_BAR}>
          <span className="truncate" title={tip}>
            {title}
          </span>
          <span className="flex items-center gap-2">
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
        <Taskbar />

        {/* Page and side panel */}
        <div className="flex min-h-0 flex-1">
          <div
            className="min-w-0 flex-1 overflow-y-auto bg-paper p-4 text-ink select-text sm:p-6"
          >
            <GuestPrompt />
            {children}
          </div>

          <DesktopSidebar />
        </div>

      </div>
      <div aria-hidden="true" className="h-[var(--bottom-bar,3.5rem)] shrink-0 sm:h-[var(--bottom-bar,3rem)]" />
    </main>
  );
}
