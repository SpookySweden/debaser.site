'use client';

import { useEffect, useState } from 'react';
import { PLATE_LARGE, PLATE_MAIN } from '../lib/ui/controls';
import { closeFloatingIfMine, placeOf, playFloating } from '../lib/ui/floating-player';
import { embedWithPlace, timeSourceOf } from '../lib/web/embed-time';
import { freeCopyEmbed, type FreeCopy, type KinoSources, type KinoTitle, type WatchOffer } from '../lib/web/kino';
import { askKinoSources } from '../lib/web/kino-sources-client';
import { officialEmbedUrl, WEB_EMBED_SANDBOX } from '../lib/web/official-embed';
import { startingEmbed } from '../lib/web/row-addresses';
import PlayerBox, { PipKey, usePlayingHere } from './PlayerBox';

/**
 * A KINO row's ways to watch beyond this site (SPEC-kino-sources.md): free copies behind a key that opens and closes,
 * played from the platform's own player, and TMDB's where-to-watch for the viewer's country, with JustWatch's credit
 * (TMDB's rule).
 */

/** Rent-or-buy names are listed up to here. */
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

/** A film's length as it's read aloud and at a glance: `1H 40M`, or `45M`. */
function filmLength(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}H ${minutes % 60}M` : `${minutes}M`;
}

/**
 * One free copy to choose: what it is, then PLAY, or CLOSE and PIP while it plays, in the site's one floating player. With the
 * list shut a playing video's box goes, and the video floats on over the site.
 */
function FreeCopyKeys({ copy, title, audio, open, only }: { copy: FreeCopy; title: string; audio: string | null; open: boolean; only: boolean }) {
  const playId = `kino-free:${copy.platform}:${copy.id}`;
  const playing = usePlayingHere(playId);
  const embed = officialEmbedUrl(freeCopyEmbed(copy));
  if (embed === null) return null;
  if (!open) return null;
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
      <div className="flex flex-wrap items-center gap-2" data-free-copy={copy.platform}>
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
      {playing ? <PlayerBox id={playId} title={title} className="order-last aspect-video w-full border border-ink-plate bg-paper" /> : null}
    </>
  );
}

/**
 * The row's free copies, behind a key that opens and closes, shut until asked for: every copy that will play, to choose from (Luke,
 * 2026-11-06). Opening pushes the rest of the row down, a bend of "reveals take their space": keeping room for up to fourteen
 * copies would leave a hole in every row with the list shut. The key itself never moves.
 */
export function FreeCopies({ copies, title, audio }: { copies: readonly FreeCopy[]; title: string; audio: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 flex flex-col items-start gap-2" data-free-copies>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Free copies of "${title}"`} className={`${PLATE_LARGE} min-h-tap`}>
        {`[ ${copies.length === 1 ? 'FREE COPY' : `${copies.length} FREE COPIES`} ${open ? '▴' : '▾'} ]`}
      </button>
      {copies.map((copy) => (
        <FreeCopyKeys key={`${copy.platform}:${copy.id}`} copy={copy} title={title} audio={audio} open={open} only={copies.length === 1} />
      ))}
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

/** TMDB's where-to-watch for one country. Service names only. */
export function WhereToWatch({ offer }: { offer: WatchOffer }) {
  const rentOrBuy = [...new Set([...offer.rent, ...offer.buy])];
  return (
    <div className="mt-2 flex flex-col gap-0.5" data-where-to-watch>
      <p className="text-label font-bold text-ink-quiet">{`WHERE TO WATCH IN ${countryName(offer.country)}`}</p>
      <WatchLine label="STREAM" names={offer.stream} />
      <WatchLine label="FREE" names={offer.free} />
      <WatchLine label="FREE WITH ADS" names={offer.ads} />
      <WatchLine label="RENT OR BUY" names={rentOrBuy.slice(0, RENT_OR_BUY_SHOWN)} />
      <p className="mt-1 text-label text-ink-quiet" data-justwatch-credit>
        LISTINGS FROM JUSTWATCH
      </p>
    </div>
  );
}
