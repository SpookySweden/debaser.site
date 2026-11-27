'use client';

import { PLATE } from '../../lib/ui/controls';
import { explain } from '../../lib/ui/explain';

/**
 * The view while a page is asked for, or after STOP: no longer an empty box. A dithered field, and on it only what is true: the step the
 * eye has said, the address and which eye. A scan line steps down the field while it is busy (globals.css, `.seeing-acquiring`); it holds
 * still under reduced motion and once stopped.
 */
export default function SeeingAcquiring({ words, address, eye, busy, onAgain }: { words: string; address: string; eye: string; busy: boolean; onAgain: () => void }) {
  return (
    <div className="seeing-acquiring flex min-w-0 flex-1 items-center justify-center p-4" data-seeing-acquiring={busy ? 'busy' : 'stopped'}>
      <div className="frame max-w-prose min-w-0 bg-paper p-3 text-label text-ink">
        <p className="title-line text-ink">{words}</p>
        <p className="mt-2 break-all">{address}</p>
        <p className="mt-1 text-ink-quiet">{eye}</p>
        {busy ? null : (
          <button type="button" onClick={onAgain} className={`${PLATE} mt-2`} {...explain('Asks the same eye for the same address again, from the start.', 'After STOP, or when a page took too long: often the second try gets through.')}>
            [ ASK AGAIN ]
          </button>
        )}
      </div>
    </div>
  );
}
