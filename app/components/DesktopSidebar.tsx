'use client';

import { useSyncExternalStore } from 'react';
import SidebarComms from './SidebarComms';
import SidebarProfile from './SidebarProfile';
import UserDirectory from './UserDirectory';
import { TITLE_BAR_INACTIVE } from '../lib/ui/controls';

/**
 * Where the panel remembers whether it is open. Named like the store keys so the
 * browser's storage reads as one set of settings.
 */
const SIDEBAR_STORAGE_KEY = 'debaser.shell.sidebar.v1';

const RAIL_BUTTON =
  'cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-sun-pale px-2 py-[2px] text-[10px] font-bold text-black hover:bg-gray-300';

/**
 * The panel's answer, in one place rather than in each window.
 *
 * A tiny store read through `useSyncExternalStore`: it is resolved once on the
 * client, the server renders it open, and React swaps in what the browser
 * remembered after hydration instead of complaining about a mismatch. Writing
 * through `setSidebarOpen` tells every mounted window at once, so collapsing the
 * panel on one page keeps it collapsed on the next.
 */
const listeners = new Set<() => void>();

function readStored(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) !== 'closed';
  } catch {
    // No storage (private mode, blocked cookies): the panel just starts open.
    return true;
  }
}

let open = typeof window === 'undefined' ? true : readStored();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function getSnapshot(): boolean {
  return open;
}

function getServerSnapshot(): boolean {
  return true;
}

function setSidebarOpen(next: boolean): void {
  open = next;

  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? 'open' : 'closed');
  } catch {
    // Storage unavailable: the panel still opens and closes for this session.
  }

  for (const listener of listeners) listener();
}

/**
 * The side panel: the profile, the conversations and the directory, on the right.
 *
 * It lives inside the DEBASER_OS window rather than floating beside it, so it
 * shares the title bar and the taskbar with the page and scrolls on its own. On a
 * wide screen it is the only place the visitor needs for the account side of the
 * site - the banner keeps the reading tabs, and the phone gets the profile picture
 * at the top instead (see ./ProfileControl.tsx).
 *
 * Collapsed, it leaves a rail with the button that brings it back.
 */
export default function DesktopSidebar() {
  const isOpen = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (!isOpen) {
    return (
      <div className="hidden w-7 shrink-0 flex-col items-center gap-2 border-l-2 border-gray-600 bg-sun-pale py-2 lg:flex">
        <button type="button" onClick={() => setSidebarOpen(true)} title="Open the side panel" className={RAIL_BUTTON}>
          {'<'}
        </button>
        <span className="text-[10px] font-bold text-gray-700 [writing-mode:vertical-rl]">SIDE PANEL</span>
      </div>
    );
  }

  return (
    <aside className="hidden w-72 shrink-0 flex-col border-l-2 border-gray-600 bg-sun-pale lg:flex">
      <div className={TITLE_BAR_INACTIVE}>
        <span>SIDE PANEL</span>
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          title="Collapse the side panel"
          className="cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-sun-pale px-2 text-[10px] font-bold text-black hover:bg-gray-300"
        >
          {'>'}
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        <SidebarProfile />
        <SidebarComms />
        <UserDirectory compact />
      </div>
    </aside>
  );
}
