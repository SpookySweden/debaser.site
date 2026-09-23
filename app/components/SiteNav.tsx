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
};

/**
 * The five keys the desktop carries, in the order the taskbar draws them.
 *
 * Exported because the Start menu offers the same five (see ./StartMenu.tsx): one list, so a key
 * added here is reachable from the menu without anybody remembering to write it down twice. The
 * project's own shelves are the other list the menu draws from, and that one lives with the
 * project (app/lib/projects/debaser.ts).
 */
export const NAV_ITEMS: NavItem[] = [
  { key: 'home', label: 'HOME', href: '/' },
  { key: 'forum', label: 'FORUM', href: '/forum' },
  { key: 'users', label: 'USERS', href: '/users' },
  { key: 'comms', label: 'COMMS', href: '/comms' },
  { key: 'account', label: 'ACCOUNT', href: '/account' },
];

/** A task button: raised while its page is closed, pressed in while it is the one on screen. */
function taskButtonClass(isActive: boolean): string {
  const base = 'text-black px-2 py-[2px] text-[10px] font-bold leading-none';
  return isActive
    ? `${base} bg-gray-300 border-t-2 border-l-2 border-black border-r border-b border-white`
    : `${base} bg-[#c0c0c0] border-t border-l border-white border-r-2 border-b-2 border-black hover:bg-gray-300`;
}

/**
 * The taskbar's task buttons: one per key, with the open page's pressed in.
 *
 * Client-side because the comms entry carries the unread count - the one number on the site that
 * has to move without a reload, and the same count the notification window clears when a message
 * is put on screen. `active` is left out by pages that are not one of the keys, so nothing lights
 * up on them.
 *
 * Hidden below `lg`, where the same five keys are one list away in the Start menu (see
 * ./StartMenu.tsx): a phone has no room for five buttons beside the Start button, and a menu is a
 * better answer than three of them simply going missing.
 */
export default function SiteNav({ active }: { active?: NavKey }) {
  const { unreadTotal } = useComms();

  return (
    <nav aria-label="Site keys" className="flex min-w-0 flex-1 flex-wrap gap-1">
      {NAV_ITEMS.map((item) => {
        const unread = item.key === 'comms' ? unreadTotal : 0;

        return (
          <Link key={item.key} href={item.href} className="hidden lg:block">
            <button type="button" className={taskButtonClass(item.key === active)}>
              {item.label}
              {unread === 0 ? '' : ` (${unread})`}
            </button>
          </Link>
        );
      })}
    </nav>
  );
}

