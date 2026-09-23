'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { DEBASER_PROJECT, PROJECT_SECTIONS } from '../lib/projects/debaser';
import { NAV_ITEMS } from './SiteNav';

/**
 * A row in the menu: flat until the pointer is on it, the way a desktop menu reads - a column of
 * bevelled plates would look like a toolbar lying on its side.
 */
const MENU_ROW =
  'block w-full cursor-pointer px-2 py-[5px] text-left text-[11px] font-bold text-black hover:bg-[#000080] hover:text-white';

type StartMenuProps = {
  /** Closes the menu. Every row is a navigation, so choosing one is the end of it. */
  onDismiss: () => void;
};

/**
 * The Start menu: everything the desktop can open, in one list.
 *
 * The taskbar's task buttons are the wide window's, so this is how a phone reaches the whole site
 * - and it is a nicer list than five buttons anyway: the site's own five keys first, then the
 * debaser project's shelves, in the order the project page lists them. Both halves are drawn from
 * the lists the taskbar and the project strip already read, so a page added in one place appears
 * here by itself.
 *
 * It opens upward out of the taskbar at the foot of the window, carries the vertical name strip a
 * menu of this era carried down its left edge, and closes on ESC, on a click anywhere else, or on
 * a row being chosen.
 */
export default function StartMenu({ onDismiss }: StartMenuProps) {
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
    <div
      ref={frame}
      role="menu"
      aria-label="Start menu"
      className="absolute bottom-full left-0 z-[70] mb-1 flex w-64 rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] shadow-2xl"
    >
      {/* The spine: the name, read the way a Win95 menu's was - bottom to top. */}
      <div className="flex w-6 shrink-0 items-end justify-center bg-[#000080] py-2">
        <span className="rotate-180 text-[10px] font-bold text-white [writing-mode:vertical-rl]">
          {DEBASER_PROJECT.title}
        </span>
      </div>

      <div className="min-w-0 flex-1 py-1">
        {NAV_ITEMS.map((item) => (
          <Link key={item.key} href={item.href} role="menuitem" onClick={onDismiss} className={MENU_ROW}>
            {item.label}
          </Link>
        ))}

        <div className="mt-1 border-t border-gray-500 pt-1">
          <p className="px-2 pb-1 text-[9px] font-bold text-gray-700">PROJECT SHELVES</p>

          {PROJECT_SECTIONS.map((section) => (
            <Link
              key={section.id}
              href={section.href}
              role="menuitem"
              onClick={onDismiss}
              title={section.summary}
              className={MENU_ROW}
            >
              {section.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}