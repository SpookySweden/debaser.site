'use client';

import { useState } from 'react';
import { explain } from '../../lib/ui/explain';
import { PLATE, TITLE_BAR_INACTIVE } from '../../lib/ui/controls';

const TOLD_KEY = 'debaser-seeing-told-v1:';
const told = (owner: string): boolean => {
  try {
    return window.localStorage.getItem(TOLD_KEY + owner) === '1';
  } catch {
    return false;
  }
};

/**
 * The first time BROWSER is opened (SPEC-seeing-machine.md, D3; Luke, 2026-11-27: the two eyes "need to really state their purpose better"): what
 * each eye is for, what each lets you do, and what is written down. Until it is understood, on the account's own key in this browser.
 */
export default function SeeingFirstVisit({ owner }: { owner: string }) {
  const [done, setDone] = useState(() => told(owner));
  if (done) return null;
  return (
    <section aria-label="The two eyes" className="frame my-1 bg-paper p-2 text-label text-ink" data-seeing-first-visit>
      <h2 className={TITLE_BAR_INACTIVE}>TWO WAYS TO SEE A PAGE</h2>
      <p className="mt-1">
        <b>OWN EYE: YOUR OWN BROWSER, SIGNED IN AS YOU.</b> The page as the site makes it, through the extension, from your own connection. Use it for the
        sites you are signed in to, video, and anything that needs you. Nothing of it passes through the site or is written down.
      </p>
      <p className="mt-1">
        <b>SERVER EYE: LOOKED AT FROM THE HOUSE.</b> Never signed in, fetched by the site from its owner&apos;s connection and rebuilt through the lenses: the
        site sees the house, not you. Use it to read a page without it seeing you, or through a lens. Which sites it opens for you (their names, never
        the page) and when are written down and kept with no end date, read only by the site&apos;s owner.
      </p>
      <button
        type="button"
        onClick={() => {
          try {
            window.localStorage.setItem(TOLD_KEY + owner, '1');
          } catch {
            // It shows again next time.
          }
          setDone(true);
        }}
        className={`${PLATE} mt-1`}
        {...explain('Puts this away for good, on your account in this browser.', 'The two eyes are named on the switch above every page after this.')}
      >
        [ UNDERSTOOD ]
      </button>
    </section>
  );
}
