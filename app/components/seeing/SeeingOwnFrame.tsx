'use client';

import { useEffect, useRef, useState } from 'react';
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

/** Where a framed page got to, as the address box says it: YouTube's player reads as its watch page, the page that was asked for. */
export function boxAddress(href: string): string {
  try {
    const url = new URL(href);
    const id = /^\/embed\/([\w-]{6,20})$/.exec(url.pathname)?.[1];
    return id !== undefined && /(^|\.)youtube\.com$/.test(url.hostname) ? `https://www.youtube.com/watch?v=${id}` : href;
  } catch {
    return href;
  }
}

/**
 * A YouTube video's watch page, when a page framed here got to one (a video clicked inside YouTube's player or one of its pages): the page that is
 * white in a frame. Shorts, the player itself and everything else are not it.
 */
export function watchPageOf(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.pathname !== '/watch' || !/(^|\.)youtube\.com$/.test(url.hostname)) return null;
    const id = youtubeId(url);
    return id === null ? null : `https://www.youtube.com/watch?v=${id}`;
  } catch {
    return null;
  }
}

/**
 * What adding a site by name costs (decision 67), said wherever ADD is offered: the same words as the extension's own pages (`NAMED_COST` in
 * extension/act.js; Temp/check-see-extension.cjs holds the two together).
 */
export const NAMED_COST = 'A site added by name is shown even when that means switching off its own script-safety rules (its Content-Security-Policy) while it is inside BROWSER or the machine. Some sites, DuckDuckGo and GitHub among them, only show that way.';

type Props = {
  address: string;
  /** Whether the extension may show this page: its site was added by name, or EVERY SITE is on. Null: it hasn't said. */
  onList: boolean | null;
  /** Whether its site is on the list by name. Null: it hasn't said (an older copy never does). */
  named: boolean | null;
  site: string;
  at: { href: string; title: string } | null;
  onTab: () => void;
  onMachine: () => void;
  onHouse: () => void;
  onAdd: () => void;
  onEvery: () => void;
};

/**
 * OWN EYE in one of BROWSER's own tabs (Luke, 2026-11-27): the page from your own browser, signed in as you where the site lets its sign-in work
 * inside another site. A real tab, the machine's own page, and the house's look are each one press away.
 */
