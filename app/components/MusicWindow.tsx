'use client';

import Link from 'next/link';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  MUSIC_HREF,
  closeMusic,
  musicRequested,
  musicScreenRequested,
  musicWindowState,
  openMusic,
  subscribeToMusicWindow,
} from '../lib/audio/music-window';
import DockWindow from './DockWindow';
import PersonalLibrary from './PersonalLibrary';

/**
 * The music window, docked beside the board, with two screens.
 *
 * Drawn once, in `layout.tsx`, outside the page - which is what makes it a window: opening it,
 * filtering it or folding a folder re-renders *this*, and the board behind it is not touched at all.
 * Nothing about the board's state is involved and no provider value changes, so a reader can dig
 * through the shelf mid-thread without the thread moving under them.
 *
 * **One screen since 2026-10-24.** The window is the reader's own music: what they liked, and the
 * lists they made. The ARCHIVE screen - the file browser the shelf had always been - moved to the
 * media catalogue page (`/media?kind=audio`, SPEC-media-catalogue.md, decisions 2 and 3), where every
 * file the site holds is listed; the tab that used to switch to it is a link there now, so a reader
 * who reaches for it still gets the shelf, on the page that holds it. `/forum?music=1` and
 * `/forum?music=mine` both open this window.
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

  if (!state.open) return null;

  return (
    <DockWindow
      // One word: the tabs right under it already say which screen is on (SPEC-efficiency.md).
      title="MUSIC"
      onClose={close}
      id="music"
      defaultSize={{ w: 576, h: 700 }}
      minSize={{ w: 380, h: 260 }}
    >
      {/* The strip the two screens shared: MY MUSIC is on, and ARCHIVE is the link to where it went. */}
      <div className="mb-2 flex items-stretch gap-1">
        <Link
          href={MUSIC_HREF}
          onClick={close}
          className="key cursor-pointer px-2 py-1 text-label max-sm:min-h-tap max-sm:px-3 max-sm:text-sm"
        >
          [ ARCHIVE ]
        </Link>
        <span
          aria-current="true"
          className="key key-fill [--key-fill:var(--color-ink)] px-2 py-1 text-label text-paper max-sm:min-h-tap max-sm:px-3 max-sm:text-sm"
        >
          [ MY MUSIC ]
        </span>
      </div>

      <PersonalLibrary />
    </DockWindow>
  );
}
