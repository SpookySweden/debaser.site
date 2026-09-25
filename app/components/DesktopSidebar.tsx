'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import SidebarComms from './SidebarComms';
import SidebarProfile from './SidebarProfile';
import UserDirectory from './UserDirectory';
import { SIDE_ARCADE, SIDE_MUSIC } from './SiteNav';
import type { NavItem } from './SiteNav';
import {
  arcadeAddressSpentByClose,
  arcadeWindowState,
  subscribeToArcadeWindow,
  toggleArcade,
} from '../lib/games/arcade-window';
import {
  musicAddressSpentByClose,
  musicScreenForHref,
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
  'cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-sun-pale px-2 py-[2px] text-[10px] font-bold text-ink hover:bg-ice max-md:min-h-11 max-md:min-w-11 max-md:text-base';

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
 * One shelf key: a window that opens over wherever the reader is standing.
 *
 * Both keys in the panel's shelf are this, because both are the same thing - a mark, a word, and a
 * switch that says whether the window is up. Writing it once is what keeps them agreeing: a key that
 * gained an `[ ON ]` mark or a hover bump would get it for both, rather than for whichever one
 * somebody remembered.
 *
 * The state it is drawn in is the window's own, handed in rather than read here, so this stays a
 * plain component with no opinion about which window it belongs to.
 */
function ShelfKey({
  item,
  isOpen,
  onPress,
}: {
  item: NavItem;
  isOpen: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-haspopup="dialog"
      aria-pressed={isOpen}
      title={isOpen ? `Close the ${item.label.toLowerCase()}` : `Open the ${item.label.toLowerCase()}`}
      className={`flex w-full cursor-pointer items-center gap-2 rounded-none border-t border-l border-r-2 border-b-2 px-2 py-1 text-[10px] font-bold ${
        isOpen
          ? 'border-t-black border-l-black border-r-white border-b-white bg-ena text-sun'
          : 'border-t-white border-l-white border-black bg-sun text-ink hover:animate-bump hover:bg-ena hover:text-sun'
      }`}
    >
      <span aria-hidden="true" className="text-[13px] leading-none">
        {item.mark}
      </span>
      <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
      <span aria-hidden="true">{isOpen ? '[ ON ]' : '[ ▶ ]'}</span>
    </button>
  );
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
  const arcadeState = useSyncExternalStore(subscribeToArcadeWindow, arcadeWindowState, arcadeWindowState);
  const arcadeOpen = arcadeState.open;
  const pathname = usePathname();
  const router = useRouter();

  /**
   * A press on either shelf key: opening when shut, closing when open.
   *
   * Both keys are *switches*, not links - they sit on the screen their window is drawn over, so a
   * reader who has finished with one presses the same key again rather than hunting for the window's
   * `[ X CLOSE ]`. They work through the same shape here so they cannot drift apart: take the
   * address, ask the window whether it was open, toggle, and spend the address if it was.
   *
   * The address is read off `window.location` rather than through `useSearchParams`, and that is
   * deliberate: `useSearchParams` opts the whole page out of static prerendering, which is a cost the
   * sidebar should not impose on every screen for a value it only wants at the moment of a press. A
   * click handler runs in the browser by definition, so the address is right there to read.
   *
   * Spending it matters because both keys open their window by *following* an address
   * (`/forum?music=1`, `/forum?arcade=1`). Leave that in the URL and the shut window disagrees with
   * where the reader is - and the window's own effect reads the address again and opens the thing
   * straight back up. The two `*AddressSpentByClose` questions answer it for all four arcade
   * addresses and both archive ones.
   */
  const pressShelf = useCallback(
    (wasOpen: boolean, spentByClose: (search: string) => boolean, toggle: () => void) => {
      const asked = window.location.search;

      toggle();

      if (wasOpen && spentByClose(asked)) router.replace(pathname);
    },
    [pathname, router],
  );

  /**
   * The panel's MUSIC key.
   *
   * It opens the screen `SIDE_MUSIC.href` names - the reader's *own* music, `LIBRARY_HREF` - rather
   * than the archive, and it asks the href instead of hardcoding the screen so the two cannot drift.
   * That drift is exactly what was wrong here: `SIDE_MUSIC` has pointed at `LIBRARY_HREF` since the
   * personal screen existed, `Temp/check-music-library.cjs` asserts it, and this press went on opening
   * the archive because it called `toggleMusic()` with no argument. A key whose label, href and
   * behaviour are three separate statements will eventually disagree; there are two now, and one of them
   * is derived.
   *
   * The archive is still one press away and is not orphaned: the Start menu's MUSIC shelf, a post's
   * `♪ MP3` plate and a track's tag badge all link at `MUSIC_HREF`, and the window's own tab strip
   * switches between the two screens without closing.
   */
  const pressMusic = useCallback(
    () => pressShelf(musicWindowState().open, musicAddressSpentByClose, () => toggleMusic(musicScreenForHref(SIDE_MUSIC.href))),
    [pressShelf],
  );

  const pressArcade = useCallback(
    () => pressShelf(arcadeWindowState().open, arcadeAddressSpentByClose, toggleArcade),
    [pressShelf],
  );


  if (!isOpen) {
    return (
      <div className="hidden w-7 shrink-0 flex-col items-center gap-2 border-l-2 border-ink bg-sun-pale py-2 md:flex">
        <button type="button" onClick={() => setSidebarOpen(true)} title="Open the side panel" className={RAIL_BUTTON}>
          {'<'}
        </button>
        <span className="text-[10px] font-bold text-ink [writing-mode:vertical-rl]">SIDE PANEL</span>
      </div>
    );
  }

  return (
    // `w-72` on a wide screen, `w-60` on a tablet: 288px is comfortable beside a 1280px feed and a
    // third of a 700px one. Both the rail and the panel open from `md`, not `lg` - below `md` the
    // phone rule holds (the picture in the title bar is the only door), and from `md` the archive and
    // the arcade would otherwise be unreachable, since `SiteNav`'s keys do not carry them.
    <aside className="hidden w-60 shrink-0 flex-col border-l-2 border-ink bg-sun-pale md:flex lg:w-72">
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

        {/* The shelf: the two windows that open *over* wherever the reader is standing.
            `◄►` and `♪` used to sit in the header band with the page keys, which put them in a row of
            places you *go* while they are really windows you open where you are - and it put them as
            far from the player bar `♪` controls as the window allows. They are here instead, under the
            profile: two keys, at the thumb-end of the panel rather than mixed into a row of pages.

            They are buttons, not links, because a second press must shut what the first opened. Both
            keep the address they open by (`/forum?arcade=1`, `/forum?music=1`), so a copied link and a
            middle-click still work - and so the Start menu's shelves, a post's plates and the bell's
            invitation, which are *links* into the same two windows, are unaffected. See `SIDE_ARCADE`
            and `SIDE_MUSIC` in ./SiteNav.tsx. */}
        <section className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale">
          <div className={TITLE_BAR_INACTIVE}>
            <span>SHELF</span>
            <span>[ 2 ]</span>
          </div>

          <div className="space-y-1 p-2">
            <ShelfKey item={SIDE_ARCADE} isOpen={arcadeOpen} onPress={pressArcade} />
            <ShelfKey item={SIDE_MUSIC} isOpen={musicOpen} onPress={pressMusic} />
          </div>
        </section>

        <SidebarComms />

        <UserDirectory compact />
      </div>
    </aside>
  );
}
