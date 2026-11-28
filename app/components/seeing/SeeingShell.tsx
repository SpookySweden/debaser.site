'use client';

import { explain, NOTE } from '../../lib/ui/explain';
import { PLATE, PLATE_MAIN } from '../../lib/ui/controls';

/**
 * A site the server's eye can't show, said instead of a broken page: OWN EYE (here, inside BROWSER: Luke, 2026-11-27), a tab of the browser
 * under a name that says so, or the extension first, and what comes anyway if asked for.
 */
export default function SeeingShell({ site, extension, onOwn, onTab, onGet, onAnyway }: { site: string; extension: 'current' | 'old' | 'missing' | 'unable' | 'asking'; onOwn: () => void; onTab: () => void; onGet: () => void; onAnyway: () => void }) {
  return (
    <div className="seeing-acquiring flex min-w-0 flex-1 items-center justify-center p-4" data-seeing-shell={site}>
      <div className="frame max-w-prose min-w-0 bg-paper p-3 text-label text-ink">
        <p className="title-line text-ink">{site.toUpperCase()} NEEDS YOUR OWN BROWSER</p>
        <p className="mt-2">IT DRAWS ITSELF WITH SCRIPTS THAT ASK FOR MORE THAN A SIGNED-OUT SERVER IS GIVEN, AND ITS VIDEOS NEVER PASS THROUGH THE SERVER.</p>
        {extension === 'current' ? <p className="mt-2">OWN EYE IS YOUR OWN BROWSER, SIGNED IN AS YOU: IT SHOWS THE SITE HERE, INSIDE BROWSER. IF IT STAYS BLANK HERE, THE SITE REFUSES TO BE INSIDE ANOTHER: A TAB OF YOUR BROWSER SHOWS IT AS USUAL.</p> : null}
        <p className="mt-2 flex flex-wrap gap-1">
          {extension === 'current' ? (
            <>
              <button type="button" onClick={onOwn} className={PLATE_MAIN} data-seeing-shell-own {...explain('Shows it here, inside BROWSER, from your own browser: signed in as you where the site allows it. No tab of your browser is opened.', 'This site only works properly in your own browser.')}>
                SHOW IT HERE WITH OWN EYE: YOUR BROWSER, SIGNED IN
              </button>
              <button type="button" onClick={onTab} title="In an ordinary tab of your browser, where every site works as usual" className={PLATE} {...explain('Opens it in an ordinary tab of your own browser, signed in as you.', 'For when the site stays blank inside BROWSER: in a tab, it is exactly as in your browser.', NOTE.leaves)}>
                [ IN A TAB ↗ ]
              </button>
            </>
          ) : extension === 'unable' ? (
            <span>SIGNED IN NEEDS CHROME OR EDGE ON A COMPUTER.</span>
          ) : (
            <button type="button" onClick={onGet} className={PLATE_MAIN} {...explain('Opens the EXTENSION window, with the download.', 'With it, this site is shown here from your own browser, signed in.')}>
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
