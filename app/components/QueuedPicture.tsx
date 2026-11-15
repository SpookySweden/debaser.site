'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { PLATE_ON_BLACK } from '../lib/ui/controls';
import { addedHere, alwaysShowInRoom, outsideAnswer, outsidePicturesServerState, outsidePicturesState, subscribeToOutsidePictures } from '../lib/watch/outside-pictures';
import { PICTURE_REFUSALS, dimensionsRefusal, isTrustedPicture, loadPicture, outsideAddressRefusal, pictureHost } from '../lib/watch/pictures';

/**
 * A picture from a queue, on a room's screen (SPEC-rooms-queues.md, section 6): fitted, never stretched, with its
 * title in plain text under it and a link out to where it lives.
 *
 * Whether it is drawn is decided here, in the viewer's own browser, from the address alone. One of the site's own
 * pictures, or one on a MEDIA platform's allow-listed picture host, is drawn as its row would draw it.
 *
 * Anything else is an **outside picture**, and nothing of it is loaded until this viewer says so:
 * - it arrives covered, naming the host it would be fetched from, with `[ SHOW ]` and `[ ALWAYS SHOW IN THIS ROOM ]`
 *   (one this viewer pasted in themselves, in this browser, shows at once; Preferences can say ALWAYS or NEVER;
 *   `outside-pictures.ts`);
 * - before it shows, this browser checks it again: the address rules, then the picture is loaded once, with no
 *   referrer, and must draw within 8 seconds at no more than 4,096 pixels a side. An outside server can swap the
 *   picture after it was added, so what the adder's browser saw proves nothing here. **The picture that was
 *   measured is the picture that is put on the screen** (the same element, never a second request), so a server
 *   cannot pass the check with one picture and show another. A failure says THIS PICTURE WON'T SHOW HERE.
 * - it is marked FROM OUTSIDE THE SITE with its host.
 *
 * A plain `<img>`, never the image optimiser: the site's server must never fetch a queued picture. A row written
 * past the site's own checks cannot make this browser call a stranger's server either: the cover is decided here.
 */
export default function QueuedPicture({
  src,
  title,
  className = '',
  roomId = null,
  guest = false,
}: {
  src: string;
  title: string;
  className?: string;
  /** The room it is showing in, for ALWAYS SHOW IN THIS ROOM. */
  roomId?: string | null;
  /** A guest is always asked. */
  guest?: boolean;
}) {
  const trusted = isTrustedPicture(src);
  return trusted ? <TrustedPicture src={src} title={title} className={className} /> : <OutsidePicture src={src} title={title} className={className} roomId={roomId} guest={guest} />;
}

const FRAME = 'flex min-h-0 flex-col';
const NOTE = 'p-3 text-center text-label font-bold text-ink-bar';
const FITTED = 'max-h-full max-w-full object-contain';

function Caption({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <figcaption className="flex shrink-0 flex-wrap items-center gap-2 bg-ink-plate px-2 py-1 text-label text-ink-bar">
      <span className="min-w-0 flex-1 truncate font-bold" title={title}>
        {title}
      </span>
      {children}
    </figcaption>
  );
}

function TrustedPicture({ src, title, className }: { src: string; title: string; className: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className={`${FRAME} ${className}`} data-queued-picture={failed ? 'failed' : 'shown'}>
      <div className="flex min-h-0 flex-1 items-center justify-center">
        {failed ? (
          <p className={NOTE} role="alert">
            THIS PICTURE WOULDN&apos;T LOAD. IT WAITS FOR NEXT.
          </p>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- hotlinked from where it lives; the optimiser would make our server fetch it
          <img src={src} alt={title} referrerPolicy="no-referrer" decoding="async" onError={() => setFailed(true)} className={FITTED} />
        )}
      </div>
      <Caption title={title}>
        <a href={src} target="_blank" rel="noopener noreferrer nofollow" className="shrink-0 underline" aria-label={`Open the picture "${title}" in a new tab`}>
          OPEN ↗
        </a>
      </Caption>
    </figure>
  );
}

