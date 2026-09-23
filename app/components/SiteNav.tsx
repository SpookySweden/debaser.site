'use client';

import Link from 'next/link';
import { useComms } from './CommsProvider';

/**
 * The taskbar keys.
 *
 * CONCEPTS is not one of them any more: it is a shelf of the debaser project, and
 * the project page listed on the home page is what opens it. Pages under a project
 * (or otherwise off the taskbar) pass no `active` key, which leaves every tab
 * unlit rather than lighting one that does not own the page.
 */
export type NavKey = 'home' | 'forum' | 'users' | 'comms' | 'account';

export type NavItem = {
  key: NavKey;
  label: string;
  href: string;
  /**
   * True for the tabs a phone does not draw in the header.
   *
   * A phone keeps the two reading tabs (HOME and FORUM) and reaches the rest from the profile
   * control at the top of the window and the Start menu at the foot of it, which is a better answer
   * than five tabs squeezed into a hand's width.
   */
  desktopOnly?: boolean;
};

/**
 * The five keys the desktop carries, in the order the header draws them.
 *
 * Exported because the Start menu offers the same five (see ./StartMenu.tsx): one list, so a key
 * added here is reachable from the menu without anybody remembering to write it down twice. The
 * project's own shelves are the other list the menu draws from, and that one lives with the
 * project (app/lib/projects/debaser.ts).
 */
export const NAV_ITEMS: NavItem[] = [
  { key: 'home', label: 'HOME', href: '/' },
  { key: 'forum', label: 'FORUM', href: '/forum' },
  { key: 'users', label: 'USERS', href: '/users', desktopOnly: true },
  { key: 'comms', label: 'COMMS', href: '/comms', desktopOnly: true },
  { key: 'account', label: 'ACCOUNT', href: '/account', desktopOnly: true },
];

/** A tab: raised while its page is closed, pressed in while it is the one on screen. */
function tabClass(isActive: boolean): string {
  const base =
    'inline-flex items-center text-black px-3 py-[3px] text-[11px] font-bold leading-none cursor-pointer max-sm:min-h-11 max-sm:px-4 max-sm:text-sm';
  return isActive
    ? `${base} bg-gray-300 border-t-2 border-l-2 border-black border-r border-b border-white`
    : `${base} bg-[#c0c0c0] border-t border-l border-white border-r-2 border-b-2 border-black hover:bg-gray-300`;
}

/**
 * The page tabs: one key per part of the site, with the open page's pressed in.
 *
 * They are the header of the window - the first thing under the title bar - rather than buttons in
 * the taskbar at its foot, because a tab is where you are and the taskbar is what you can open. The
 * Start menu at the foot still lists the same five (and the project's shelves with them), so a phone
 * loses nothing by the tabs folding away.
 *
 * A tab is a link wearing the tab's own chrome rather than a button inside a link: it is one thing to
 * press, it is what a navigation is, and a control inside a control is neither valid HTML nor
 * something a screen reader reads out cleanly.
 *
 * Client-side because the comms entry carries the unread count - the one number on the site that has
 * to move without a reload, and the same count the notification window clears when a message is put
 * on screen. `active` is left out by pages that are not one of the keys, so nothing lights up on
 * them.
 */
export default function SiteNav({ active }: { active?: NavKey }) {
  const { unreadTotal } = useComms();

  return (
    <nav
      aria-label="Site keys"
      className="flex min-w-0 flex-wrap items-center gap-1 border-b-2 border-gray-600 bg-[#c0c0c0] px-2 py-[3px]"
    >
      {NAV_ITEMS.map((item) => {
        const unread = item.key === 'comms' ? unreadTotal : 0;
        const classes = tabClass(item.key === active);

        return (
          <Link
            key={item.key}
            href={item.href}
            className={item.desktopOnly === true ? `hidden lg:inline-flex ${classes}` : classes}
            aria-current={item.key === active ? 'page' : undefined}
          >
            {item.label}
            {unread === 0 ? '' : ` (${unread})`}
          </Link>
        );
      })}
    </nav>
  );
}

