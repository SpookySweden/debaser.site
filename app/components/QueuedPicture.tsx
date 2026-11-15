'use client';

import { useState } from 'react';
import { isTrustedPicture, pictureHost } from '../lib/watch/pictures';

/**
 * A picture from a queue, on a room's screen (SPEC-rooms-queues.md, section 6): fitted, never stretched, with its
 * title in plain text under it and a link out to where it lives.
 *
 * Whether it is drawn is decided here, in the viewer's own browser, from the address alone: one of the site's own
 * pictures, or one on a MEDIA platform's allow-listed picture host, is drawn as its row would draw it. Anything else
 * is an outside picture: it is named, with the host it would be fetched from, and **not loaded** (phase 6 adds the
 * SHOW key and its guards). So a row written past the site's own checks cannot make this browser call a stranger's
 * server. A plain `<img>`, never the image optimiser: the site's server must never fetch a queued picture.
 */
export default function QueuedPicture({ src, title, className = '' }: { src: string; title: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const trusted = isTrustedPicture(src);

  return (
    <figure className={`flex min-h-0 flex-col ${className}`} data-queued-picture={trusted ? (failed ? 'failed' : 'shown') : 'outside'}>
      <div className="flex min-h-0 flex-1 items-center justify-center">
        {!trusted ? (
          <p className="p-3 text-center text-label font-bold text-ink-bar">A PICTURE FROM OUTSIDE THE SITE ({pictureHost(src).toUpperCase() || 'UNKNOWN'}): NOT SHOWN.</p>
        ) : failed ? (
          <p className="p-3 text-center text-label font-bold text-ink-bar" role="alert">
            THIS PICTURE WOULDN&apos;T LOAD. IT WAITS FOR NEXT.
          </p>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- hotlinked from where it lives; the optimiser would make our server fetch it
          <img src={src} alt={title} referrerPolicy="no-referrer" decoding="async" onError={() => setFailed(true)} className="max-h-full max-w-full object-contain" />
        )}
      </div>
      <figcaption className="flex shrink-0 items-center gap-2 bg-ink-plate px-2 py-1 text-label text-ink-bar">
        <span className="min-w-0 flex-1 truncate font-bold" title={title}>
          {title}
        </span>
        {trusted ? (
          <a href={src} target="_blank" rel="noopener noreferrer nofollow" className="shrink-0 underline" aria-label={`Open the picture "${title}" in a new tab`}>
            OPEN ↗
          </a>
        ) : null}
      </figcaption>
    </figure>
  );
}