/** This browser's own check of an outside picture: the element it loaded and measured, or that it failed. */
type Checked = { src: string; image: HTMLImageElement | null };

function OutsidePicture({ src, title, className, roomId, guest }: { src: string; title: string; className: string; roomId: string | null; guest: boolean }) {
  const choice = useSyncExternalStore(subscribeToOutsidePictures, outsidePicturesState, outsidePicturesServerState);
  /** SHOW was pressed for this picture, here, now. */
  const [pressed, setPressed] = useState<string | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const host = pictureHost(src).toUpperCase() || 'AN UNKNOWN HOST';
  const refused = outsideAddressRefusal(src) !== null;
  const answer = outsideAnswer(choice, { mine: addedHere(choice, src), roomId, guest });
  const wanted = !refused && (answer === 'show' || pressed === src);

  useEffect(() => {
    if (!wanted) return;
    let current = true;
    // Loaded once, as a picture, with no referrer, and measured before it is put on the screen.
    void loadPicture(src).then((drawn) => {
      if (!current) return;
      const fits = drawn !== null && dimensionsRefusal(drawn.width, drawn.height) === null;
      if (fits) {
        drawn.image.alt = title;
        drawn.image.className = FITTED;
      }
      setChecked({ src, image: fits ? drawn.image : null });
    });
    return () => {
      current = false;
    };
  }, [wanted, src, title]);

  const result = checked !== null && checked.src === src ? checked : null;
  const image = result?.image ?? null;
  // The element that was measured is the one shown: put into the page as it is, so nothing is fetched again.
  const mount = useCallback(
    (box: HTMLDivElement | null) => {
      if (box !== null && image !== null) box.replaceChildren(image);
    },
    [image],
  );
  const state = refused ? 'refused' : !wanted ? (answer === 'never' ? 'off' : 'covered') : result === null ? 'loading' : image === null ? 'failed' : 'shown';

  return (
    <figure className={`${FRAME} ${className}`} data-queued-picture={`outside-${state}`} data-picture-host={host}>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2">
        {state === 'refused' || state === 'failed' ? (
          <p className={NOTE} role="alert">
            {PICTURE_REFUSALS.wontShow}. IT WAITS FOR NEXT.
          </p>
        ) : state === 'off' ? (
          <p className={NOTE}>A PICTURE FROM OUTSIDE THE SITE ({host}). YOUR PREFERENCES SAY NEVER TO LOAD THEM.</p>
        ) : state === 'covered' ? (
          <>
            <p className={NOTE}>PICTURE FROM {host}. LOADING IT TELLS THAT SERVER YOUR BROWSER ASKED.</p>
            <p className="flex flex-wrap items-center justify-center gap-2">
              <button type="button" className={PLATE_ON_BLACK} onClick={() => setPressed(src)} aria-label={`Show the picture from ${host}`} data-outside-show>
                [ SHOW ]
              </button>
              {roomId !== null && !guest ? (
                <button
                  type="button"
                  className={PLATE_ON_BLACK}
                  onClick={() => {
                    alwaysShowInRoom(roomId);
                    setPressed(src);
                  }}
                  data-outside-always
                >
                  [ ALWAYS SHOW IN THIS ROOM ]
                </button>
              ) : null}
            </p>
          </>
        ) : state === 'loading' ? (
          <p className={NOTE} role="status">
            LOADING THE PICTURE FROM {host}...
          </p>
        ) : (
          <div ref={mount} className="flex min-h-0 w-full flex-1 items-center justify-center" data-outside-shown />
        )}
      </div>
      <Caption title={title}>
        <span className="shrink-0 font-bold" data-outside-mark>
          FROM OUTSIDE THE SITE :: {host}
        </span>
      </Caption>
    </figure>
  );
}
