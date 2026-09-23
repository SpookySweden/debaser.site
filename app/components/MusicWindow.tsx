'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  closeMusic,
  musicRequested,
  musicWindowState,
  openMusic,
  subscribeToMusicWindow,
} from '../lib/audio/music-window';
import DockWindow from './DockWindow';
import MusicDirectory from './MusicDirectory';

/**
 * The music archive, docked beside the board.
 *
 * Drawn once, in `layout.tsx`, outside the page - which is what makes it a window: opening the
 * archive, filtering it or folding a folder re-renders *this*, and the board behind it is not touched
 * at all. Nothing about the board's state is involved and no provider value changes, so a reader can
 * dig through the shelf mid-thread without the thread moving under them.
 *
 * The address is one of the ways in (`lib/audio/music-window.ts`): `/forum?music=1` from the MUSIC
 * shelf, and `/forum?music=1&tag=…` from a track's own tag badge, which is how a tag on a post opens
 * the archive already filtered.
 */
export default function MusicWindow() {
  const state = useSyncExternalStore(subscribeToMusicWindow, musicWindowState, musicWindowState);
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  /** The query as it stands, without the `?`: what the address asks for, if it asks for anything. */
  const asked = search.toString();

  // Read whenever the address changes rather than only as the window mounts: the MUSIC shelf and the
  // board share a route, so a link to `/forum?music=1` changes the query without remounting anything.
  useEffect(() => {
    if (musicRequested(asked.length === 0 ? '' : `?${asked}`)) openMusic();
  }, [asked]);

  /** Closes the window, and spends the address with it, so the same link works twice. */
  const close = useCallback(() => {
    closeMusic();

    if (musicRequested(asked.length === 0 ? '' : `?${asked}`)) router.replace(pathname);
  }, [asked, pathname, router]);

  if (!state.open) return null;

  return (
    <DockWindow
      title="MUSIC :: THE ARCHIVE"
      badge="[ MP3 ]"
      onClose={close}
      widthClass="sm:w-[min(36rem,calc(100vw-1.5rem))]"
      status="[ INJECT TO POST ] FILES A TRACK WITH THE POST YOU ARE WRITING :: [ ▶ PLAY ] HANDS IT TO THE PLAYER"
    >
      <MusicDirectory />
    </DockWindow>
  );
}
