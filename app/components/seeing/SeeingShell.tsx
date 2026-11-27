'use client';

import { explain, NOTE } from '../../lib/ui/explain';
import { PLATE, PLATE_MAIN } from '../../lib/ui/controls';

/** A site the server's eye can't show, said instead of a broken page: OWN EYE, or the extension first, and what comes anyway if asked for. */
export default function SeeingShell({ site, extension, onOwn, onGet, onAnyway }: { site: string; extension: 'current' | 'old' | 'missing' | 'unable' | 'asking'; onOwn: () => void; onGet: () => void; onAnyway: () => void }) {
  return (
    <div className="seeing-acquiring flex min-w-0 flex-1 items-center justify-center p-4" data-seeing-shell={site}>
      <div className="frame max-w-prose min-w-0 bg-paper p-3 text-label text-ink">
        <p className="title-line text-ink">{site.toUpperCase()} NEEDS YOUR OWN BROWSER</p>
        <p className="mt-2">IT DRAWS ITSELF WITH SCRIPTS THAT ASK FOR MORE THAN A SIGNED-OUT SERVER IS GIVEN, AND ITS VIDEOS NEVER PASS THROUGH THE SERVER.</p>
        <p className="mt-2 flex flex-wrap gap-1">
          {extension === 'current' ? (
            <button type="button" onClick={onOwn} className={PLATE_MAIN} {...explain('Opens it in an ordinary tab of your own browser, signed in as you.', 'This site only works properly in your own browser.', NOTE.leaves)}>
              OPEN IT IN OWN EYE ↗
            </button>
          ) : extension === 'unable' ? (
            <span>SIGNED IN NEEDS CHROME OR EDGE ON A COMPUTER.</span>
          ) : (
            <button type="button" onClick={onGet} className={PLATE_MAIN} {...explain('Opens the EXTENSION window, with the download.', 'With it, this site opens in your own browser, signed in.')}>
              GET THE EXTENSION
            </button>
          )}
          <button type="button" onClick={onAnyway} title="Through the server, signed out: mostly empty boxes" className={PLATE} {...explain('Asks the server for the page anyway, signed out.', 'To see what the house gets: mostly empty boxes, since the site builds itself with scripts and its videos never pass through.')}>
            [ SHOW WHAT COMES ANYWAY ]
          </button>
        </p>
      </div>
    </div>
  );
}
