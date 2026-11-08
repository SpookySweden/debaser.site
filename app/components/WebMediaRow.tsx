'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { closeFloatingIfMine, floatingState, playCount, playFloating } from '../lib/ui/floating-player';
import { artSlot } from '../lib/ui/art/slots';
import { PLATE_LARGE, PLATE_LINK } from '../lib/ui/controls';
import type { WebStreamItem } from '../lib/web/dedupe';
import { mediaServer, playerSandbox, type MediaServerId } from '../lib/web/media-servers';
import { seasonsLine } from '../lib/web/kino';
import { heldEpisodes, mediaPlayUrl, type MediaInfo, type PlayChoice } from '../lib/web/media-titles';
import { allAddNote, choiceFor, episodeName, filmParts, firstPick, pickedLine, pickedPart, pickHolders, pickTarget, roomAddFor, type ServerPick } from '../lib/web/server-picks';
import ServerPickers from './ServerPickers';
import { rowAddresses } from '../lib/web/row-addresses';
import { PLATFORM_LABELS, type WebItem } from '../lib/web/types';
import { webSessionHeaders } from '../lib/web/web-session';
import { contentLanguage } from '../lib/web/language';
import { burnedInSubtitles } from '../lib/web/subtitles';
import AudioSubsFlags from './AudioSubsFlags';
import { useKinoSources, WATCH_PLAYER_BOX, WATCH_PLAYING_LINE, WatchList, watchCount } from './KinoSources';
import PlayerBox, { PipKey, usePlayingHere } from './PlayerBox';
import SpriteSlot from './SpriteSlot';
import WatchInRoomKey from './WatchInRoomKey';
import FindInRoomKey from './FindInRoomKey';

/**
 * One title from Luke's or a friend's media server (SPEC-media-servers.md), in the /web stream.
 *
 * One row whatever the number of servers holding it. Its WATCH list has a large line for each server, with the free copies and
 * free services of the same TMDB number after them; a show has large SEASON and EPISODE pickers. A server's key first asks our
 * server whether that media server is answering
 * (`/api/web/media/ping`), then loads the server's own player page in a sandboxed, no-referrer frame. A server
 * that is not answering is said so in large plain words, with the next server holding it offered. Switching
 * server or episode while the player is open loads the new one straight away: nothing to re-type.
 *
 * Every size here is at least the 44px tap size at every width, from the theme tokens (Luke's eyesight).
 */

const MISSING_THUMB_SRC = `/${artSlot('web-thumb-missing')?.path ?? 'assets/web/thumb-missing.png'}`;
/** The 44px floor at every width, not only on a phone. */
const BIG_KEY = `${PLATE_LARGE} min-h-tap`;

/** Before the player: the video itself is the site's one floating player (FloatingPlayer.tsx), which the row only asks about. */
type Phase = 'closed' | 'asking' | 'down' | 'unasked';

