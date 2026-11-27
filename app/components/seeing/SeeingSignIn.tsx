'use client';

import { PLATE, PLATE_MAIN } from '../../lib/ui/controls';

/**
 * On entering a page of a site that offers it (YouTube, for now): one line over the page. With the extension, LOG IN opens the page in OWN EYE,
 * which asks to add the site (one press there, and the browser's own box) and shows it where you are signed in, or signs you in in an ordinary
 * tab. Without it, it is got first.
 */
export default function SeeingSignIn({ site, has, onLogIn, onGet, onNotNow, onNever }: { site: string; has: boolean; onLogIn: () => void; onGet: () => void; onNotNow: () => void; onNever: () => void }) {
  const name = site.replace(/\.com$/, '').toUpperCase();
  return (
    <p className="flex flex-wrap items-center gap-2 py-1 text-label text-ink" data-seeing-sign-in={has ? 'add' : 'get'}>
      {has ? (
        <button type="button" onClick={onLogIn} title="Opens it in OWN EYE, which asks to add the site: one press there, and your browser's own box" className={PLATE_MAIN}>
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
