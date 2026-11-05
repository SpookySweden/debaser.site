'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { closeFloatingIfMine, floatingState, playCount, playFloating } from '../lib/ui/floating-player';
import { artSlot } from '../lib/ui/art/slots';
import { FIELD_TIGHT, PLATE_LARGE, PLATE_LINK, PLATE_MAIN } from '../lib/ui/controls';
import type { WebStreamItem } from '../lib/web/dedupe';
import { mediaServer, playerSandbox, type MediaServerId } from '../lib/web/media-servers';
import { seasonsLine } from '../lib/web/kino';
import { heldEpisodes, mediaPlayUrl, type MediaInfo, type PlayChoice } from '../lib/web/media-titles';
import { rowAddresses } from '../lib/web/row-addresses';
import { PLATFORM_LABELS, type WebItem } from '../lib/web/types';
import { webSessionHeaders } from '../lib/web/web-session';
import { contentLanguage } from '../lib/web/language';
import { burnedInSubtitles } from '../lib/web/subtitles';
import AudioSubsFlags from './AudioSubsFlags';
import PlayerBox, { PipKey, usePlayingHere } from './PlayerBox';
import SpriteSlot from './SpriteSlot';

/**
 * One title from Luke's or a friend's media server (SPEC-media-servers.md), in the /web stream.
 *
 * One row whatever the number of servers holding it, with a large SERVER button for each; a show has large
 * SEASON and EPISODE pickers. PLAY first asks our server whether that media server is answering
 * (`/api/web/media/ping`), then loads the server's own player page in a sandboxed, no-referrer frame. A server
 * that is not answering is said so in large plain words, with the next server holding it offered. Switching
 * server or episode while the player is open loads the new one straight away: nothing to re-type.
 *
 * Every size here is at least the 44px tap size at every width, from the theme tokens (Luke's eyesight).
 */

const MISSING_THUMB_SRC = `/${artSlot('web-thumb-missing')?.path ?? 'assets/web/thumb-missing.png'}`;
/** The 44px floor at every width, not only on a phone. */
const BIG_KEY = `${PLATE_LARGE} min-h-tap`;
const BIG_KEY_ON = `${PLATE_LARGE} min-h-tap key-fill key-on [--key-fill:var(--color-ink)] text-paper`;
const PICKER = `${FIELD_TIGHT} min-h-tap text-title`;

/** Before the player: the video itself is the site's one floating player (FloatingPlayer.tsx), which the row only asks about. */
type Phase = 'closed' | 'asking' | 'down' | 'unasked';

/** What the row had picked, kept with the playing video so the row can draw itself again when the reader comes back. */
type RowPicks = { server: MediaServerId; partIndex: number; season: number | undefined; episode: number | undefined; whole: boolean };

/** Asks our route whether a server answers. null: our own route could not be asked (signed out, offline). */
async function serverAnswers(server: MediaServerId): Promise<boolean | null> {
  const headers = await webSessionHeaders();
  if (headers === null) return null;
  try {
    const response = await fetch(`/api/web/media/ping?server=${encodeURIComponent(server)}`, { credentials: 'omit', headers });
    if (!response.ok) return null;
    const body = (await response.json()) as { up?: unknown };
    return body.up === true;
  } catch {
    return null;
  }
}

function yearOf(date: string | undefined): string | null {
  return date && /^\d{4}/.test(date) ? date.slice(0, 4) : null;
}