/** What the row had picked, kept with the playing video so the row can draw itself again when the reader comes back. */
type RowPicks = { server: MediaServerId; partIndex: number; season: number | undefined; episode: number | undefined; whole: boolean; all?: boolean };

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
  // What the pickers chose (server-picks.ts, ServerPickers.tsx): a film of a film series, the whole series, one episode, or ALL.
  const [pick, setPick] = useState<ServerPick>(() => (kept ? { partIndex: kept.partIndex, season: kept.season, episode: kept.episode, whole: kept.whole, all: kept.all ?? false } : firstPick(media)));
  const { whole } = pick;
  const parts = filmParts(media);
  const part = pickedPart(media, pick);
  /** What PLAY plays: the picked film of a series, or the row's own title. */
  const target = pickTarget(media, pick);

  const seasons = heldEpisodes(media);
  // WHOLE SERIES: offered when some server holding the show has a whole-series player; the only choice for a show
  // listed only as a whole (no episodes to pick).
  const wholeOffered = media.type === 'tv' && media.copies.some((copy) => mediaPlayUrl(mediaServer(copy.server), media, { whole: true }) !== null);
  /** What one server is asked for: with ALL, that server's first episode. */
  const choiceOf = (id: MediaServerId, at: ServerPick = pick): PlayChoice => choiceFor(media, at, id);
  const holders = pickHolders(media, pick);
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
  // The same title's free copies and services. A film series row follows the film picked.
  const sources = useKinoSources((target.type === 'movie' || target.type === 'tv') && target.tmdbId !== undefined ? { type: target.type, tmdbId: target.tmdbId } : null);

  const label = (id: MediaServerId) => PLATFORM_LABELS[id];
  const open = phase !== 'closed' || playing;
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
  const missing = parts ? 'NOT THIS FILM' : whole ? 'NO WHOLE-SERIES PLAYER' : pick.all ? 'NO EPISODES' : 'NOT THIS EPISODE';

  /** A new pick: keep the chosen server when it can play it; otherwise the first that can. Reload if open. */
  const repick = (next: ServerPick) => {
    setPick(next);
    const able = pickHolders(media, next);
    const to = able.includes(server) ? server : (able[0] ?? server);
    setServer(to);
    if (open) start(to, next);
  };

  /** Ask the server, then load its player: on PLAY, and again on every switch while the player is open. ALL plays its first episode. */
  const start = (to: MediaServerId, at: ServerPick = pick) => {
    const url = mediaPlayUrl(mediaServer(to), pickTarget(media, at), choiceOf(to, at));
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
      const picks: RowPicks = { server: to, partIndex: at.partIndex, season: at.season, episode: at.episode, whole: at.whole, all: at.all };
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
    if (open) start(id);
  };
  // Into a stream room: the pick on the chosen server, as a sandboxed embed, or with ALL every episode as one block (SPEC-media-servers.md).
  const roomAdd = roomAddFor(server, media, item.title, pick);

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
            <TmdbCredit />
          ) : null}
        </div>
      </div>

      {/* FILM, WHOLE SERIES, SEASON and EPISODE (with ALL first), the same as a room's queue browser offers (ServerPickers.tsx). */}
      <ServerPickers media={media} pick={pick} onPick={repick} wholeOffered={wholeOffered} title={item.title} />
      {media.type === 'tv' && seasons.size > 0 ? (
        <p className="mt-1 text-label font-bold text-ink-quiet" data-picked-line>
          {`${playing ? 'PLAYING' : 'PICKED'}: ${
            playing && pick.all && !whole ? (() => {
              const first = choiceOf(server);
              return first.season !== undefined && first.episode !== undefined ? episodeName(first.season, first.episode) : pickedLine(media, pick, server);
            })() : pickedLine(media, pick, server)
          }`}
        </p>
      ) : null}

      <WatchList
        sources={sources}
        title={item.title}
        audio={contentLanguage(item)}
        serverCount={media.copies.length}
        startOpen={kept !== undefined}
        notice={
          // Plain words for every state, large, in one fixed place under the key (Luke's eyesight).
          phase === 'asking' ? (
            <p role="status" className="text-heading font-bold text-ink">{`ASKING ${label(server)}...`}</p>
          ) : phase === 'down' || phase === 'unasked' ? (
            <div role="alert" className="flex flex-col items-start gap-2">
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
          ) : null
        }
        servers={
          <>
            {media.copies.map((copy) => {
              const holds = holders.includes(copy.server);
              // Only while it's asked or playing: a server that didn't answer can be pressed again, with nothing to close first.
              const here = (phase === 'asking' || playing) && copy.server === server;
              return (
                <div key={copy.server} className={`flex flex-wrap items-center gap-2 ${here ? WATCH_PLAYING_LINE : ''}`} data-server-copy={copy.server}>
                  {here ? (
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
                      onClick={() => {
                        setServer(copy.server);
                        start(copy.server);
                      }}
                      disabled={!holds}
                      aria-label={holds ? `Play "${item.title}" from ${label(copy.server)}` : `${label(copy.server)}: ${missing.toLowerCase()}`}
                      className={BIG_KEY}
                    >
                      {holds ? `[ ▶ ON ${label(copy.server)} ]` : `[ ${label(copy.server)}: ${missing} ]`}
                    </button>
                  )}
                  {here && playing ? <PipKey id={playId} title={item.title} /> : null}
                </div>
              );
            })}
            {/* Nothing from the server loads until the reader asks and the server answers. */}
            {playing ? <PlayerBox id={playId} title={item.title} className={`${WATCH_PLAYER_BOX} aspect-video w-full border border-ink-plate bg-paper`} /> : null}
          </>
        }
      />

      {/* Into a stream room: the pick on the chosen server, as a sandboxed embed (SPEC-media-servers.md; Luke 2026-11-07); ALL as one block. */}
      {roomAdd === null ? null : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {roomAdd.kind === 'one' ? (
            <WatchInRoomKey source={{ link: roomAdd.link }} playId={playId} title={roomAdd.link.title} />
          ) : (
            <WatchInRoomKey
              source={{ link: roomAdd.links[0] }}
              series={{ title: roomAdd.title, links: roomAdd.links, note: allAddNote(roomAdd) }}
              playId={playId}
              title={`${roomAdd.title} · ${pickedLine(media, pick, server)}`}
            />
          )}
        </div>
      )}
    </li>
  );
}

