'use client';

import Link from 'next/link';
import { refusalHelp } from '../../lib/seeing/refusals';
import { took } from '../../lib/seeing/took';
import { PLATE, TITLE_BAR_INACTIVE } from '../../lib/ui/controls';

/**
 * A page that didn't come: the reason, what it means, and what may still be tried, each a key. Under them the trace: only what is known on
 * this side (which eye was asked, the address, how long until it said no), never a step it can't see. A book (`read`) is offered to the site's
 * own reader first, whatever the reason. Below them the rest of the view is a raster with no picture in it (globals.css, `.seeing-dead`,
 * decision 47): a channel with nothing on it, still, never moving.
 */
export default function SeeingRefused({ reason, eye, ms, address, canOld, ownEye, read = null, onAgain, onOld, onOwn }: { reason: string; eye: string; ms: number; address: string; canOld: boolean; ownEye: boolean; read?: string | null; onAgain: () => void; onOld: () => void; onOwn: () => void }) {
  const help = refusalHelp(reason, address);
  const tries = help.tries.filter((each) => (each === 'old' ? canOld : each === 'own' ? ownEye : true));
  return (
    <section aria-label="The page did not come" className="flex min-w-0 flex-1 flex-col overflow-y-auto text-label text-ink" data-seeing-refused>
      <div className="border-b-line border-ink bg-paper p-4">
      <h2 className={TITLE_BAR_INACTIVE}>SOURCE REFUSED: {reason}</h2>
      <p className="mt-2 max-w-prose">{help.means}</p>
      {tries.length > 0 || read !== null ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {read !== null ? (
            <Link href={`/read/${read}`} title="In the site's own reader" className={`${PLATE} inline-flex items-center`}>
              [ READ IT ]
            </Link>
          ) : null}
          {tries.map((each) =>
            each === 'again' ? (
              <button key={each} type="button" onClick={onAgain} className={PLATE}>
                [ TRY AGAIN ]
              </button>
            ) : each === 'old' ? (
              <button key={each} type="button" onClick={onOld} className={PLATE}>
                [ SEE AN OLD COPY ]
              </button>
            ) : each === 'own' ? (
              <button key={each} type="button" title="In your own browser, where you are signed in" onClick={onOwn} className={PLATE}>
                [ OWN EYE ↗ ]
              </button>
            ) : (
              <a key={each} href={address} target="_blank" rel="noopener noreferrer" className={`${PLATE} inline-flex items-center`}>
                [ OPEN SOURCE ↗ ]
              </a>
            ),
          )}
        </div>
      ) : null}
      <dl className="mt-4 max-w-prose border-t-line border-ink pt-2 tabular-nums" data-seeing-trace>
        {[
          ['EYE', eye],
          ['ASKED', address],
          ['ANSWER', `${reason} · ${took(ms)}`],
        ].map(([name, value]) => (
          <div key={name} className="flex gap-2">
            <dt className="w-16 shrink-0 text-ink-quiet">{name}</dt>
            <dd className="min-w-0 break-all">{value}</dd>
          </div>
        ))}
      </dl>
      </div>
      <div aria-hidden="true" className="seeing-dead min-h-12 flex-1" />
    </section>
  );
}
