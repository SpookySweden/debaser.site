'use client';

import { crawlStops, stillStops, type CrawlStop } from '../lib/watch/crawl';
import type { WatchMember } from '../lib/watch/types';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { detectLanguage } from '../lib/web/language';
import LanguageFlag from './LanguageFlag';
import ProfileAvatarLink from './ProfileAvatarLink';
import ProfileName from './ProfileName';

/** Seconds of crawl per stop, so a full room does not go past any faster than an empty one. */
const SECONDS_PER_STOP = 4;
const SECONDS_FLOOR = 16;

type StreamCrawlProps = {
  /** The accounts in the room, each once (`accountsPresent`). */
  accounts: WatchMember[];
  hostId: string;
  /** What is on, and what plays next (null: nothing queued). */
  currentTitle: string;
  nextTitle: string | null;
};

/**
 * The strip across the top of the stream's chat column (Luke, 2026-11-02), moving like the newswire
 * (`NewsCrawl`, the same `crawl` rule: it holds still under the pointer). Each watcher goes past with their
 * lamp, picture and name in the colour the directory draws it, and the status line they wrote, the host
 * marked; after every three of them the strip says CURRENT VIDEO, the next time NEXT VIDEO (lib/watch/crawl.ts).
 *
 * Under reduced motion the moving copies go and a still list takes their place: everybody once, then both
 * video lines, wrapping in the column.
 */
export default function StreamCrawl({ accounts, hostId, currentTitle, nextTitle }: StreamCrawlProps) {
  const ids = accounts.flatMap((member) => (member.userId === null ? [] : [member.userId]));
  const names = new Map(accounts.map((member) => [member.userId, member.name]));
  const stops = crawlStops(ids);
  const stop = (each: CrawlStop, key: string) => (
    <li key={key} className="flex shrink-0 items-center gap-1 whitespace-nowrap px-3 motion-reduce:whitespace-normal" data-watch-crawl={each.kind}>
      {each.kind === 'account' ? (
        <CrawlAccount id={each.id} name={names.get(each.id) ?? ''} host={each.id === hostId} />
      ) : each.kind === 'current' ? (
        <VideoLine label="CURRENT VIDEO" title={currentTitle} />
      ) : (
        <VideoLine label="NEXT VIDEO" title={nextTitle ?? 'NOTHING QUEUED'} />
      )}
    </li>
  );

  return (
    <div className="overflow-hidden py-0.5 text-label" aria-label="Watching" role="region">
      {/* The moving strip: the run held twice, so the loop has no seam; the second copy is for the eye only. */}
      <div
        className="crawl flex w-max items-center motion-reduce:hidden"
        style={{ animationDuration: `${Math.max(SECONDS_FLOOR, stops.length * SECONDS_PER_STOP)}s` }}
      >
        {[0, 1].map((copy) => (
          <ul key={copy} className="flex items-center" aria-hidden={copy === 1 ? 'true' : undefined}>
            {stops.map((each, index) => stop(each, `${copy}-${index}`))}
          </ul>
        ))}
      </div>
      <ul className="hidden flex-wrap items-center gap-y-1 motion-reduce:flex">{stillStops(ids).map((each, index) => stop(each, `still-${index}`))}</ul>
    </div>
  );
}

/** One watcher: lamp and coloured name (`ProfileName`), picture, their own status line, HOST. */
function CrawlAccount({ id, name, host }: { id: string; name: string; host: boolean }) {
  const { profile } = usePublicProfile(id);
  const author = { id, displayName: name };
  const status = profile.status.trim();

  return (
    <>
      <ProfileAvatarLink author={author} size={20} showName={false} variant="plain" className="shrink-0" />
      <span className="font-bold">
        <ProfileName author={author} />
      </span>
      {host ? <span className="shrink-0 bg-acid px-1 font-bold text-ink-plate">HOST</span> : null}
      {status.length > 0 ? <span className="text-ink-quiet">{status}</span> : null}
    </>
  );
}

function VideoLine({ label, title }: { label: string; title: string }) {
  return (
    <span className="font-bold text-ink">
      <span className="text-accent-ink">{label}:</span> {title}
      <LanguageFlag tag={detectLanguage(title)} className="ml-1.5" />
    </span>
  );
}
