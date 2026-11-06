'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { PLATE_LARGE, PLATE_LINK, PLATE_MAIN } from '../lib/ui/controls';
import { closeFloatingIfMine, floatingState, placeOf, playFloating } from '../lib/ui/floating-player';
import { embedWithPlace, timeSourceOf } from '../lib/web/embed-time';
import { freeServiceUrl } from '../lib/web/free-services';
import { freeCopyEmbed, type FreeCopy, type KinoSources, type KinoTitle, type WatchOffer } from '../lib/web/kino';
import { askKinoSources, type KinoWatch } from '../lib/web/kino-sources-client';
import { officialEmbedUrl, WEB_EMBED_SANDBOX } from '../lib/web/official-embed';
import { startingEmbed } from '../lib/web/row-addresses';
import PlayerBox, { PipKey, usePlayingHere } from './PlayerBox';

/**
 * A title's `[ WATCH ]` list (SPEC-kino-sources.md, Luke 2026-11-06): one key that opens every way to watch it. Friends' servers
 * holding its TMDB number (their lines come from `WebMediaRow`), free copies played from the platform's own player, and the
 * services that have it free in the viewer's country, by name, with JustWatch's credit (TMDB's rule, while those names show).
 */

/** This title's sources, once read. `null`: none yet, or none could be read: the row is as it always was. */
export function useKinoSources(title: KinoTitle | null): KinoWatch | null {
  const [sources, setSources] = useState<KinoWatch | null>(null);
  const type = title?.type;
  const tmdbId = title?.tmdbId;
  useEffect(() => {
    if (type === undefined || tmdbId === undefined) return;
    let current = true;
    void askKinoSources({ type, tmdbId }).then((answer) => {
      if (current) setSources(answer);
    });
    return () => {
      current = false;
    };
  }, [type, tmdbId]);
  return sources;
}

const freeCopyPlayId = (copy: FreeCopy) => `kino-free:${copy.platform}:${copy.id}`;

const SITE_NAMES: Readonly<Record<FreeCopy['platform'], string>> = { internet_archive: 'ARCHIVE', youtube: 'YOUTUBE' };

