'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import DesktopSidebar from './DesktopSidebar';
import FullWindowKey from './FullWindowKey';
import ProfileControl from './ProfileControl';
import SiteNav from './SiteNav';
import type { NavKey } from './SiteNav';
import { WINDOW_TITLE_BAR } from '../lib/ui/controls';
import { chosenFill, subscribeToChosenFill } from '../lib/ui/site-fill';
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
  /**
   * A tool that wants every pixel (the beat box, SPEC-beatbox-ui.md): the window fills the screen between the guest strip
   * and the music bar, the title and the START strip stand aside on a desktop, the page has no padding, and the side panel
   * starts folded for this page only (what the reader chose for the other pages is untouched).
   */
  fill?: boolean;
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
export default function SiteWindow({ title, active, tip, fill = false, children }: SiteWindowProps) {
  // The reader's own choice, from the FILL WINDOW key at the end of the top bar. Kept apart from the page's `fill`, which is never written
  // anywhere, so leaving a page that fills by itself finds what the reader chose. A page that fills by itself has no key: there's nothing
  // for it to do there. The choice lays the window out through a mark on `<html>` and the stylesheet (`data-site-window` below,
  // globals.css beside `.desktop-tile`), not through classes swapped in here, so a reload paints it filled from the first frame; `chosen`
  // only tells the key which way it is. The side panel is left as the reader has it: only a page's own `fill` folds it.
  const chosen = useSyncExternalStore(subscribeToChosenFill, chosenFill, () => false);
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
    <main data-site-window="desk" className={`desktop-tile flex h-dvh flex-col items-center font-mono select-none ${fill ? 'p-2 sm:p-4 md:p-0' : 'p-2 sm:p-4'}`}>
      <div aria-hidden="true" className="h-[var(--top-bar,0px)] shrink-0" />
      <div
        data-site-window="frame"
        className={
          fill
            ? 'my-auto flex h-[84vh] max-h-[84dvh] min-h-[16rem] w-[95vw] max-w-[1280px] flex-col frame bg-sun-pale md:my-0 md:h-auto md:max-h-none md:min-h-0 md:w-full md:max-w-none md:flex-1'
            : 'my-auto flex h-[84vh] max-h-[84dvh] min-h-[16rem] w-[95vw] max-w-[1280px] flex-col frame bg-sun-pale'
        }
      >

        {/* Title Bar: the window title and the profile control on a phone. The same on every page:
            USERS and MEDIA used to carry a `[ × ]` close key here, which pushed their title and its
            rules left of every other page's (Luke, 2026-10-24) - a page is not a window over the
            board, and the band under this bar already goes everywhere. */}
        <div data-site-window="title" className={fill ? `${WINDOW_TITLE_BAR} md:hidden` : WINDOW_TITLE_BAR}>
          <span className="truncate" title={tip}>
            {title}
          </span>
          <span className="flex items-center gap-2">
            <ProfileControl />
          </span>
        </div>

        {/* The page tabs: the header, and the first thing under the title bar. FILL WINDOW sits at its far end in both states (it was in
            the title line when normal and here when filled until 2026-11-14), so it is one key in one place. */}
        <SiteNav active={active} endKey={fill ? undefined : <FullWindowKey on={chosen} />} />

        {/* No strip along the foot (Luke, 2026-11-14: "remove the 'start' button and the extra section it occupies"): the page runs to
            the window's bottom edge. ./Taskbar.tsx and ./StartMenu.tsx are kept in the repo, not drawn. */}

        {/* Page and side panel */}
        <div className="flex min-h-0 flex-1">
          <div
            data-scroll-pane="page"
            className={`min-w-0 flex-1 overflow-y-auto bg-paper text-ink select-text ${fill ? '' : 'p-4 sm:p-6'}`}
          >
            <GuestPrompt />
            {children}
          </div>

          <DesktopSidebar foldedOnThisPage={fill} />
        </div>

      </div>
      {/* ...and above the stream's TV box while a room is folded away (`--stream-box`, ./WatchWindow.tsx). */}
      <div
        aria-hidden="true"
        className="h-[max(var(--bottom-bar,3.5rem),var(--stream-box,0px))] shrink-0 sm:h-[max(var(--bottom-bar,3rem),var(--stream-box,0px))]"
      />
    </main>
  );
}
