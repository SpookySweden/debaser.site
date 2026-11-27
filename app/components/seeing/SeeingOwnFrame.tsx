'use client';

import { useEffect, useState } from 'react';
import { explain, NOTE } from '../../lib/ui/explain';
import { PLATE, PLATE_MAIN } from '../../lib/ui/controls';
import { youtubeId } from '../../lib/watch/links';

/** What the frame may do: run, keep its own site's sign-in, send forms, open windows of its own; never move this page. */
export const OWN_FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads';
/** A page that has said nothing by now did not show here. */
const SILENT_MS = 8000;

/** A YouTube video is YouTube's own player here: the watch page stops itself in a frame (a white page), and the player is made to be in one. */
export function framedAddress(address: string): string {
  try {
    const id = youtubeId(new URL(address));
    return id === null ? address : `https://www.youtube.com/embed/${id}?autoplay=1`;
  } catch {
    return address;
  }
}

type Props = { address: string; onList: boolean | null; site: string; at: { href: string; title: string } | null; onTab: () => void; onMachine: () => void; onHouse: () => void; onAdd: () => void };

/**
 * OWN EYE in one of BROWSER's own tabs (Luke, 2026-11-27): the page from your own browser, signed in as you where the site lets its sign-in work
 * inside another site. A real tab, the machine's own page, and the house's look are each one press away.
 */
export default function SeeingOwnFrame({ address, onList, site, at, onTab, onMachine, onHouse, onAdd }: Props) {
  const src = framedAddress(address);
  const embedded = src !== address;
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (loadedAt === null) return;
    const timer = window.setTimeout(() => setNow(Date.now()), SILENT_MS);
    return () => window.clearTimeout(timer);
  }, [loadedAt]);
  const silent = !embedded && loadedAt !== null && at === null && now - loadedAt >= SILENT_MS;
  const keys = (
    <>
      <button type="button" onClick={onTab} title="In an ordinary tab of your browser, where every site works as usual" className={PLATE} {...explain('Opens this page in an ordinary tab of your own browser.', 'For a site that is signed out or stops itself inside BROWSER: in a tab, it is exactly as in your browser.', NOTE.leaves)}>
        [ IN A TAB ↗ ]
      </button>
      <button type="button" onClick={onMachine} title="The machine's own page, with every lens" className={PLATE} {...explain('Opens this page in the extension\'s own page, the machine, in a tab of its own.', 'The machine can put every lens on a page: READER, X-RAY, LOW-FI, YOUR THEME.')}>
        [ IN THE MACHINE ↗ ]
      </button>
      <button type="button" onClick={onHouse} title="Looked at from the house: never signed in, rebuilt through the lenses" className={PLATE} {...explain('Shows this page here as the server sees it: from the house, never signed in, rebuilt through the lenses.', 'To read a page without it seeing you, or to use every lens here.', 'THE SITE NAME AND THE TIME ARE WRITTEN DOWN.')}>
        [ FROM THE HOUSE ]
      </button>
    </>
  );
  if (onList === false && !embedded) {
    return (
      <div className="seeing-acquiring flex min-w-0 flex-1 items-center justify-center p-4" data-seeing-own="add">
        <div className="frame max-w-prose min-w-0 bg-paper p-3 text-label text-ink">
          <p className="title-line text-ink">SHOW {site.toUpperCase()} HERE</p>
          <p className="mt-2">YOUR OWN BROWSER SHOWS A SITE HERE ONCE IT IS ADDED: ONE PRESS IN THE MACHINE&apos;S PAGE, AND YOUR BROWSER ASKS TOO.</p>
          <p className="mt-2 flex flex-wrap gap-1">
            <button type="button" onClick={onAdd} className={PLATE_MAIN} {...explain('Opens the machine\'s page, where one press adds this site to the extension\'s list; your browser asks too.', 'A site is shown here, from your own browser, only once it is on the list.')}>
              ADD {site} ↗
            </button>
            {keys}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col" data-seeing-own={silent ? 'silent' : 'shown'}>
      <p className="flex flex-wrap items-center gap-1 px-1 py-1 text-label text-ink">
        <span className="min-w-0 flex-1 truncate" title={at?.href ?? address}>
          {silent ? "IT DIDN'T SHOW HERE: SOME SITES REFUSE TO BE INSIDE ANOTHER, AND SIGN-IN PAGES ALWAYS OPEN IN A TAB." : `YOUR OWN BROWSER, SIGNED IN AS YOU WHERE THE SITE ALLOWS IT HERE${at !== null && at.href !== address ? ` · NOW AT ${at.title || at.href}` : ''}`}
        </span>
        {keys}
      </p>
      <iframe
        key={src}
        src={src}
        title={`Your own browser: ${site}`}
        sandbox={OWN_FRAME_SANDBOX}
        allow={embedded ? 'autoplay; encrypted-media; picture-in-picture; fullscreen' : 'fullscreen'}
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => setLoadedAt(Date.now())}
        className="min-h-0 w-full flex-1 border-0 bg-ink-bar"
        data-seeing-own-frame
      />
    </div>
  );
}
