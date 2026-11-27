'use client';

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
        <button type="button" onClick={onLogIn} title="In an ordinary tab of your own browser, signed in as you are there" className={PLATE_MAIN}>
          LOG IN TO {name}
        </button>
      ) : (
        <>
          LOG IN TO {name} NEEDS THE EXTENSION.
          <button type="button" onClick={onGet} className={PLATE_MAIN}>
            GET THE EXTENSION
          </button>
        </>
      )}
      <button type="button" onClick={onNotNow} className={PLATE}>
        [ NOT NOW ]
      </button>
      <button type="button" onClick={onNever} className={PLATE}>
        [ DON&apos;T ASK AGAIN ]
      </button>
    </p>
  );
}
