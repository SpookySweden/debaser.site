'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  closeMusic,
  musicRequested,
  musicScreenRequested,
  musicWindowState,
  openMusic,
  showMusicScreen,
  subscribeToMusicWindow,
  type MusicScreen,
} from '../lib/audio/music-window';
import DockWindow from './DockWindow';
import MusicDirectory from './MusicDirectory';
import PersonalLibrary from './PersonalLibrary';

/**
 * The music window, docked beside the board, with two screens.
 *
 * Drawn once, in `layout.tsx`, outside the page - which is what makes it a window: opening it,
 * filtering it or folding a folder re-renders *this*, and the board behind it is not touched at all.
 * Nothing about the board's state is involved and no provider value changes, so a reader can dig
 * through the shelf mid-thread without the thread moving under them.
 *
 * **Two screens, one window.** `archive` is the file browser the shelf has always been. `mine` is the
 * reader's own music: what they liked, and the lists they made. They are the same *place* in the sense
 * that matters - a reader who has the archive open and wants their own list should not watch the frame
 * close and reopen - so the switch is a tab strip inside one window rather than two windows.
 *
 * The address decides which, and both halves of it:
 *
 *   /forum?music=1     the archive (the MUSIC shelf, a post's plate, a tag badge)
 *   /forum?music=mine  the reader's own music
 *
 * which is why the screen is a field on the window's state and not a `useState` here: a link has to be
 * able to name a screen, and a reload has to land on the one it named.
 */
export default function MusicWindow() {
  const state = useSyncExternalStore(subscribeToMusicWindow, musicWindowState, musicWindowState);
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  /** The query as it stands, without the `?`: what the address asks for, if it asks for anything. */
  const asked = search.toString();
  const query = asked.length === 0 ? '' : `?${asked}`;

  // Read whenever the address changes rather than only as the window mounts: the MUSIC shelf and the
  // board share a route, so a link to `/forum?music=1` changes the query without remounting anything.
  useEffect(() => {
    if (musicRequested(query)) openMusic(musicScreenRequested(query));
  }, [query]);

  /**
   * Closes the window, and spends the address with it, so the same link works twice.
   */
  const close = useCallback(() => {
    closeMusic();

    if (musicRequested(query)) router.replace(pathname);
  }, [pathname, query, router]);

  /**
   * Switches screen *and* rewrites the address, so the screen a reader is looking at is the one a
   * reload brings them back to, and the one they can copy out of the bar.
   *
   * `scroll: false` because this is a change *within* a window that is already open: letting the router
   * jump to the top of the board would move the thread the reader is reading, which is the one thing
   * this window exists to avoid.
   */
  const show = useCallback(
    (screen: MusicScreen) => {
      showMusicScreen(screen);
      router.replace(screen === 'mine' ? `${pathname}?music=mine` : `${pathname}?music=1`, { scroll: false });
    },
    [pathname, router],
  );

  if (!state.open) return null;

  return (
    <DockWindow
      title={state.screen === 'mine' ? 'MUSIC :: MY MUSIC' : 'MUSIC :: THE ARCHIVE'}
      badge="[ MP3 ]"
      onClose={close}
      widthClass="sm:w-[min(36rem,calc(100vw-1.5rem))]"
      status={
        state.screen === 'mine'
          ? '♥ LIKED PLAYS THE WHOLE LIST :: THE COMMENT PLATE FILES A POST ABOUT A TRACK'
          : '[ INJECT TO POST ] FILES A TRACK WITH THE POST YOU ARE WRITING :: [ ▶ PLAY ] HANDS IT TO THE PLAYER'
      }
    >
      <div className="mb-2 flex items-stretch gap-1" role="tablist" aria-label="Music screens">
        <ScreenTab
          label="THE ARCHIVE"
          selected={state.screen === 'archive'}
          onSelect={() => show('archive')}
        />
        <ScreenTab label="MY MUSIC" selected={state.screen === 'mine'} onSelect={() => show('mine')} />
      </div>

      {/* Both screens stay *mounted*, and the one that is not on is hidden.
          This is the fix for a bug worth naming: the archive keeps its search box, its sort order, its
          tag drawer and which folders are folded in `useState`, and only its tag filter lives in the
          address. Unmounting it to show MY MUSIC - which is what mounting one at a time does - threw all
          of that away, so a reader who sorted by POSTS, opened a folder, pressed a heart on the other
          screen and came back found the archive sorted by name and every folder shut.

          Hiding rather than unmounting costs nothing that matters: neither screen subscribes to the
          other's state, and a hidden one reads nothing (its effects do not re-run, because nothing it
          depends on changed). What it buys is that the reader never watches the thing they were pointing
          at rearrange itself - the same rule the reveals follow, applied at the scale of a screen. */}
      <div className={state.screen === 'mine' ? 'hidden' : undefined}>
        <MusicDirectory />
      </div>

      <div className={state.screen === 'mine' ? undefined : 'hidden'}>
        <PersonalLibrary />
      </div>
    </DockWindow>
  );
}

/** One tab of the window's strip: a plate, pressed in while its screen is the one on. */
function ScreenTab({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={`cursor-pointer rounded-none border-t border-l border-r-2 border-b-2 px-2 py-1 text-[10px] font-bold max-sm:min-h-11 max-sm:px-3 max-sm:text-sm ${
        selected
          ? 'border-t-black border-l-black border-r-white border-b-white bg-ena text-sun'
          : 'border-t-white border-l-white border-black bg-sun text-ink-plate hover:bg-ice'
      }`}
    >
      {label}
    </button>
  );
}
