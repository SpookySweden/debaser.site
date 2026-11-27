'use client';

import { useState } from 'react';
import { explain } from '../../lib/ui/explain';
import { PLATE, PLATE_MAIN } from '../../lib/ui/controls';

const PUT_AWAY_KEY = 'debaser-seeing-signed-in-later-v1';
const putAway = (): boolean => {
  try {
    return window.sessionStorage.getItem(PUT_AWAY_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * Signed in, as in Chrome or Edge, is the default (Luke, 2026-11-27): the one way is the extension, so BROWSER asks for it first, once a visit, and
 * says plainly where a browser can't have it. Nothing here pretends to be signed in.
 */
export default function SeeingGetSignedIn({ extension, onGet }: { extension: 'missing' | 'old' | 'unable'; onGet: () => void }) {
  const [away, setAway] = useState(putAway);
  if (away) return null;
  const later = () => {
    try {
      window.sessionStorage.setItem(PUT_AWAY_KEY, '1');
    } catch {
      // It goes for this page only.
    }
    setAway(true);
  };
  return (
    <p className="flex flex-wrap items-center gap-2 py-1 text-label text-ink" data-seeing-get-signed-in={extension}>
      {extension === 'unable' ? (
        <>SIGNED IN NEEDS CHROME OR EDGE ON A COMPUTER. HERE PAGES COME THROUGH THE SERVER, SIGNED OUT, WHERE IT IS OPEN TO YOU.</>
      ) : (
        <>
          TO USE IT SIGNED IN, AS YOU WOULD CHROME OR EDGE:
          <button type="button" onClick={onGet} className={PLATE_MAIN} {...explain('Opens the EXTENSION window: the download and the four steps to put it in, or the update.', 'With it, pages open in your own browser, signed in as you, inside BROWSER.')}>
            {extension === 'old' ? 'UPDATE THE EXTENSION' : 'GET THE EXTENSION'}
          </button>
        </>
      )}
      <button type="button" onClick={later} className={PLATE} {...explain('Puts this line away until you next open the site.', 'BROWSER works without the extension: pages then come from the house, signed out.')}>
        {extension === 'unable' ? '[ OK ]' : '[ NOT NOW ]'}
      </button>
    </p>
  );
}
