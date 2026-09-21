'use client';

import Link from 'next/link';
import { useComms } from './CommsProvider';

type NavKey = 'home' | 'concepts' | 'forum' | 'comms' | 'users' | 'account';

type NavItem = {
  key: NavKey;
  label: string;
  href: string;
};

const NAV_ITEMS: NavItem[] = [
  { key: 'home', label: 'HOME', href: '/' },
  { key: 'concepts', label: 'CONCEPTS', href: '/concepts' },
  { key: 'forum', label: 'FORUM', href: '/forum' },
  { key: 'comms', label: 'COMMS', href: '/comms' },
  { key: 'users', label: 'USERS', href: '/users' },
  { key: 'account', label: 'ACCOUNT', href: '/account' },
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
 * notification window clears when a message is put on screen.
 */
export default function SiteNav({ active }: { active: NavKey }) {
  const { unreadTotal } = useComms();

  return (
    <div className="bg-[#c0c0c0] px-2 py-1 border-b-2 border-gray-600 flex gap-1">
      {NAV_ITEMS.map((item) => {
        const unread = item.key === 'comms' ? unreadTotal : 0;

        return (
          <Link key={item.key} href={item.href}>
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

