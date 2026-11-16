'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { PLATE } from '../lib/ui/controls';
import type { YourYouTube } from '../lib/web/use-your-youtube';
import type { WebItem } from '../lib/web/types';
import ImportYouTubeHistory from './ImportYouTubeHistory';

/**
 * YOUR YOUTUBE's view on MEDIA (Luke, 2026-11-14: "the youtube homepage as header options"). Google gives no real home
 * page, so it is the closest honest thing: videos from the channels the reader still watches, subscribed or not, a few
 * from channels new to them, and now and then one from a subscription gone quiet (`recommender/youtube-picks.ts`).
 *
 * The keys (Luke: "we will have a button for this next to the link youtube button, and replacing the link youtube button
 * once youtube is linked"): not linked, `[ LINK YOUTUBE ] [ IMPORT YOUTUBE HISTORY ]`; linked, the IMPORT key stands in
 * LINK's place beside `[ REFRESH ]` and `[ UNLINK ]`.
 *
 * The rows are the page's own (`renderRow`), so a video plays, queues and takes the feedback key as it does anywhere.
 */
export default function WebYouTubeHome({
  youtube,
  signedIn,
  shown,
  onMore,
  renderRow,
  listClass,
  keyClass,
}: {
  youtube: YourYouTube;
  signedIn: boolean;
  /** How many of the shelf's videos are drawn; `[ MORE ]` asks the page for more. */
  shown: number;
  onMore: () => void;
  renderRow: (item: WebItem) => ReactNode;
  /** The page's list layout for the chosen VIEW. */
  listClass: string;
  keyClass: string;
}) {
  const linked = youtube.items.length > 0 && !youtube.needsLink;
  return (
    <section aria-label="Your YouTube" className="flex flex-col gap-2" data-youtube-home>
      {!signedIn ? (
        <p className="text-key text-ink">
          <Link href="/account" className={PLATE}>
            [ LOG IN ]
          </Link>{' '}
          TO LINK YOUR YOUTUBE
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          {linked ? (
            <>
              <ImportYouTubeHistory keyClass={keyClass} />
              {/* Google's permission lasts about an hour; after that the kept copy shows, and this asks again. */}
              <button type="button" onClick={() => void youtube.link()} className={keyClass} data-youtube-refresh>
                [ REFRESH ]
              </button>
              <button type="button" onClick={youtube.unlink} className={keyClass}>
                [ UNLINK ]
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => void youtube.link()} className={keyClass} data-youtube-link>
                [ LINK YOUTUBE ]
              </button>
              <ImportYouTubeHistory keyClass={keyClass} />
            </>
          )}
          {youtube.problem !== null ? (
            <span role="alert" className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">
              {youtube.problem}
            </span>
          ) : null}
        </div>
      )}
      {youtube.items.length > 0 ? (
        <ul aria-label="From your YouTube" className={listClass}>
          {youtube.items.slice(0, shown).map(renderRow)}
        </ul>
      ) : null}
      {youtube.items.length > shown ? (
        <div>
          <button type="button" onClick={onMore} className={keyClass} data-youtube-more>
            [ MORE ]
          </button>
        </div>
      ) : null}
    </section>
  );
}
