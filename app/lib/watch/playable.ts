import type { SubtitleTrack } from '../web/subtitles';

/**
 * What the stream room's sync needs from a player (SPEC-watch-links.md step 3): the parts of a `<video>`
 * it reads, seeks and listens to. A `<video>` is one already; an embedded site's player (the YouTube
 * player, youtube-player.ts) is wrapped to look like one, so host, follower, chat and live-edge code
 * never ask which it is.
 *
 * Events it fires, as a `<video>` does: `play`, `playing`, `pause`, `seeked`, `ended`, `timeupdate`,
 * `loadedmetadata`, `error`.
 */
export interface Playable {
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  /** 0 until it can say where it is; anything above means it can. */
  readonly readyState: number;
  playbackRate: number;
  volume: number;
  muted: boolean;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/** An embedded site's player (YouTube, Vimeo, Twitch) wrapped as a `Playable`, with what only those have. */
export interface EmbedPlayable extends Playable {
  /** The site says this is a live broadcast. */
  readonly isLive: boolean;
  /** Where a live broadcast should be watched from now; null when not live or the site handles it. */
  liveEdge(): number | null;
  destroy(): void;
}

/** The choice that leaves the picture's quality to the player. */
export const AUTO_QUALITY = 'auto';

/** One choice on the player bar's QUALITY key: the player's own name for it, and what the key says. */
export type QualityChoice = { id: string; label: string };

/**
 * A player that can be asked for a picture quality (the QUALITY key): a streaming link's library, Twitch,
 * Vimeo, or YouTube's size nudge. `qualities()` is empty while there is nothing to choose - not known yet,
 * a site that will not let this video be changed - and the key is not drawn then.
 */
export interface QualityControl {
  /** AUTO first, then best to worst; empty for nothing to choose. */
  qualities(): QualityChoice[];
  /** The choice in force (`AUTO_QUALITY` until somebody picks). */
  readonly quality: string;
  setQuality(id: string): void;
  /** Hears the list or the choice change; returns the way to stop hearing. */
  onQualities(listener: () => void): () => void;
}

export function hasQualityControl(player: unknown): player is QualityControl {
  return typeof player === 'object' && player !== null && typeof (player as Partial<QualityControl>).qualities === 'function';
}

/**
 * A player whose subtitles can be switched (the SUBS key, SPEC-subtitles.md): YouTube's captions, Vimeo's text
 * tracks, a stream's subtitle tracks, an Archive video's subtitle files. `subtitles()` is empty while there is
 * nothing to choose, and the key is not drawn then. Each viewer's own: nothing here is synced or stored.
 */
export interface SubtitleControl {
  subtitles(): SubtitleTrack[];
  /** The track showing (its `id`), or null for none. */
  readonly subtitle: string | null;
  setSubtitle(id: string | null): void;
  /** Hears the list or the choice change; returns the way to stop hearing. */
  onSubtitles(listener: () => void): () => void;
}

export function hasSubtitleControl(player: unknown): player is SubtitleControl {
  return typeof player === 'object' && player !== null && typeof (player as Partial<SubtitleControl>).subtitles === 'function';
}

/** `720P` from a height, for the libraries and sites that list qualities by height. */
export function heightLabel(height: number): string {
  return `${Math.round(height)}P`;
}
