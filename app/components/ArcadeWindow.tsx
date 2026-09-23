'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  arcadeFocusFromSearch,
  arcadeWindowState,
  closeArcade,
  openArcade,
  subscribeToArcadeWindow,
  type ArcadeFocus,
} from '../lib/games/arcade-window';
import DockWindow from './DockWindow';
import GamesHub from './GamesHub';

/**
 * The arcade, docked beside whatever is being read.
 *
 * Drawn once, in `layout.tsx`, for the same reason the player bar is: the arcade is not a page you go
 * to any more. A challenge from a post, the side panel's own key and the bell's invitation all open
 * *this*, against the thread the reader is standing in - docked at the foot of it and draggable, with
 * the board still on screen and still usable, so nobody loses their place to answer a knock.
 *
 * It is the same `GamesHub` the arcade floor has always been, told what it was opened to do. The
 * window is the only thing that knows about the address (`lib/games/arcade-window.ts` reads it), so
 * the hub itself stays a screen with no opinion about URLs.
 */
export default function ArcadeWindow() {
  const state = useSyncExternalStore(subscribeToArcadeWindow, arcadeWindowState, arcadeWindowState);
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  /** The query as it stands, without the `?`: what the address asks for, if it asks for anything. */
  const asked = search.toString();

  /**
   * A link is one of the ways in, and the address is read whenever it changes rather than only as
   * the window mounts: the side panel's key and the window share a route, so pressing that key while
   * already on the board changes the query without remounting anything.
   */
  useEffect(() => {
    const named = arcadeFocusFromSearch(asked.length === 0 ? '' : `?${asked}`);
    if (named !== null) openArcade(named);
  }, [asked]);

  /**
   * Closes the window, and spends the address with it.
   *
   * An address that names the arcade would otherwise already be "where we are" the next time the
   * same key is pressed, so the link would stop working after one use. Clearing it is what keeps the
   * promise a link makes - press it and the window opens - while the window is closed.
   */
  const close = useCallback(() => {
    closeArcade();

    if (arcadeFocusFromSearch(asked.length === 0 ? '' : `?${asked}`) !== null) router.replace(pathname);
  }, [asked, pathname, router]);

  if (!state.open) return null;

  return (
    <DockWindow
      title={arcadeTitle(state.focus)}
      badge="[ ARCADE ]"
      onClose={close}
      dock="bottom"
      widthClass="sm:w-[min(28rem,calc(100vw-1.5rem))]"
      status="THE BOARD IS STILL BEHIND THIS :: PLAYS SOLO, OR OPENS ON BOTH SCREENS WHEN THEY ANSWER"
    >
      <GamesHub focus={state.focus} />
    </DockWindow>
  );
}

/** What the title bar says the window is for. */
function arcadeTitle(focus: ArcadeFocus): string {
  switch (focus.kind) {
    case 'invite':
      return 'ARCADE :: AN INVITATION';
    case 'challenge':
      return 'ARCADE :: CHALLENGE';
    default:
      return 'ARCADE :: THE FLOOR';
  }
}
