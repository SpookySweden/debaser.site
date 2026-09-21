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

type NavItem = {
  key: NavKey;
  label: string;
  href: string;
  /**
   * True for the tabs a phone does not show in the banner.
   *
   * The banner keeps the two reading tabs on a phone and the profile picture at the
   * top of the window carries the rest: the directory, the conversations and the
   * account. On a wide screen every tab is drawn and the side panel sits beside
   * them.
   */
  desktopOnly?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { key: 'home', label: 'HOME', href: '/' },
  { key: 'forum', label: 'FORUM', href: '/forum' },
  { key: 'users', label: 'USERS', href: '/users', desktopOnly: true },
  { key: 'comms', label: 'COMMS', href: '/comms', desktopOnly: true },
  { key: 'account', label: 'ACCOUNT', href: '/account', desktopOnly: true },
];

function navButtonClass(isActive: boolean): string {
  const base = 'text-black px-4 py-1 text-xs font-bold cursor-pointer';
  return isActive
    ? `${base} bg-gray-300 border-t-2 border-l-2 border-black border-r border-b border-white`
    : `${base} bg-[#c0c0c0] border-t border-l border-white border-r-2 border-b-2 border-black hover:bg-gray-300`;
}

/**
 * The taskbar nav.
 *
 * Client-side because the comms entry carries the unread count - the one number
 * on the site that has to move without a reload. It is the same count the
 * notification window clears when a message is put on screen. `active` is left out
 * by pages that are not one of the tabs, so nothing lights up on them.
 *
 * On a phone the banner keeps HOME and FORUM; the rest of the tabs are marked
 * `desktopOnly` and reached from the profile picture at the top of the window.
 */
export default function SiteNav({ active }: { active?: NavKey }) {
  const { unreadTotal } = useComms();

  return (
    <div className="bg-[#c0c0c0] px-2 py-1 border-b-2 border-gray-600 flex gap-1">
      {NAV_ITEMS.map((item) => {
        const unread = item.key === 'comms' ? unreadTotal : 0;

        return (
          <Link key={item.key} href={item.href} className={item.desktopOnly === true ? 'hidden lg:block' : undefined}>
            <button className={navButtonClass(item.key === active)}>
              {item.label}
              {unread === 0 ? '' : ` (${unread})`}
            </button>
          </Link>
        );
      })}
    </div>
  );
}