/** A film's length as it's read aloud and at a glance: `1H 40M`, or `45M`. */
function filmLength(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}H ${minutes % 60}M` : `${minutes}M`;
}

/**
 * What's playing moves to the top of the list: its line straight under the WATCH key, then its video, then the other copies. So
 * pressing a copy far down a long list doesn't leave CLOSE and the key above the top of the screen when the page goes to the video.
 */
export const WATCH_PLAYING_LINE = '-order-2';
export const WATCH_PLAYER_BOX = '-order-1';

/**
 * One free copy to choose: what it is, then PLAY, or CLOSE and PIP while it plays, in the site's one floating player. With the
 * list shut a playing video's box goes, and the video floats on over the site.
 */
function FreeCopyKeys({ copy, title, audio, open, only }: { copy: FreeCopy; title: string; audio: string | null; open: boolean; only: boolean }) {
  const playId = freeCopyPlayId(copy);
  const playing = usePlayingHere(playId);
  const embed = officialEmbedUrl(freeCopyEmbed(copy));
  if (embed === null || !open) return null;
  const site = SITE_NAMES[copy.platform];
  // Plain text from the platform. What the key is read as has to tell the copies apart too.
  const facts = [copy.label, copy.seconds === undefined ? undefined : filmLength(copy.seconds)].filter((fact) => fact !== undefined).join(' · ');

  const start = () => {
    const timeFrom = timeSourceOf(copy.platform);
    playFloating({
      id: playId,
      title,
      shape: 'video',
      player: {
        kind: 'frame',
        src: embedWithPlace(startingEmbed(embed, copy.platform, audio), timeFrom, placeOf(playId), window.location.origin),
        frameTitle: `${site} player: ${title}`,
        // YouTube's player refuses to start without knowing the site's address (WebStream.tsx `embedReferrer`).
        referrerPolicy: copy.platform === 'youtube' ? 'strict-origin' : 'no-referrer',
        sandbox: WEB_EMBED_SANDBOX,
        allow: 'autoplay; fullscreen',
        allowFullScreen: true,
        timeFrom,
      },
    });
  };

  return (
    <>
      <div className={`flex flex-wrap items-center gap-2 ${playing ? WATCH_PLAYING_LINE : ''}`} data-free-copy={copy.platform}>
        {playing ? (
          <button type="button" onClick={() => closeFloatingIfMine(playId)} aria-label={`Close the player for "${title}"`} className={`${PLATE_LARGE} min-h-tap`}>
            [ ■ CLOSE ]
          </button>
        ) : (
          <button type="button" onClick={start} aria-label={`Play "${title}" free on ${site}${facts ? `: ${facts}` : ''}`} className={`${only ? PLATE_MAIN : PLATE_LARGE} min-h-tap`}>
            {`[ ▶ FREE ON ${site} ]`}
          </button>
        )}
        {facts ? <span className="text-label text-ink wrap-anywhere">{facts}</span> : null}
        {copy.publicDomain ? <span className="text-label font-bold text-ink">PUBLIC DOMAIN</span> : null}
        {playing ? <PipKey id={playId} title={title} /> : null}
      </div>
      {playing ? <PlayerBox id={playId} title={title} className={`${WATCH_PLAYER_BOX} aspect-video w-full border border-ink-plate bg-paper`} /> : null}
    </>
  );
}

/** A service that has the title free: its own search for the title where that's been tried, or just its name. */
function FreeService({ name, kind, title }: { name: string; kind: string; title: string }) {
  const search = freeServiceUrl(name, title);
  const shown = name.toUpperCase();
  return (
    <div className="flex flex-wrap items-center gap-2" data-free-service={kind}>
      {search === null ? (
        <span className="text-prose font-bold text-ink wrap-anywhere">{shown}</span>
      ) : (
        <a href={search} target="_blank" rel="noopener noreferrer" className={`${PLATE_LINK} min-h-tap`} aria-label={`Look for "${title}" on ${name} (opens a new tab)`}>
          {`[ ${shown} ↗ ]`}
        </a>
      )}
      <span className="text-label text-ink">{kind}</span>
    </div>
  );
}

const offeredServices = (watch: WatchOffer | null | undefined): { name: string; kind: string }[] => [
  ...(watch?.free ?? []).map((name) => ({ name, kind: 'FREE' })),
  ...(watch?.ads ?? []).map((name) => ({ name, kind: 'FREE WITH ADS' })),
];

/** How many ways these sources offer, beyond the title's servers. */
export function watchCount(sources: KinoSources | null): number {
  return (sources?.free.length ?? 0) + offeredServices(sources?.watch).length;
}

/**
 * The WATCH key and, open, every way to watch the title: servers first, then free copies, then free services. Shut until asked
 * for. Opening pushes the rest of the row down, a bend of "reveals take their space": keeping room for every line would leave a
 * hole in every row with the list shut. The key itself never moves. Shut, a playing video's box goes and it floats, whichever
 * kind of copy it is; back on the page with one playing, the list is open. `notice` shows open or shut: what a server just said.
 */
export function WatchList({ sources, title, audio, servers, serverCount = 0, startOpen = false, notice }: { sources: KinoSources | null; title: string; audio: string | null; servers?: ReactNode; serverCount?: number; startOpen?: boolean; notice?: ReactNode }) {
  const [open, setOpen] = useState(startOpen);
  const copies = sources?.free ?? [];
  // Sources arrive after the row is drawn, so a free copy still playing from before is only known now. Once: closing it mustn't shut the list.
  const [cameBack, setCameBack] = useState(false);
  if (!cameBack && !open && copies.some((copy) => floatingState().entry?.id === freeCopyPlayId(copy))) {
    setCameBack(true);
    setOpen(true);
  }
  const services = offeredServices(sources?.watch);
  const total = serverCount + copies.length + services.length;
  if (total === 0) return null;
  return (
    <div className="mt-2 flex flex-col items-start gap-2" data-watch>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Watch "${title}": ${total} ${total === 1 ? 'way' : 'ways'}`} className={`${PLATE_LARGE} order-first min-h-tap`}>
        {`[ WATCH · ${total} ${open ? '▴' : '▾'} ]`}
      </button>
      {notice ? <div className="-order-3">{notice}</div> : null}
      {open ? servers : null}
      {copies.map((copy) => (
        <FreeCopyKeys key={`${copy.platform}:${copy.id}`} copy={copy} title={title} audio={audio} open={open} only={total === 1} />
      ))}
      {open ? services.map((service) => <FreeService key={service.name} name={service.name} kind={service.kind} title={title} />) : null}
      {open && services.length > 0 ? (
        <p className="text-label text-ink-quiet" data-justwatch-credit>
          LISTINGS FROM JUSTWATCH
        </p>
      ) : null}
    </div>
  );
}
