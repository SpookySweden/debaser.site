import type { WatchLink } from '../watch/types';
import { serverWatchLink } from './bridges';
import { mediaServer, type MediaServerId } from './media-servers';
import { heldEpisodes, mediaPlayUrl, type MediaInfo, type MediaPart, type PlayChoice } from './media-titles';

/**
 * What a media-server title's pickers have chosen (SPEC-media-servers.md), shared by the MEDIA page's row (WebMediaRow.tsx)
 * and a room's queue browser (StreamQueueWindow.tsx), so both offer the same choices and queue the same thing: a film of a
 * film series (FILM), a show's WHOLE SERIES player, one episode (SEASON and EPISODE), or ALL, every episode of the show.
 *
 * Pure and client-safe, so `Temp/check-server-picks.cjs` holds it.
 */

/**
 * ALL adds at most this many episodes in one go (Luke, 2026-11-08: "add whole series"). Ten seasons of twenty fit; a longer
 * show adds its first 200, season by season, and the key says so in words rather than quietly stopping short.
 */
export const ALL_EPISODES_MAX = 200;

export type ServerPick = {
  /** A film series row: which of its films. */
  partIndex: number;
  season: number | undefined;
  episode: number | undefined;
  /** The server's own whole-series player. */
  whole: boolean;
  /** Every episode the chosen server holds, season by season (the EPISODE picker's first option). */
  all: boolean;
};

type Target = Pick<MediaInfo, 'type' | 'tmdbId' | 'copies'>;

/** A film series row's films, when there is more than one to pick from. */
export function filmParts(media: Pick<MediaInfo, 'parts'>): MediaPart[] | null {
  return media.parts && media.parts.length > 1 ? media.parts : null;
}

/** The picked film of a series, or null for any other row. */
export function pickedPart(media: Pick<MediaInfo, 'parts'>, pick: Pick<ServerPick, 'partIndex'>): MediaPart | null {
  const parts = filmParts(media);
  return parts ? parts[Math.min(Math.max(0, pick.partIndex), parts.length - 1)] : null;
}

/** What plays: the picked film of a series, or the row's own title. */
export function pickTarget(media: MediaInfo, pick: Pick<ServerPick, 'partIndex'>): Target {
  const part = pickedPart(media, pick);
  return part ? { type: 'movie', tmdbId: part.tmdbId, copies: part.copies } : media;
}

/** The first choice a row starts on: the first season's first episode, or the whole series for a show listed only whole. */
export function firstPick(media: MediaInfo): ServerPick {
  const seasons = heldEpisodes(media);
  const season = seasons.keys().next().value;
  return { partIndex: 0, season, episode: season === undefined ? undefined : seasons.get(season)?.[0], whole: media.type === 'tv' && seasons.size === 0, all: false };
}

/** One server's own episodes of a show, season by season, in order. */
export function serverEpisodes(media: Pick<MediaInfo, 'copies'>, server: MediaServerId): [number, number][] {
  const copy = media.copies.find((candidate) => candidate.server === server);
  return [...(copy?.episodes ?? [])].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** What one server's player is asked for: ALL plays that server's first episode. */
export function choiceFor(media: MediaInfo, pick: ServerPick, server: MediaServerId): PlayChoice {
  if (media.type !== 'tv') return {};
  if (pick.whole) return { whole: true };
  if (pick.all) {
    const first = serverEpisodes(media, server)[0];
    return first === undefined ? { season: pick.season, episode: pick.episode } : { season: first[0], episode: first[1] };
  }
  return { season: pick.season, episode: pick.episode };
}

/** Whether this server can play the pick (for ALL: whether it holds any episode its player can play). */
export function serverPlaysPick(media: MediaInfo, pick: ServerPick, server: MediaServerId): boolean {
  if (media.type === 'tv' && pick.all && !pick.whole && serverEpisodes(media, server).length === 0) return false;
  return mediaPlayUrl(mediaServer(server), pickTarget(media, pick), choiceFor(media, pick, server)) !== null;
}

/** The servers that can play the pick, in the row's order. */
export function pickHolders(media: MediaInfo, pick: ServerPick): MediaServerId[] {
  return media.copies.filter((copy) => serverPlaysPick(media, pick, copy.server)).map((copy) => copy.server);
}

/** An episode's name in the queue, under its show (`SHOW :: SEASON 1 · EPISODE 2`). */
export function episodeName(season: number, episode: number): string {
  return `SEASON ${season} · EPISODE ${episode}`;
}

/** What a room is given for the pick: one row, or a show's episodes as one block. */
export type RoomAdd = { kind: 'one'; link: WatchLink } | { kind: 'series'; title: string; links: WatchLink[]; total: number };

/**
 * What ADD TO ROOM, WATCH IN ROOM and the queue browser's ADD put in a room for this pick on this server: the picked film,
 * the picked episode (named for its season and episode), the whole-series player, or for ALL every episode the server holds,
 * season by season, as one series block of at most `max` (`total` says how many there were). Null when it can't be played.
 */
export function roomAddFor(server: MediaServerId, media: MediaInfo, title: string, pick: ServerPick, max: number = ALL_EPISODES_MAX): RoomAdd | null {
  const target = pickTarget(media, pick);
  const host = mediaServer(server);
  if (media.type === 'tv' && pick.all && !pick.whole) {
    const episodes = serverEpisodes(media, server);
    const links: WatchLink[] = [];
    for (const [season, episode] of episodes) {
      if (links.length >= max) break;
      const link = serverWatchLink(host, target, episodeName(season, episode), { season, episode });
      if (link !== null) links.push(link);
    }
    if (links.length === 0) return null;
    return { kind: 'series', title, links, total: episodes.length };
  }
  const part = pickedPart(media, pick);
  const choice = choiceFor(media, pick, server);
  const name = part ? part.title : media.type === 'tv' && !pick.whole && choice.season !== undefined && choice.episode !== undefined ? `${title} · ${episodeName(choice.season, choice.episode)}` : title;
  const link = serverWatchLink(host, target, name, choice);
  return link === null ? null : { kind: 'one', link };
}

/** The words a short ALL add says: `ADDED THE FIRST 200 OF 750 EPISODES` when the show is longer than the most at once. */
export function allAddNote(add: RoomAdd): string | null {
  if (add.kind !== 'series' || add.total <= add.links.length) return null;
  return `ADDED THE FIRST ${add.links.length} OF ${add.total} EPISODES: ${ALL_EPISODES_MAX} IS THE MOST AT ONCE.`;
}

/** The line under the pickers. */
export function pickedLine(media: MediaInfo, pick: ServerPick, server: MediaServerId): string {
  if (pick.whole) return 'THE WHOLE SERIES';
  if (pick.all) {
    const count = serverEpisodes(media, server).length;
    return count > ALL_EPISODES_MAX ? `ALL: THE FIRST ${ALL_EPISODES_MAX} OF ${count} EPISODES` : `ALL: ${count} EPISODE${count === 1 ? '' : 'S'}, EVERY SEASON`;
  }
  return `SEASON ${pick.season} · EPISODE ${pick.episode}`;
}
