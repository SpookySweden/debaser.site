'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { DEBASER_PROJECT, PROJECT_SECTIONS } from '../lib/projects/debaser';
import { NAV_ITEMS } from './SiteNav';

/**
 * A row in the menu: flat until the pointer is on it, the way a desktop menu reads - a column of
 * bevelled plates would look like a toolbar lying on its side.
 *
 * The small-screen height is deliberate: on a phone the menu is the whole of the site's navigation,
 * so every row is thumb-sized there even though it is a line of text on a wide screen. The display
 * is left to the row itself, so a row that a phone hides can say `hidden lg:flex` without fighting
 * a `flex` in here.
 */
const MENU_ROW =
  'w-full cursor-pointer items-center px-2 py-[5px] text-left text-[11px] font-bold text-black hover:bg-[#000080] hover:text-white max-sm:min-h-11 max-sm:px-3 max-sm:text-sm';

type StartMenuProps = {
  /** Closes the menu. Every row is a navigation, so choosing one is the end of it. */
  onDismiss: () => void;
  /**
   * Messages waiting, so the COMMS row can say so on a phone - where this menu is the only place
   * that row appears (passed in rather than read here, which keeps this a list drawer).
   */
  commsUnread?: number;
};

/**
 * The Start menu: everything the desktop can open, in one list.
 *
 * On a wide screen that is the site's five keys and then the debaser project's shelves, in the order
 * the project page lists them. On a phone it is what the header does not already offer: HOME and
 * FORUM are the tabs at the top and ACCOUNT is behind the picture in the title bar, so those rows
 * fold away here rather than being a second way to the same page (`mobile` on each key decides it,
 * see ./SiteNav.tsx). Both halves are drawn from the lists the tabs and the project strip already
 * read, so a page added in one place appears here by itself.
 *
 * It opens upward out of the taskbar at the foot of the window, carries the vertical name strip a
 * menu of this era carried down its left edge, and closes on ESC, on a click anywhere else, or on
 * a row being chosen.
 */
export default function StartMenu({ onDismiss, commsUnread = 0 }: StartMenuProps) {
  const frame = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };

    // A click anywhere outside the menu closes it, which is the behaviour the rest of the
    // desktop's pop-ups have (see ./PopoutWindow.tsx).
    const onPointerDown = (event: MouseEvent) => {
      if (frame.current !== null && !frame.current.contains(event.target as Node)) onDismiss();
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [onDismiss]);

  return (
    // A nav rather than a `role="menu"`: this holds two short lists of links, tabbed through like
    // any other list, and a menu role promises arrow-key focus handling that nothing here does.
    // Claiming to be a menu without behaving like one is worse for a screen reader than being what
    // it is.
    <nav
      ref={frame}
      aria-label="Site menu"
      className="absolute bottom-full left-0 z-[70] mb-1 flex w-64 rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] shadow-2xl"
    >
      {/* The spine: the name, read the way a Win95 menu's was - bottom to top. */}
      <div className="flex w-6 shrink-0 items-end justify-center bg-[#000080] py-2">
        <span className="rotate-180 text-[10px] font-bold text-white [writing-mode:vertical-rl]">
          {DEBASER_PROJECT.title}
        </span>
      </div>

      <div className="min-w-0 flex-1 py-1">
        {NAV_ITEMS.map((item) => {
          // A key the header already carries on a phone is drawn only on a wide screen, so no page
          // is reachable two ways at once (`mobile` in ./SiteNav.tsx is the list).
          const display = item.mobile === 'start' ? 'flex' : 'hidden lg:flex';
          // The count belongs to the COMMS row, and on a wide screen the tab above already says it.
          const unread = item.key === 'comms' && commsUnread > 0 ? ` (${commsUnread})` : '';

          return (
            <Link key={item.key} href={item.href} onClick={onDismiss} className={`${display} ${MENU_ROW}`}>
              {item.label}
              {unread === '' ? null : <span className="lg:hidden">{unread}</span>}
            </Link>
          );
        })}

        <div className="mt-1 border-t border-gray-500 pt-1">
          <p className="px-2 pb-1 text-[10px] font-bold text-gray-700">PROJECT SHELVES</p>

          {PROJECT_SECTIONS.map((section) => (
            <Link
              key={section.id}
              href={section.href}
              onClick={onDismiss}
              title={section.summary}
              className={MENU_ROW}
            >
              {section.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}