export default function WebMediaRow({ item, titleId }: { item: WebStreamItem & { media: MediaInfo }; titleId: string }) {
  const media = item.media;
  const details = media.details;
  const playId = `media:${item.id}`;
  const playing = usePlayingHere(playId);
  /** Back on the page with this row's video still playing: its picks, as they were. */
  const [kept] = useState<RowPicks | undefined>(() => {
    const entry = floatingState().entry;
    return entry?.id === playId ? (entry.details as RowPicks | undefined) : undefined;
  });
  // A film series row (media-collections.ts): the FILM picker chooses which of its films plays.
  const parts = media.parts && media.parts.length > 1 ? media.parts : null;
  const [partIndex, setPartIndex] = useState(kept?.partIndex ?? 0);
  const part = parts ? parts[Math.min(partIndex, parts.length - 1)] : null;
  /** What PLAY plays: the picked film of a series, or the row's own title. */
  const target: Pick<MediaInfo, 'type' | 'tmdbId' | 'copies'> = part ? { type: 'movie', tmdbId: part.tmdbId, copies: part.copies } : media;

  const seasons = heldEpisodes(media);
  const firstSeason = seasons.keys().next().value;
  const [season, setSeason] = useState<number | undefined>(kept ? kept.season : firstSeason);
  const [episode, setEpisode] = useState<number | undefined>(kept ? kept.episode : firstSeason === undefined ? undefined : seasons.get(firstSeason)?.[0]);
  // WHOLE SERIES: offered when some server holding the show has a whole-series player; the only choice for a show
  // listed only as a whole (no episodes to pick).
  const wholeOffered = media.type === 'tv' && media.copies.some((copy) => mediaPlayUrl(mediaServer(copy.server), media, { whole: true }) !== null);
  const [whole, setWhole] = useState(kept?.whole ?? (media.type === 'tv' && seasons.size === 0));
  const choice: PlayChoice = media.type === 'tv' ? (whole ? { whole: true } : { season, episode }) : {};
  const canPlay = (id: MediaServerId, at: PlayChoice) => mediaPlayUrl(mediaServer(id), target, at) !== null;
  const holders = media.copies.filter((copy) => canPlay(copy.server, choice)).map((copy) => copy.server);
  const [server, setServer] = useState<MediaServerId>(kept?.server ?? holders[0] ?? media.copies[0].server);
  const [phase, setPhase] = useState<Phase>('closed');
  /** Bumped by every load, so a slow answer about an earlier server or episode is dropped. */
  const load = useRef(0);
  // Gone from the page: a server answering now must not start a video the reader has walked away from.
  useEffect(
    () => () => {
      load.current += 1;
    },
    [],
  );
  const [thumbFailed, setThumbFailed] = useState(false);

  const label = (id: MediaServerId) => PLATFORM_LABELS[id];
  const open = phase !== 'closed' || playing;
  const playUrl = mediaPlayUrl(mediaServer(server), target, choice);
  const thumb = thumbFailed ? null : rowAddresses(item).thumb;
  const nextServer = holders.find((id) => id !== server) ?? null;
  const shown = part?.details ?? details;
  const year = yearOf(shown?.date);
  const minutes = shown?.runtimeMinutes ?? (!parts && item.durationSeconds ? Math.round(item.durationSeconds / 60) : undefined);
  const facts = [
    parts ? `FILM SERIES · ${parts.length} FILMS` : null,
    year,
    minutes ? `${minutes} MIN` : null,
    ...(shown?.genres ?? []).map((genre) => genre.toUpperCase()),
  ].filter(Boolean);
  const description = part ? part.details?.overview : item.description;
  const missing = parts ? 'NOT THIS FILM' : whole ? 'NO WHOLE-SERIES PLAYER' : 'NOT THIS EPISODE';

  /** Keep the chosen server when it can play the new choice; otherwise the first that can. Reload if open. */
  const switchTo = (at: PlayChoice, nextTarget = target) => {
    const able = media.copies.filter((copy) => mediaPlayUrl(mediaServer(copy.server), nextTarget, at) !== null).map((copy) => copy.server);
    const to = able.includes(server) ? server : (able[0] ?? server);
    setServer(to);
    if (open) start(to, at, nextTarget);
  };

  /** Ask the server, then load its player: on PLAY, and again on every switch while the player is open. */
  const start = (to: MediaServerId, at: PlayChoice, what = target) => {
    const url = mediaPlayUrl(mediaServer(to), what, at);
    load.current += 1;
    const mine = load.current;
    // The row's own video stops while the next one is asked for; another row's plays on until this one answers.
    closeFloatingIfMine(playId);
    if (url === null) {
      setPhase('unasked');
      return;
    }
    setPhase('asking');
    const playsBefore = playCount();
    void serverAnswers(to).then((up) => {
      if (load.current !== mine) return;
      // The reader pressed PLAY on something else while this server was asked: the later press wins.
      if (playCount() !== playsBefore) {
        setPhase('closed');
        return;
      }
      if (up !== true) {
        setPhase(up === false ? 'down' : 'unasked');
        return;
      }
      setPhase('closed');
      const picks: RowPicks = {
        server: to,
        partIndex: parts ? Math.max(0, parts.findIndex((film) => film.tmdbId === what.tmdbId)) : 0,
        season: at.season ?? season,
        episode: at.episode ?? episode,
        whole: at.whole === true,
      };
      playFloating({
        id: playId,
        title: item.title,
        shape: 'video',
        details: picks,
        player: {
          kind: 'frame',
          src: url,
          frameTitle: `${label(to)} player: ${item.title}`,
          // No referrer: the friend's server is never sent which page of ours asked.
          referrerPolicy: 'no-referrer',
          // The server's own player page: its scripts on its own origin, never ours. No popups, forms or top navigation,
          // unless the server is marked `unsandboxed` in media-servers.ts (a player that refuses to start sandboxed).
          sandbox: playerSandbox(mediaServer(to)),
          allow: 'autoplay; fullscreen',
          allowFullScreen: true,
          // A server's own player cannot say where it has got to, so playing it again starts from the top.
          timeFrom: null,
        },
      });
    });
  };

  const pickServer = (id: MediaServerId) => {
    setServer(id);
    if (open) start(id, choice);
  };
  const pickEpisode = (nextSeason: number | undefined, nextEpisode: number | undefined) => {
    setSeason(nextSeason);
    setEpisode(nextEpisode);
    setWhole(false);
    switchTo({ season: nextSeason, episode: nextEpisode });
  };
  const pickWhole = () => {
    setWhole(true);
    switchTo({ whole: true });
  };
  const pickPart = (index: number) => {
    if (!parts) return;
    setPartIndex(index);
    const next = parts[index];
    switchTo({}, { type: 'movie', tmdbId: next.tmdbId, copies: next.copies });
  };

  return (
    <li className="rule-pixel py-2">
      <div className="flex items-start gap-2">
        {/* A fixed box (a poster's shape), so a slow or missing picture never moves the row. */}
        <span className="block h-36 w-24 shrink-0 overflow-hidden border border-ink-plate bg-paper">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element -- hotlinked from TMDB's image host, never proxied or copied
            <img
              src={thumb}
              alt=""
              width={96}
              height={144}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setThumbFailed(true)}
              className="block h-full w-full object-cover"
            />
          ) : (
            <SpriteSlot
              src={MISSING_THUMB_SRC}
              alt=""
              width={96}
              height={144}
              title="No picture"
              fallback={<span aria-hidden="true" className="flex h-full w-full items-center justify-center text-label font-bold text-ink">NO IMAGE</span>}
            />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p id={titleId} tabIndex={-1} className="text-title font-bold text-ink wrap-anywhere">
            {item.title}
            <AudioSubsFlags audio={contentLanguage(item)} burnedIn={burnedInSubtitles(item.title)} className="ml-1.5" />
          </p>
          {facts.length > 0 ? <p className="text-label font-bold text-ink-quiet wrap-anywhere">{facts.join(' · ')}</p> : null}
          {item.creator ? <p className="text-label text-ink wrap-anywhere">{item.creator}</p> : null}
          {part ? <p className="text-label font-bold text-ink wrap-anywhere">{`NOW PICKED: ${part.title}`}</p> : null}
          {description ? <p className="mt-0.5 line-clamp-3 text-prose text-ink wrap-anywhere">{description}</p> : null}
          {details ? (
            // TMDB's terms ask for this notice wherever its details appear.
            <p className="mt-0.5 text-label text-ink-quiet">DETAILS AND POSTER FROM TMDB. THIS SITE USES THE TMDB API BUT IS NOT ENDORSED OR CERTIFIED BY TMDB.</p>
          ) : null}
        </div>
      </div>

      {parts ? (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 max-w-full flex-col text-label font-bold text-ink">
            FILM
            <select value={partIndex} onChange={(event) => pickPart(Number(event.target.value))} className={`${PICKER} max-w-full`}>
              {parts.map((film, index) => (
                <option key={film.id} value={index}>
                  {`${film.date ? `${film.date.slice(0, 4)} · ` : ''}${film.title}`}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {media.type === 'tv' && (seasons.size > 0 || wholeOffered) ? (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          {wholeOffered ? (
            <button type="button" onClick={pickWhole} aria-pressed={whole} className={whole ? BIG_KEY_ON : BIG_KEY}>
              [ ▶ WHOLE SERIES ]
            </button>
          ) : null}
          {/* Picking a season or an episode chooses that episode (WHOLE SERIES lets go). */}
          {seasons.size > 0 ? (
            <>
              <label className="flex flex-col text-label font-bold text-ink">
                SEASON
                <select
                  value={season}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    pickEpisode(next, seasons.get(next)?.[0]);
                  }}
                  className={PICKER}
                >
                  {[...seasons.keys()].map((value) => (
                    <option key={value} value={value}>
                      {`SEASON ${value}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col text-label font-bold text-ink">
                EPISODE
                <select value={episode} onChange={(event) => pickEpisode(season, Number(event.target.value))} className={PICKER}>
                  {(season === undefined ? [] : (seasons.get(season) ?? [])).map((value) => (
                    <option key={value} value={value}>
                      {`EPISODE ${value}`}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
        </div>
      ) : null}
      {media.type === 'tv' && seasons.size > 0 ? (
        <p className="mt-1 text-label font-bold text-ink-quiet">{whole ? 'PLAYING: THE WHOLE SERIES' : `PLAYING: SEASON ${season} · EPISODE ${episode}`}</p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label={`Servers holding "${item.title}"`}>
        {media.copies.map((copy) => {
          const holds = holders.includes(copy.server);
          const picked = copy.server === server;
          return (
            <button
              key={copy.server}
              type="button"
              onClick={() => pickServer(copy.server)}
              disabled={!holds}
              aria-pressed={picked}
              aria-label={holds ? `Watch on ${label(copy.server)}` : `${label(copy.server)}: ${missing.toLowerCase()}`}
              className={picked && holds ? BIG_KEY_ON : BIG_KEY}
            >
              {holds ? `[ ${label(copy.server)} ]` : `[ ${label(copy.server)}: ${missing} ]`}
            </button>
          );
        })}
        {open ? (
          <button
            type="button"
            onClick={() => {
              load.current += 1;
              setPhase('closed');
              closeFloatingIfMine(playId);
            }}
            aria-label={`Close the player for "${item.title}"`}
            className={BIG_KEY}
          >
            [ ■ CLOSE ]
          </button>
        ) : (
          <button
            type="button"
            onClick={() => start(server, choice)}
            disabled={playUrl === null}
            aria-label={`Play "${item.title}" from ${label(server)}`}
            className={`${PLATE_MAIN} min-h-tap`}
          >
            [ ▶ PLAY ]
          </button>
        )}
        {playing ? <PipKey id={playId} title={item.title} /> : null}
      </div>

      {/* Plain words for every state, large, in one fixed place (Luke's eyesight). */}
      {phase === 'asking' ? (
        <p role="status" className="mt-2 text-heading font-bold text-ink">{`ASKING ${label(server)}...`}</p>
      ) : null}
      {phase === 'down' || phase === 'unasked' ? (
        <div role="alert" className="mt-2 flex flex-col items-start gap-2">
          <p className="w-fit bg-bubble-pale px-1 text-heading font-bold text-ink-bar">
            {phase === 'down' ? `${label(server)} IS NOT ANSWERING.` : `COULD NOT REACH ${label(server)}. TRY AGAIN.`}
          </p>
          {nextServer !== null ? (
            <button type="button" onClick={() => pickServer(nextServer)} className={BIG_KEY}>
              {`[ TRY ${label(nextServer)} ]`}
            </button>
          ) : (
            <p className="text-title font-bold text-ink">NO OTHER SERVER HAS IT.</p>
          )}
        </div>
      ) : null}

      {/* Nothing from the server loads until the reader asks and the server answers. */}
      {playing ? <PlayerBox id={playId} title={item.title} className="mt-2 aspect-video w-full border border-ink-plate bg-paper" /> : null}
    </li>
  );
}

/**
 * One KINO title (kino.ts): TMDB's details, with no player. A show lists its seasons with their episode counts. A
 * title a media server holds is drawn by `WebMediaRow` instead (its row replaces this one, live-merge.ts). A stream
 * room's IMDB lookup never reads the servers, so it cannot say none has it: `action` takes that line's place.
 */
export function KinoRow({ item, titleId, action }: { item: WebItem & { media: MediaInfo }; titleId: string; action?: ReactNode }) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const details = item.media.details;
  const addresses = rowAddresses(item);
  const thumb = thumbFailed ? null : addresses.thumb;
  const minutes = details?.runtimeMinutes;
  const facts = [
    item.media.type === 'tv' ? 'SHOW' : 'FILM',
    yearOf(details?.date),
    minutes ? `${minutes} MIN` : null,
    seasonsLine(details),
    ...(details?.genres ?? []).map((genre) => genre.toUpperCase()),
  ].filter(Boolean);
  const seasons = (details?.seasons ?? []).filter((season) => season.season >= 1 && season.episodes > 0);

  return (
    <li className="rule-pixel py-2">
      <div className="flex items-start gap-2">
        <span className="block h-36 w-24 shrink-0 overflow-hidden border border-ink-plate bg-paper">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element -- hotlinked from TMDB's image host, never proxied or copied
            <img
              src={thumb}
              alt=""
              width={96}
              height={144}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setThumbFailed(true)}
              className="block h-full w-full object-cover"
            />
          ) : (
            <SpriteSlot
              src={MISSING_THUMB_SRC}
              alt=""
              width={96}
              height={144}
              title="No picture"
              fallback={<span aria-hidden="true" className="flex h-full w-full items-center justify-center text-label font-bold text-ink">NO IMAGE</span>}
            />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p id={titleId} tabIndex={-1} className="text-title font-bold text-ink wrap-anywhere">
            {item.title}
            <AudioSubsFlags audio={contentLanguage(item)} burnedIn={burnedInSubtitles(item.title)} className="ml-1.5" />
          </p>
          <p className="text-label font-bold text-ink-quiet wrap-anywhere">{facts.join(' · ')}</p>
          {item.description ? <p className="mt-0.5 line-clamp-3 text-prose text-ink wrap-anywhere">{item.description}</p> : null}
          {seasons.length > 0 ? (
            <ul aria-label={`Seasons of "${item.title}"`} className="mt-0.5 flex flex-wrap gap-x-2 text-label text-ink">
              {seasons.map((season) => (
                <li key={season.season}>{`S${season.season}: ${season.episodes} EP`}</li>
              ))}
            </ul>
          ) : null}
          <p className="mt-0.5 text-label text-ink-quiet">DETAILS AND POSTER FROM TMDB. THIS SITE USES THE TMDB API BUT IS NOT ENDORSED OR CERTIFIED BY TMDB.</p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {action ?? <p className="text-title font-bold text-ink">NO SERVER HAS THIS.</p>}
        {addresses.link ? (
          <a href={addresses.link} target="_blank" rel="noopener noreferrer" className={`${PLATE_LINK} min-h-tap`} aria-label={`"${item.title}" on TMDB (opens a new tab)`}>
            [ ON TMDB ↗ ]
          </a>
        ) : null}
      </div>
    </li>
  );
}

/** Whether a row is a KINO title: TMDB's details, held by no media server (and so drawn by `KinoRow`). */
export function isKinoRow<T extends WebItem>(item: T): item is T & { media: MediaInfo } {
  return item.media !== undefined && item.media.copies.length === 0;
}

/** Whether a row is a media-server title (and so drawn by this component). */
export function isMediaRow(item: WebStreamItem): item is WebStreamItem & { media: MediaInfo } {
  return item.media !== undefined && item.media.copies.length > 0;
}
