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
