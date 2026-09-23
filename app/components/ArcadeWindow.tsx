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
import GamesHub from './GamesHub';
import PopoutWindow from './PopoutWindow';

/**
 * The arcade, as a window over whatever is being read.
 *
 * Drawn once, in `layout.tsx`, beside the player bar and for the same reason: the arcade is not a
 * page you go to any more. A challenge from a post, the header's key and the bell's invitation all
 * open *this*, over the thread or the directory the reader is standing on, so nobody loses their
 * place to play a game.
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
   * the window mounts: the header's key and the board share a route, so pressing that key while
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
    <PopoutWindow
      title={arcadeTitle(state.focus)}
      badge="[ ARCADE ]"
      onClose={close}
      maxWidth="max-w-3xl"
      status="PRESS ESC, OR CLICK THE DESKTOP, TO GO BACK TO WHAT YOU WERE READING"
    >
      <GamesHub focus={state.focus} />
    </PopoutWindow>
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