/**
 * TMDB's terms ask for its logo and this notice, in these words, wherever its details appear (Luke's OK for the logo,
 * 2026-11-05). The logo is TMDB's own file, made into a PNG because the asset route never serves .svg.
 */
function TmdbCredit() {
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-label text-ink-quiet" data-tmdb-credit>
      {/* eslint-disable-next-line @next/next/no-img-element -- a fixed mark from our own assets route */}
      <img src="/assets/icons/tmdb.png" alt="TMDB" width={92} height={12} className="h-3 w-auto shrink-0" />
      <span>DETAILS AND POSTER FROM TMDB. THIS WEBSITE USES TMDB AND THE TMDB APIS BUT IS NOT ENDORSED, CERTIFIED, OR OTHERWISE APPROVED BY TMDB.</span>
    </p>
  );
}

/**
 * One KINO title (kino.ts): TMDB's details, with no player of its own. A show lists its seasons with their episode
 * counts. After the row is drawn it asks for ways to watch (KinoSources.tsx): friends' servers holding its TMDB number, free
 * copies to play here, and free services in the viewer's country. A title a media server holds is drawn by `WebMediaRow` instead
 * (its row replaces this one, live-merge.ts, or this row once the answer says so). A stream room's IMDB lookup never reads the
 * servers, so it cannot say none has it: `action` takes that line's place.
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
  // A stream room's lookup (`action`) stays as it was: only the /media row offers ways to watch.
  const { type: mediaType, tmdbId } = item.media;
  const title = action === undefined && (mediaType === 'movie' || mediaType === 'tv') && tmdbId !== undefined ? { type: mediaType, tmdbId } : null;
  const sources = useKinoSources(title);
  // On a friend's server after all: the row that plays it, as the stream would have drawn.
  if (sources?.held) {
    return <WebMediaRow item={{ ...sources.held, media: sources.held.media as MediaInfo, alsoOn: [] }} titleId={titleId} />;
  }

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
          <TmdbCredit />
        </div>
      </div>
      <WatchList sources={sources} title={item.title} audio={contentLanguage(item)} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {action ?? (watchCount(sources) > 0 ? null : <p className="text-title font-bold text-ink">NO SERVER HAS THIS.</p>)}
        {/* No server holds it: find a source for it in a room (SPEC-media-servers.md; Luke 2026-11-07). Media tab only. */}
        {action === undefined ? <FindInRoomKey title={item.title} /> : null}
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
