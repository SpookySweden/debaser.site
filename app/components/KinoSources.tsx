'use client';

import { useEffect, useState } from 'react';
import { PLATE_LARGE, PLATE_LINK, PLATE_MAIN } from '../lib/ui/controls';
import { closeFloatingIfMine, placeOf, playFloating } from '../lib/ui/floating-player';
import { embedWithPlace, timeSourceOf } from '../lib/web/embed-time';
import { freeCopyEmbed, kinoWatchPage, type FreeCopy, type KinoSources, type KinoTitle, type WatchOffer } from '../lib/web/kino';
import { askKinoSources } from '../lib/web/kino-sources-client';
import { officialEmbedUrl, WEB_EMBED_SANDBOX } from '../lib/web/official-embed';
import { startingEmbed } from '../lib/web/row-addresses';
import PlayerBox, { PipKey, usePlayingHere } from './PlayerBox';

/**
 * A KINO row's ways to watch beyond this site (SPEC-kino-sources.md): a plainly legal free copy, played from the
 * platform's own player, and TMDB's where-to-watch for the viewer's country, with JustWatch's credit (TMDB's rule).
 */

/** Where-to-watch names are listed in full up to here; the rest are behind TMDB's page. */
const RENT_OR_BUY_SHOWN = 4;

/** This title's sources, once read. `null`: none yet, or none could be read: the row is as it always was. */
export function useKinoSources(title: KinoTitle | null): KinoSources | null {
  const [sources, setSources] = useState<KinoSources | null>(null);
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

function countryName(code: string): string {
  try {
    return (new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code).toUpperCase();
  } catch {
    return code;
  }
}

const SITE_NAMES: Readonly<Record<FreeCopy['platform'], string>> = { internet_archive: 'ARCHIVE', youtube: 'YOUTUBE' };
const WHY_WORDS: Readonly<Record<FreeCopy['why'], string>> = { public_domain: 'PUBLIC DOMAIN', official: 'OFFICIAL UPLOAD' };

/** One free copy: PLAY, or CLOSE and PIP while it plays, in the site's one floating player. */
export function FreeCopyKeys({ copy, title, audio }: { copy: FreeCopy; title: string; audio: string | null }) {
  const playId = `kino-free:${copy.platform}:${copy.id}`;
  const playing = usePlayingHere(playId);
  const embed = officialEmbedUrl(freeCopyEmbed(copy));
  if (embed === null) return null;
  const site = SITE_NAMES[copy.platform];

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
    <div className="flex w-full flex-col gap-1" data-free-copy={copy.platform}>
      <div className="flex flex-wrap items-center gap-2">
        {playing ? (
          <button type="button" onClick={() => closeFloatingIfMine(playId)} aria-label={`Close the player for "${title}"`} className={`${PLATE_LARGE} min-h-tap`}>
            [ ■ CLOSE ]
          </button>
        ) : (
          <button type="button" onClick={start} aria-label={`Play "${title}" free on ${site}`} className={`${PLATE_MAIN} min-h-tap`}>
            {`[ ▶ FREE ON ${site} ]`}
          </button>
        )}
        <span className="text-label font-bold text-ink">{WHY_WORDS[copy.why]}</span>
        {playing ? <PipKey id={playId} title={title} /> : null}
      </div>
      {playing ? <PlayerBox id={playId} title={title} className="aspect-video w-full border border-ink-plate bg-paper" /> : null}
    </div>
  );
}

function WatchLine({ label, names }: { label: string; names: readonly string[] }) {
  if (names.length === 0) return null;
  return (
    <p className="text-prose text-ink wrap-anywhere">
      <span className="text-label font-bold">{`${label}: `}</span>
      {names.join(', ')}
    </p>
  );
}

/** TMDB's where-to-watch for one country. Service names only; the real links are on TMDB's page, as TMDB asks. */
export function WhereToWatch({ offer, title, name }: { offer: WatchOffer; title: KinoTitle; name: string }) {
  const rentOrBuy = [...new Set([...offer.rent, ...offer.buy])];
  const hidden = rentOrBuy.length - RENT_OR_BUY_SHOWN;
  return (
    <div className="mt-2 flex flex-col gap-0.5" data-where-to-watch>
      <p className="text-label font-bold text-ink-quiet">{`WHERE TO WATCH IN ${countryName(offer.country)}`}</p>
      <WatchLine label="STREAM" names={offer.stream} />
      <WatchLine label="FREE" names={offer.free} />
      <WatchLine label="FREE WITH ADS" names={offer.ads} />
      <WatchLine label="RENT OR BUY" names={hidden > 0 ? [...rentOrBuy.slice(0, RENT_OR_BUY_SHOWN), `+${hidden} MORE`] : rentOrBuy} />
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-ink-quiet">
        <a href={kinoWatchPage(title, offer.country)} target="_blank" rel="noopener noreferrer" className={`${PLATE_LINK} min-h-tap`} aria-label={`Where to watch "${name}" (opens TMDB in a new tab)`}>
          [ SEE WHERE ↗ ]
        </a>
        <span data-justwatch-credit>
          {'LISTINGS FROM '}
          <a href="https://www.justwatch.com" target="_blank" rel="noopener noreferrer" className="underline" aria-label="JustWatch (opens in a new tab)">
            JUSTWATCH
          </a>
        </span>
      </p>
    </div>
  );
}
