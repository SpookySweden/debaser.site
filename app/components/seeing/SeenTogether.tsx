'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';
import { browserHref, shortName } from '../../lib/seeing/address';
import { askToSee } from '../../lib/seeing/ask';
import { follow, joinTogether, subscribeToTogether, together, togetherOnServer } from '../../lib/seeing/together-store';
import { PLATE } from '../../lib/ui/controls';
import { useAuth } from '../AuthProvider';
import { explain } from '../../lib/ui/explain';

/** In the Room: the page somebody is showing it, and the way to look at it with them. Draws nothing when nobody is. */
export default function SeenTogether({ roomId }: { roomId: string }) {
  const { user } = useAuth();
  const signedIn = user !== null;
  const router = useRouter();
  const state = useSyncExternalStore(subscribeToTogether, together, togetherOnServer);
  useEffect(() => (signedIn ? joinTogether(roomId) : undefined), [roomId, signedIn]);
  const shown = state.roomId === roomId ? state.shown : null;
  if (shown === null) return null;
  return (
    <button
      type="button"
      title={shown.address}
      onClick={() => {
        follow(true);
        askToSee(shown.address);
        router.push(browserHref(null));
      }}
      className={PLATE}
      data-seen-together
      {...explain('Opens in BROWSER the page this room is looking at together, and follows it as it changes.', 'SEEN TOGETHER: when somebody in the room shows a page, this is how you join them on it.')}
    >
      [ PAGE: {shortName(shown.address)} ]
    </button>
  );
}
