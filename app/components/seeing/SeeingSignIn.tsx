'use client';

import { explain, NOTE } from '../../lib/ui/explain';
import { PLATE, PLATE_MAIN } from '../../lib/ui/controls';

/**
 * On entering a page of a site that offers it (YouTube, for now) through the server's eye: one line over the page. With the extension, LOG IN opens
 * it in an ordinary tab of the reader's own browser, signed in as they are there (or signing in, on the site's own page). Without it, it is got first.
 */
export default function SeeingSignIn({ site, has, onLogIn, onGet, onNotNow, onNever }: { site: string; has: boolean; onLogIn: () => void; onGet: () => void; onNotNow: () => void; onNever: () => void }) {
  const name = site.replace(/\.com$/, '').toUpperCase();
  return (
    <p className="flex flex-wrap items-center gap-2 py-1 text-label text-ink" data-seeing-sign-in={has ? 'add' : 'get'}>
      {has ? (
        <button type="button" onClick={onLogIn} title="In an ordinary tab of your own browser, signed in as you are there" className={PLATE_MAIN} {...explain('Opens this page in an ordinary tab of your own browser, where you are signed in, or can sign in on the site itself.', 'The server\'s eye is never signed in: this is the way to the signed-in page.', NOTE.leaves)}>
          LOG IN TO {name}
        </button>
      ) : (
        <>
          LOG IN TO {name} NEEDS THE EXTENSION.
          <button type="button" onClick={onGet} className={PLATE_MAIN} {...explain('Opens the EXTENSION window, with the download.', 'Signing in to a site from BROWSER needs the extension.')}>
            GET THE EXTENSION
          </button>
        </>
      )}
      <button type="button" onClick={onNotNow} className={PLATE} {...explain('Puts the line away for this page only.', 'It comes back on the next page of the site.')}>
        [ NOT NOW ]
      </button>
      <button type="button" onClick={onNever} className={PLATE} {...explain('Stops offering to log in to this site, for your account in this browser.', 'For a site you never sign in to.')}>
        [ DON&apos;T ASK AGAIN ]
      </button>
    </p>
  );
}
