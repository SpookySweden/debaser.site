import { placeOf, type FloatingEntry, type FramePlayer } from '../ui/floating-player';
import { embedWithPlace, timeSourceOf } from '../web/embed-time';
import { PLATFORM_HOSTS } from '../web/hosts';
import { mediaServerForUrl, playerSandbox } from '../web/media-servers';
import { officialEmbedUrl, WEB_EMBED_SANDBOX } from '../web/official-embed';
import { startingEmbed } from '../web/row-addresses';
import type { WebPlatform } from '../web/types';
import { isAllowedUrl } from '../web/urls';
import { vimeoOf, youtubeIdOf } from './links';
import type { WatchLink } from './types';

/**
 * Your own room's screen (SPEC-rooms-queues.md): a queued video, when its turn comes, plays in the site's one
 * floating player (`floating-player.ts`), in the platform's own player, exactly as PLAY on its MEDIA row would.
 *
 * Only the link is kept in a queue (its address, kind and title), so the player is put back together from that:
 * the same official embed address, sandbox and referrer rule a MEDIA row uses. Nothing is fetched by our server and
 * nothing is copied. A kind the floating player has no player for (a streaming link, Twitch, Dailymotion) plays in
 * a live room only, and `soloRefusal` says so before it is queued.
 */

export const LIVE_ROOM_ONLY = 'THAT ONE PLAYS IN A LIVE ROOM ONLY. PRESS GO LIVE TO WATCH IT.';

/** Which WEB platform an official embed address belongs to. */
function platformOfEmbed(url: string): WebPlatform | null {
  for (const [platform, allow] of Object.entries(PLATFORM_HOSTS) as [WebPlatform, (typeof PLATFORM_HOSTS)[WebPlatform]][]) {
    if (!isAllowedUrl(url, allow.hosts)) continue;
    if (allow.embedPath.test(new URL(url).pathname)) return platform;
  }
  return null;
}

function frameFor(platform: WebPlatform, embed: string, title: string, id: string, origin: string): FramePlayer {
  const timeFrom = timeSourceOf(platform);
  return {
    kind: 'frame',
    src: embedWithPlace(startingEmbed(embed, platform), timeFrom, placeOf(id), origin),
    frameTitle: `Player: ${title}`,
    // YouTube's player will not start without knowing which site embeds it; every other is told nothing.
    referrerPolicy: platform === 'youtube' ? 'strict-origin' : 'no-referrer',
    sandbox: WEB_EMBED_SANDBOX,
    allow: 'autoplay; fullscreen',
    allowFullScreen: false,
    timeFrom,
  };
}

/** The floating player's entry for a queued link, or null when it has no player for that kind. `id` names the play. */
export function floatingForLink(link: WatchLink, id: string, origin: string): Omit<FloatingEntry, 'play' | 'home'> | null {
  const entry = (player: FloatingEntry['player']) => ({ id, title: link.title, shape: 'video' as const, room: { link }, player });

  const youtube = link.kind === 'youtube' ? youtubeIdOf(link) : null;
  if (youtube !== null) {
    const embed = officialEmbedUrl(`https://www.youtube-nocookie.com/embed/${youtube}`);
    return embed === null ? null : entry(frameFor('youtube', embed, link.title, id, origin));
  }

  const vimeo = link.kind === 'vimeo' ? vimeoOf(link) : null;
  if (vimeo !== null) {
    const embed = officialEmbedUrl(`https://player.vimeo.com/video/${vimeo.id}`);
    if (embed === null) return null;
    const frame = frameFor('vimeo', embed, link.title, id, origin);
    if (vimeo.hash === undefined) return entry(frame);
    // An unlisted video's key rides in the query, before the place (`#t=`).
    const [address, place] = frame.src.split('#');
    const url = new URL(address);
    url.searchParams.set('h', vimeo.hash);
    return entry({ ...frame, src: place === undefined ? url.toString() : `${url.toString()}#${place}` });
  }

  if (link.kind === 'embed') {
    const official = officialEmbedUrl(link.url);
    const platform = official === null ? null : platformOfEmbed(official);
    if (official !== null && platform !== null) return entry(frameFor(platform, official, link.title, id, origin));
    // A friend's media server's own player page (media-servers.ts): sandboxed unless that server is marked otherwise.
    const server = mediaServerForUrl(link.url);
    if (server === undefined) return null;
    return entry({ kind: 'frame', src: link.url, frameTitle: `Player: ${link.title}`, referrerPolicy: 'no-referrer', sandbox: playerSandbox(server), allow: 'autoplay; fullscreen', allowFullScreen: true, timeFrom: null });
  }

  if (link.kind === 'file' && link.url.startsWith('https://')) return entry({ kind: 'file', src: link.url });

  return null;
}

/** Why a link cannot be queued in a room of your own, or null: a song always can, a video when the floating player has its player. */
export function soloRefusal(link: WatchLink): string | null {
  if (link.kind === 'audio') return null;
  return floatingForLink(link, 'probe', 'https://debaser.site') === null ? LIVE_ROOM_ONLY : null;
}
