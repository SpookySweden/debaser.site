'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { DEBASER_PROJECT, PROJECT_SECTIONS } from '../lib/projects/debaser';
import { NAV_ITEMS, SIDE_ARCADE, SIDE_MUSIC } from './SiteNav';

/**
 * A row in the menu: flat until the pointer is on it, the way a desktop menu reads - a column of
 * bevelled plates would look like a toolbar lying on its side.
 *
 * The row carries the key's *word*, unlike the header above it, because this is the screen where a
 * reader who does not know what a glyph means finds out: the mark is drawn beside the word rather
 * than instead of it, so the menu doubles as the legend (see app/lib/ui/icons.ts).
 */
const MENU_ROW =
  'flex w-full cursor-pointer items-center gap-2 px-2 py-[5px] text-left text-[11px] font-bold text-ink hover:bg-ena hover:text-sun max-sm:min-h-11 max-sm:px-3 max-sm:text-sm';

type StartMenuProps = {
  /** Closes the menu. Every row is a navigation, so choosing one is the end of it. */
  onDismiss: () => void;
  /**
   * Messages waiting, so the COMMS row can say so - the count is carried here on every screen the
   * menu is drawn on, and nowhere else on a phone.
   */
  commsUnread?: number;
};

/**
 * The Start menu: everything the desktop can open, in one list.
 *
 * On a wide screen that is the site's five keys, the two utility windows, and then the debaser
 * project's shelves, in the order the project page lists them. On a phone it is what the header does
 * not already offer: HOME and FORUM are the tabs at the top and ACCOUNT is behind the picture in the
 * title bar, so those rows fold away here rather than being a second way to the same page (`mobile`
 * on each key decides it, see ./SiteNav.tsx). Everything is drawn from the lists the tabs, the side
 * panel and the project strip already read, so a key added in one place appears here by itself.
 *
 * The two windows get a shelf of their own rather than sitting in the keys' list, and that is the
 * same separation the header band keeps: those five are places you *go*, and these two open over
 * wherever you are standing. It matters more here than it looks. This menu is the *only* surface a
 * phone has for them - the side panel the keys live in is wide-screen only - so when the arcade and
 * the archive left the header band, leaving them out of here too would have stranded every phone
 * reader with no way to reach either. `Temp/check-shell.cjs` holds the menu to drawing both.
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
      className="absolute bottom-full left-0 z-[70] mb-1 flex w-64 rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale shadow-2xl"
    >
      {/* The spine: the name, read the way a Win95 menu's was - bottom to top. */}
      <div className="flex w-6 shrink-0 items-end justify-center bg-ena py-2">
        <span className="rotate-180 text-[10px] font-bold text-paper [writing-mode:vertical-rl]">
          {DEBASER_PROJECT.title}
        </span>
      </div>

      <div className="min-w-0 flex-1 py-1">
        {NAV_ITEMS.map((item) => {
          // The count belongs to the COMMS row and to no other.
          const unread = item.key === 'comms' && commsUnread > 0 ? ` (${commsUnread})` : '';

          return (
            <Link key={item.key} href={item.href} onClick={onDismiss} className={MENU_ROW}>
              <span aria-hidden="true" className="w-4 shrink-0 text-center text-[13px]">
                {item.mark}
              </span>
              <span>
                {item.label}
                {unread}
              </span>
            </Link>
          );
        })}

        {/* The two windows, on their own shelf. They are links here rather than toggles, because a
            menu row is a navigation: choosing MUSIC from a menu that is about to close cannot also be
            a press that *shuts* the archive the reader just asked for. Opening when shut is the only
            sane answer for a row, which is what `openMusic` / the address effect already do. */}
        <div className="mt-1 border-t border-ink pt-1">
          <p className="px-2 pb-1 text-[10px] font-bold text-ink">WINDOWS</p>

          {[SIDE_ARCADE, SIDE_MUSIC].map((item) => (
            <Link key={item.key} href={item.href} onClick={onDismiss} className={MENU_ROW}>
              <span aria-hidden="true" className="w-4 shrink-0 text-center text-[13px]">
                {item.mark}
              </span>
              <span>{item.label}</span>
            </Link>
          ))}
        </div>

        <div className="mt-1 border-t border-ink pt-1">
          <p className="px-2 pb-1 text-[10px] font-bold text-ink">PROJECT SHELVES</p>

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