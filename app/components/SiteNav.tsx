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
/**
 * The page tabs, and where a phone finds each key.
 *
 * CONCEPTS is not one of them any more: it is a shelf of the debaser project, and
 * the project page listed on the home page is what opens it. Pages under a project
 * (or otherwise off the taskbar) pass no `active` key, which leaves every tab
 * unlit rather than lighting one that does not own the page.
 */
export type NavKey = 'home' | 'forum' | 'users' | 'comms' | 'account';

/**
 * Where a phone keeps a key: the tab strip at the top, the Start menu at the foot, or the account
 * menu behind the picture in the title bar.
 *
 * One key, one place. A phone has three navigation surfaces and no room to be clever with any of
 * them, so the same destination offered twice is a button wasted and a row of chrome stretched for
 * nothing: HOME and FORUM are the tabs (where you read), USERS and COMMS are the menu at the foot
 * (where the rest of the site is), and ACCOUNT is behind your own picture with the rest of the
 * things about you. On a wide screen the axis does not exist - the tabs carry all five and the menu
 * adds the project's shelves.
 */
export type MobileHome = 'tabs' | 'start' | 'account';

export type NavItem = {
  key: NavKey;
  label: string;
  href: string;
  /** Where a phone keeps it. */
  mobile: MobileHome;
};

/**
 * The five keys the desktop carries, in the order the header draws them.
 *
 * Exported because the Start menu offers the same five on a wide screen (see ./StartMenu.tsx) and
 * the account menu offers one of them on a phone: one list, so a key added here is reachable
 * everywhere without anybody remembering to write it down twice. The project's own shelves are the
 * other list the menu draws from, and that one lives with the project (app/lib/projects/debaser.ts).
 */
export const NAV_ITEMS: NavItem[] = [
  { key: 'home', label: 'HOME', href: '/', mobile: 'tabs' },
  { key: 'forum', label: 'FORUM', href: '/forum', mobile: 'tabs' },
  { key: 'users', label: 'USERS', href: '/users', mobile: 'start' },
  { key: 'comms', label: 'COMMS', href: '/comms', mobile: 'start' },
  { key: 'account', label: 'ACCOUNT', href: '/account', mobile: 'account' },
];

/** The keys a phone keeps in one place, in the order that place draws them. */
export function navItemsFor(place: MobileHome): NavItem[] {
  return NAV_ITEMS.filter((item) => item.mobile === place);
}

/**
 * A tab: raised while its page is closed, pressed in while it is the one on screen.
 *
 * A phone gets the flat version instead - no bevel, the open one filled with the navy this site
 * selects things in - because two bevelled plates side by side at the top of a hand's width of
 * screen read as the whole interface rather than as two keys. The height stays: a tab is still
 * something a thumb presses.
 */
function tabClass(isActive: boolean): string {
  const base = 'inline-flex items-center justify-center text-black font-bold leading-none';
  const phone = 'max-sm:min-h-11 max-sm:min-w-[5.5rem] max-sm:border-none max-sm:px-3 max-sm:text-xs';

  return isActive
    ? `${base} ${phone} max-sm:bg-[#000080] max-sm:text-white px-3 py-[3px] text-[11px] bg-gray-300 border-t-2 border-l-2 border-black border-r border-b border-white`
    : `${base} ${phone} max-sm:bg-transparent px-3 py-[3px] text-[11px] bg-[#c0c0c0] border-t border-l border-white border-r-2 border-b-2 border-black hover:bg-gray-300`;
}

/**
 * The page tabs: one key per part of the site, with the open page's pressed in.
 *
 * They are the header of the window - the first thing under the title bar - rather than buttons in
 * the taskbar at its foot, because a tab is where you are and the taskbar is what you can open. The
 * Start menu at the foot still lists the same five on a wide screen (and the project's shelves with
 * them), so a phone loses nothing by three of the tabs folding away: USERS and COMMS move to the
 * foot, ACCOUNT moves behind the picture in the title bar, and each one is still exactly one press
 * away (`mobile` in the list above is what decides it).
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
      className="flex min-w-0 flex-wrap items-center gap-1 border-b-2 border-gray-600 bg-[#c0c0c0] px-2 py-[3px] max-sm:gap-[3px] max-sm:px-1 max-sm:py-[2px]"
    >
      {NAV_ITEMS.map((item) => {
        const unread = item.key === 'comms' ? unreadTotal : 0;
        const classes = tabClass(item.key === active);

        return (
          <Link
            key={item.key}
            href={item.href}
            className={item.mobile === 'tabs' ? classes : `hidden lg:inline-flex ${classes}`}
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

