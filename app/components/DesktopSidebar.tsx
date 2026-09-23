'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import SidebarComms from './SidebarComms';
import SidebarProfile from './SidebarProfile';
import UserDirectory from './UserDirectory';
import { SIDE_MUSIC } from './SiteNav';
import {
  musicAddressSpentByClose,
  musicWindowState,
  subscribeToMusicWindow,
  toggleMusic,
} from '../lib/audio/music-window';
import { TITLE_BAR_INACTIVE } from '../lib/ui/controls';

/**
 * Where the panel remembers whether it is open. Named like the store keys so the
 * browser's storage reads as one set of settings.
 */
const SIDEBAR_STORAGE_KEY = 'debaser.shell.sidebar.v1';

const RAIL_BUTTON =
  'cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-sun-pale px-2 py-[2px] text-[10px] font-bold text-ink hover:bg-ice';

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
  const musicState = useSyncExternalStore(subscribeToMusicWindow, musicWindowState, musicWindowState);
  const musicOpen = musicState.open;
  const pathname = usePathname();
  const router = useRouter();

  /**
   * The archive's key: a press opens it, and a second press shuts it.
   *
   * It is a button rather than a link because it is a switch on the screen the archive is drawn over
   * - pressing `♪` twice should leave the window shut, the same way pressing the board's plate twice
   * does. The address is spent with it: this key opens the window by *following* `/forum?music=1`, so
   * leaving that in the URL would make the shut window disagree with where the reader is, and the
   * window's own effect would read it and open the thing straight back up.
   *
   * The query is read off `window.location` here rather than through `useSearchParams`, and that is
   * deliberate: `useSearchParams` opts the whole page out of static prerendering, which is a cost the
   * sidebar should not impose on every screen for a value it only wants at the moment of a press. A
   * click handler runs in the browser by definition, so the address is right there to read.
   */
  const pressMusic = useCallback(() => {
    const asked = window.location.search;
    const wasOpen = musicWindowState().open;

    toggleMusic();

    if (wasOpen && musicAddressSpentByClose(asked)) router.replace(pathname);
  }, [pathname, router]);

  if (!isOpen) {
    return (
      <div className="hidden w-7 shrink-0 flex-col items-center gap-2 border-l-2 border-ink bg-sun-pale py-2 lg:flex">
        <button type="button" onClick={() => setSidebarOpen(true)} title="Open the side panel" className={RAIL_BUTTON}>
          {'<'}
        </button>
        <span className="text-[10px] font-bold text-ink [writing-mode:vertical-rl]">SIDE PANEL</span>
      </div>
    );
  }

  return (
    <aside className="hidden w-72 shrink-0 flex-col border-l-2 border-ink bg-sun-pale lg:flex">
      <div className={TITLE_BAR_INACTIVE}>
        <span>SIDE PANEL</span>
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          title="Collapse the side panel"
          className="cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-sun-pale px-2 text-[10px] font-bold text-ink hover:bg-ice"
        >
          {'>'}
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        <SidebarProfile />

        {/* The archive, where the account it belongs to is.
            `♪` used to sit in the header band with the page keys, which put it in a row of places
            you *go* while it is really a window you open over wherever you are standing - and it put
            it as far from the player bar it controls as the window allows. It is here instead, under
            the profile: one key, its own line, at the thumb-end of the panel rather than mixed into
            a row of pages. It is a link like every other key, so a middle-click or a copy of the
            address still works, and `/forum?music=1` opens the same window the Start menu's shelf
            does (see `SIDE_MUSIC` in ./SiteNav.tsx). */}
        <section className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale">
          <div className={TITLE_BAR_INACTIVE}>
            <span>SHELF</span>
            <span>[ 1 ]</span>
          </div>

          <div className="p-2">
            <button
              type="button"
              onClick={pressMusic}
              aria-haspopup="dialog"
              aria-pressed={musicOpen}
              title={
                musicOpen
                  ? 'Close the music archive'
                  : 'Open the music archive: play a file, or inject one into a post'
              }
              className={`flex w-full cursor-pointer items-center gap-2 rounded-none border-t border-l border-r-2 border-b-2 px-2 py-1 text-[10px] font-bold ${
                musicOpen
                  ? 'border-t-black border-l-black border-r-white border-b-white bg-ena text-sun'
                  : 'border-t-white border-l-white border-black bg-sun text-ink hover:animate-bump hover:bg-ena hover:text-sun'
              }`}
            >
              <span aria-hidden="true" className="text-[13px] leading-none">
                {SIDE_MUSIC.mark}
              </span>
              <span className="min-w-0 flex-1 truncate text-left">{SIDE_MUSIC.label}</span>
              <span aria-hidden="true">{musicOpen ? '[ ON ]' : '[ ▶ ]'}</span>
            </button>
          </div>
        </section>

        <SidebarComms />
        <UserDirectory compact />
      </div>
    </aside>
  );
}