export default function SeeingOwnFrame({ address, onList, named, site, at, onTab, onMachine, onHouse, onAdd, onEvery }: Props) {
  const src = framedAddress(address);
  const embedded = src !== address;
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  // The extension's few lines in a framed page ask whether theirs is the frame BROWSER made for OWN EYE. Only this frame is told yes, so no
  // other frame on the site (the floating player, a video in a post) is ever followed, told to BROWSER or given a lens.
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const answer = (event: MessageEvent) => {
      const from = frame.current?.contentWindow;
      if (from === null || from === undefined || event.source !== from || (event.data as { see?: unknown } | null)?.see !== 'own-eye?') return;
      from.postMessage({ see: 'own-eye' }, '*');
    };
    window.addEventListener('message', answer);
    return () => window.removeEventListener('message', answer);
  }, []);
  useEffect(() => {
    if (loadedAt === null) return;
    const timer = window.setTimeout(() => setNow(Date.now()), SILENT_MS);
    return () => window.clearTimeout(timer);
  }, [loadedAt]);
  const silent = !embedded && loadedAt !== null && at === null && now - loadedAt >= SILENT_MS;
  // Shown because EVERY SITE is on, its site not added by name: a page that mixes its no-framing line with script-safety rules is left as it
  // is, and stays blank here until its site is added by name (decision 67).
  const byName = silent && onList === true && named === false;
  const keys = (
    <>
      {/* The one way to a tab of the browser, under a name that says so. A page that stayed blank here: it is the key to press. */}
      <button type="button" onClick={onTab} title="In an ordinary tab of your browser, where every site works as usual" className={silent ? PLATE_MAIN : PLATE} data-seeing-own-tab {...explain('Opens this page in an ordinary tab of your own browser.', 'For a site that is signed out or stops itself inside BROWSER: in a tab, it is exactly as in your browser.', NOTE.leaves)}>
        {silent ? 'OPEN IT IN A TAB ↗' : '[ IN A TAB ↗ ]'}
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
          <p className="mt-2">YOUR OWN BROWSER SHOWS A SITE HERE ONCE IT IS ADDED: ONE PRESS IN THE MACHINE&apos;S PAGE, AND YOUR BROWSER ASKS TOO. OR ALLOW EVERY SITE ONCE, AND NO SITE NEEDS ADDING AGAIN.</p>
          <p className="mt-2 flex flex-wrap gap-1">
            <button type="button" onClick={onAdd} title={NAMED_COST} className={PLATE_MAIN} data-seeing-own-add {...explain('Opens the machine\'s page, where one press adds this site to the extension\'s list; your browser asks too.', NAMED_COST)}>
              ADD {site} ↗
            </button>
            <button
              type="button"
              onClick={onEvery}
              title="The extension's own SITES page, where one press lets it show every site; your browser asks too"
              className={PLATE}
              data-seeing-own-every
              {...explain('Opens the extension\'s SITES page, where [ ALLOW EVERY SITE ] lets it show any site here from your own browser, with no ADD step for each one. Your browser asks first, in its own box.', 'Off until you press it there; the same key takes it back. Sign-ins, banks and payments are still never shown inside anything.', NOTE.leaves)}
            >
              [ ALLOW EVERY SITE ↗ ]
            </button>
            {keys}
          </p>
          <p className="mt-2 text-ink-quiet" data-seeing-own-cost>
            {NAMED_COST.toUpperCase()} [ ALLOW EVERY SITE ] NEVER SWITCHES THEM OFF: SUCH A SITE THEN SAYS IT DIDN&apos;T SHOW, AND OFFERS A TAB OR ADD.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col" data-seeing-own={silent ? 'silent' : 'shown'}>
      <p className="flex flex-wrap items-center gap-1 px-1 py-1 text-label text-ink">
        <span className={silent ? 'min-w-0 flex-1' : 'min-w-0 flex-1 truncate'} title={at?.href ?? address}>
          {byName ? `IT DIDN'T SHOW HERE. EITHER ${site.toUpperCase()} ONLY SHOWS INSIDE BROWSER WITH ITS OWN SCRIPT-SAFETY RULES SWITCHED OFF, WHICH [ ALLOW EVERY SITE ] NEVER DOES, OR IT STOPS ITSELF HERE, OR THIS IS A SIGN-IN PAGE. A TAB OF YOUR BROWSER SHOWS IT AS USUAL. ADDED BY NAME, IT IS SHOWN HERE WITH THOSE RULES OFF WHILE IT IS INSIDE BROWSER.` : silent ? "IT DIDN'T SHOW HERE. EITHER THIS SITE REFUSES TO BE INSIDE ANOTHER, OR THIS IS A SIGN-IN PAGE, AND THOSE ARE NEVER SHOWN INSIDE ANYTHING. A TAB OF YOUR BROWSER SHOWS IT AS USUAL." :`YOUR OWN BROWSER, SIGNED IN AS YOU WHERE THE SITE ALLOWS IT HERE${at !== null && boxAddress(at.href) !== address ?` · NOW AT ${at.title || at.href}` : ''}`}
        </span>
        {byName ? (
          <button type="button" onClick={onAdd} title={NAMED_COST} className={PLATE} data-seeing-own-add {...explain('Opens the machine\'s page on this site, where one press adds it to the extension\'s list by name; your browser asks too.', NAMED_COST, NOTE.leaves)}>
            ADD {site} BY NAME ↗
          </button>
        ) : null}
        {keys}
      </p>
      <iframe
        ref={frame}
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
