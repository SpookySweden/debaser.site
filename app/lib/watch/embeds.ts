import { LINK_PROBE_MS, LINK_REFUSALS, twitchOf, vimeoOf, youtubeIdOf } from './links';
import type { EmbedPlayable } from './playable';
import type { EmbedRefusal } from './embed-player';
import { TwitchPlayable } from './twitch-player';
import type { WatchLink, WatchLinkKind } from './types';
import { fetchVimeoTitle, VimeoPlayable } from './vimeo-player';
import { fetchYouTubeTitle, probeYouTube, YouTubePlayable } from './youtube-player';

/**
 * The sites whose own embed players the stream room uses (SPEC-watch-links.md steps 3-4): which player a
 * link gets, its real title, and the check before it is queued. Only these sites' official players and
 * public title lookups are ever asked; nothing here fetches a video or any other address.
 */

export type EmbedKind = Extract<WatchLinkKind, 'youtube' | 'vimeo' | 'twitch'>;

export function isEmbedKind(kind: WatchLinkKind | undefined): kind is EmbedKind {
  return kind === 'youtube' || kind === 'vimeo' || kind === 'twitch';
}

/** The site's player for a link, in `container`; null when the link's address no longer reads. */
export function createEmbed(link: WatchLink, container: HTMLElement, autoPlay: boolean): EmbedPlayable | null {
  const youtube = youtubeIdOf(link);
  if (youtube !== null) return new YouTubePlayable(container, youtube, autoPlay);
  const vimeo = vimeoOf(link);
  if (vimeo !== null) return new VimeoPlayable(container, vimeo, autoPlay);
  const twitch = twitchOf(link);
  if (twitch !== null) return new TwitchPlayable(container, twitch, autoPlay);
  return null;
}

/** The video's real title from its site, or null (Twitch has no public lookup). */
export async function fetchEmbedTitle(link: WatchLink): Promise<string | null> {
  const youtube = youtubeIdOf(link);
  if (youtube !== null) return fetchYouTubeTitle(youtube);
  const vimeo = vimeoOf(link);
  if (vimeo !== null) return fetchVimeoTitle(vimeo);
  return null;
}

const REFUSED: Record<EmbedRefusal, string> = {
  embed: LINK_REFUSALS.notEmbeddable,
  missing: LINK_REFUSALS.wouldNotLoad,
  offline: LINK_REFUSALS.offline,
};

/**
 * Starts the video muted, off screen, before it is queued: null when it plays, else the refusal. A
 * browser that would not start it at all (an iPhone's autoplay rules) is let through: the room still
 * skips what won't play.
 */
export function probeEmbed(link: WatchLink, timeoutMs = LINK_PROBE_MS): Promise<string | null> {
  const youtube = youtubeIdOf(link);
  if (youtube !== null) return probeYouTube(youtube, timeoutMs);

  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText = 'position:fixed;left:-10000px;top:0;width:480px;height:270px;';
    document.body.appendChild(box);
    const vimeo = vimeoOf(link);
    const twitch = twitchOf(link);
    const player = vimeo !== null ? new VimeoPlayable(box, vimeo, false) : twitch !== null ? new TwitchPlayable(box, twitch, false, true) : null;
    if (player === null) {
      box.remove();
      resolve(LINK_REFUSALS.notVideo);
      return;
    }
    player.muted = true;
    let done = false;
    let timer = 0;
    const finish = (reason: string | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      window.setTimeout(() => {
        player.destroy();
        box.remove();
      }, 0);
      resolve(reason);
    };
    // Twitch's player says nothing at all for a channel or broadcast that does not exist; anything that
    // got as far as ready is let through, as for the other sites.
    timer = window.setTimeout(() => finish(player instanceof TwitchPlayable && player.readyState === 0 ? LINK_REFUSALS.wouldNotLoad : null), timeoutMs);
    player.addEventListener('playing', () => finish(null));
    if (player instanceof TwitchPlayable) {
      // Twitch plays an ad first, so the picture can be a long wait: a channel saying it is broadcasting,
      // or a past broadcast's player getting ready, is enough. One that does not exist says nothing, and
      // the player refuses it after a while by itself.
      player.addEventListener('online', () => finish(null));
      player.addEventListener('loadedmetadata', () => {
        if (twitch?.video !== undefined) finish(null);
      });
    } else {
      // Vimeo gets ready only for a video that exists and may be shown here (it refuses a missing or
      // privacy-locked one at that point). It is not started: off screen, Vimeo's player fails to play.
      player.addEventListener('loadedmetadata', () => finish(null));
    }
    player.addEventListener('error', () => finish(REFUSED[player.refusal ?? 'missing']));
  });
}
