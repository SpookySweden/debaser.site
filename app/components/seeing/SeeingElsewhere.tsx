'use client';

import { PLATE, PLATE_MAIN } from '../../lib/ui/controls';

/** A page BROWSER opened in OWN EYE, your own browser, in a tab of its own: said here, with the server's eye one press away. */
export default function SeeingElsewhere({ address, onOwn, onMachine, onHere }: { address: string; onOwn: () => void; onMachine: () => void; onHere: () => void }) {
  return (
    <div className="seeing-acquiring flex min-w-0 flex-1 items-center justify-center p-4" data-seeing-elsewhere>
      <div className="frame max-w-prose min-w-0 bg-paper p-3 text-label text-ink">
        <p className="title-line text-ink">IN OWN EYE</p>
        <p className="mt-2">IN AN ORDINARY TAB OF YOUR OWN BROWSER, SIGNED IN AS YOU ARE THERE. THE MACHINE&apos;S LENSES ARE IN ITS SIDE PANEL: ITS KEY IN YOUR BROWSER&apos;S BAR.</p>
        <p className="mt-2 break-all text-ink-quiet">{address}</p>
        <p className="mt-2 flex flex-wrap gap-1">
          <button type="button" onClick={onOwn} className={PLATE_MAIN}>
            OPEN IT IN OWN EYE ↗
          </button>
          <button type="button" onClick={onMachine} title="In the machine's own tab, which shows a site in a frame, with every lens" className={PLATE}>
            [ IN THE MACHINE ↗ ]
          </button>
          <button type="button" onClick={onHere} title="Through the server, signed out, here" className={PLATE}>
            [ SEE IT HERE ]
          </button>
        </p>
      </div>
    </div>
  );
}
