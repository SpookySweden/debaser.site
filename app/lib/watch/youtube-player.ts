import { LINK_PROBE_MS, LINK_REFUSALS, youtubeWatchUrl } from './links';
import type { EmbedPlayable } from './playable';

/**
 * YouTube videos in the stream room (SPEC-watch-links.md step 3), through YouTube's own embed player
 * (the IFrame Player API, from the privacy-enhanced youtube-nocookie.com), wrapped as a `Playable` so the
 * room's sync drives it like a `<video>`. The video comes from YouTube to each viewer's browser; this
 * site never touches it.
 *
 * What YouTube does not do as a `<video>` does: it plays at a few fixed speeds, so a follower's small
 * speed nudge has no effect and only the jump (two seconds off) corrects it; ads play at different
 * moments for different people, and the jump catches them up afterwards.
 */

type YTPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  setPlaybackRate(rate: number): void;
  /** Not in YouTube's documented API, so read defensively. */
  getVideoData?: () => { isLive?: boolean } | undefined;
  destroy(): void;
};

type YTNamespace = {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      host: string;
      width: string;
      height: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady: () => void;
        onStateChange: (event: { data: number }) => void;
        onError: (event: { data: number }) => void;
      };
    },
  ) => YTPlayer;
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const STATE = { unstarted: -1, ended: 0, playing: 1, paused: 2, buffering: 3, cued: 5 } as const;
/** YouTube's error numbers for a video its owner (or an age limit) keeps off other sites. */
const NOT_EMBEDDABLE = [101, 150];
/** How long a play() waits for YouTube to really start before it counts as refused (autoplay blocked). */
const PLAY_WAIT_MS = 4000;

let api: Promise<YTNamespace> | null = null;

/** YouTube's player script, loaded once, from YouTube. */
function loadApi(): Promise<YTNamespace> {
  if (api !== null) return api;
  api = new Promise((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    const before = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      before?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      api = null;
      reject(new Error('YouTube could not be reached.'));
    };
    document.head.appendChild(script);
  });
  return api;
}

export class YouTubePlayable extends EventTarget implements EmbedPlayable {
  private player: YTPlayer | null = null;
  private ready = false;
  private destroyed = false;
  private state: number = STATE.unstarted;
  /** play() was asked for and pause() was not since: what `paused` reports, as a `<video>` does. */
  private wanted = false;
  /** `play` has been said for the current run of playing (YouTube may pass through buffering first). */
  private saidPlay = false;
  private pendingSeek: number | null = null;
  private rate = 1;
  private vol = 1;
  private mutedNow = false;
  private ticker = 0;
  private waiting: { resolve: () => void; reject: (error: Error) => void; timer: number }[] = [];
  /** YouTube's error number once it has refused this video. */
  errorCode: number | null = null;

  constructor(container: HTMLElement, videoId: string, autoPlay: boolean) {
    super();
    this.wanted = autoPlay;
    const mount = document.createElement('div');
    container.appendChild(mount);
    loadApi().then(
      (YT) => {
        if (this.destroyed) return;
        this.player = new YT.Player(mount, {
          videoId,
          host: 'https://www.youtube-nocookie.com',
          width: '100%',
          height: '100%',
          playerVars: { autoplay: autoPlay ? 1 : 0, controls: 0, disablekb: 1, playsinline: 1, rel: 0, fs: 0, iv_load_policy: 3, origin: window.location.origin },
          events: {
            onReady: () => this.onReady(),
            onStateChange: (event) => this.onState(event.data),
            onError: (event) => this.onError(event.data),
          },
        });
      },
      () => this.onError(-1),
    );
  }

  private emit(type: string) {
    this.dispatchEvent(new Event(type));
  }

  private onReady() {
    if (this.destroyed || this.player === null) return;
    this.ready = true;
    this.player.setVolume(Math.round(this.vol * 100));
    if (this.mutedNow) this.player.mute();
    if (this.pendingSeek !== null) this.player.seekTo(this.pendingSeek, true);
    this.pendingSeek = null;
    // Through play(), so a start the browser blocks (autoplay rules) is noticed: `paused` comes back
    // true, the room hears a pause, and the stage offers JOIN PLAYBACK (`blocked`).
    if (this.wanted)
      void this.play().catch(() => {
        if (this.destroyed) return;
        this.emit('pause');
        this.emit('blocked');
      });
    this.ticker = window.setInterval(() => this.emit('timeupdate'), 250);
    this.emit('loadedmetadata');
  }

  private onState(next: number) {
    const before = this.state;
    this.state = next;
    if (next === STATE.playing) {
      this.wanted = true;
      if (!this.saidPlay) this.emit('play');
      this.saidPlay = true;
      if (before !== STATE.playing) this.emit('playing');
      this.settle(null);
    } else if (next === STATE.paused) {
      this.wanted = false;
      this.saidPlay = false;
      this.emit('pause');
    } else if (next === STATE.ended) {
      this.wanted = false;
      this.saidPlay = false;
      this.emit('pause');
      this.emit('ended');
    }
  }

  private onError(code: number) {
    this.errorCode = code;
    this.settle(new Error('YouTube refused this video.'));
    this.emit('error');
  }

  /** Answers every play() still waiting. */
  private settle(failure: Error | null) {
    const waiting = this.waiting;
    this.waiting = [];
    for (const wait of waiting) {
      window.clearTimeout(wait.timer);
      if (failure === null) wait.resolve();
      else wait.reject(failure);
    }
  }

  get notEmbeddable(): boolean {
    return this.errorCode !== null && NOT_EMBEDDABLE.includes(this.errorCode);
  }

  get currentTime(): number {
    return this.ready && this.player ? this.player.getCurrentTime() : (this.pendingSeek ?? 0);
  }

  set currentTime(seconds: number) {
    if (!this.ready || this.player === null) {
      this.pendingSeek = seconds;
      return;
    }
    this.player.seekTo(seconds, true);
    // YouTube has no "seeked"; it reports the new time straight away, so say so on the next turn.
    window.setTimeout(() => this.emit('seeked'), 0);
  }

  get duration(): number {
    const seconds = this.ready && this.player ? this.player.getDuration() : 0;
    return seconds > 0 ? seconds : Number.NaN;
  }

  get paused(): boolean {
    return !this.wanted || this.state === STATE.ended;
  }

  get ended(): boolean {
    return this.state === STATE.ended;
  }

  get readyState(): number {
    return this.ready ? 4 : 0;
  }

  get playbackRate(): number {
    return this.rate;
  }

  set playbackRate(rate: number) {
    this.rate = rate;
    this.player?.setPlaybackRate(rate);
  }

  get volume(): number {
    return this.vol;
  }

  set volume(volume: number) {
    this.vol = volume;
    if (this.ready) this.player?.setVolume(Math.round(volume * 100));
  }

  get muted(): boolean {
    return this.mutedNow;
  }

  set muted(muted: boolean) {
    this.mutedNow = muted;
    if (!this.ready || this.player === null) return;
    if (muted) this.player.mute();
    else this.player.unMute();
  }

  /** Whether YouTube says this is a live broadcast. */
  get isLive(): boolean {
    return this.ready && this.player?.getVideoData?.()?.isLive === true;
  }

  /** A live broadcast's edge: YouTube counts its length up to now. */
  liveEdge(): number | null {
    return this.isLive && this.player ? this.player.getDuration() : null;
  }

  play(): Promise<void> {
    this.wanted = true;
    if (this.state === STATE.playing) return Promise.resolve();
    if (this.errorCode !== null) return Promise.reject(new Error('YouTube refused this video.'));
    if (this.ready) this.player?.playVideo();
    return new Promise((resolve, reject) => {
      const wait = {
        resolve,
        reject,
        timer: window.setTimeout(() => {
          this.waiting = this.waiting.filter((other) => other !== wait);
          // Playing, or still loading the start (a slow connection): it is on its way.
          if (this.state === STATE.playing || this.state === STATE.buffering) {
            resolve();
            return;
          }
          // Still not started: the browser would not start it without a press (autoplay rules).
          this.wanted = false;
          reject(new Error('YouTube did not start.'));
        }, PLAY_WAIT_MS),
      };
      this.waiting.push(wait);
    });
  }

  pause(): void {
    this.wanted = false;
    if (this.ready) this.player?.pauseVideo();
  }

  destroy(): void {
    this.destroyed = true;
    window.clearInterval(this.ticker);
    // Quietly: a play() still waiting when the player goes is not a refusal to show anybody.
    this.settle(null);
    try {
      this.player?.destroy();
    } catch {
      // Already gone with its page.
    }
    this.player = null;
  }
}

/**
 * YouTube's public oEmbed for one video (the only address this ever asks): its title, and what YouTube
 * answered - 200 found, 401/403 kept off other sites, 400/404 no such video, 0 not reached.
 */
async function youtubeOEmbed(videoId: string): Promise<{ status: number; title: string | null }> {
  try {
    const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(youtubeWatchUrl(videoId))}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return { status: response.status, title: null };
    const body = (await response.json()) as { title?: unknown };
    return { status: response.status, title: typeof body.title === 'string' && body.title.trim().length > 0 ? body.title : null };
  } catch {
    return { status: 0, title: null };
  }
}

/** The video's real title from YouTube, or null. */
export async function fetchYouTubeTitle(videoId: string): Promise<string | null> {
  return (await youtubeOEmbed(videoId)).title;
}

/**
 * Starts the video muted, off screen, before it is queued: null when it plays, else the refusal
 * (`THIS VIDEO CAN'T BE EMBEDDED` when YouTube keeps it off other sites). A browser that would not start
 * it at all (an iPhone's autoplay rules) is let through: the room still skips what won't play.
 */
export function probeYouTube(videoId: string, timeoutMs = LINK_PROBE_MS): Promise<string | null> {
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px;height:180px;';
    document.body.appendChild(box);
    const player = new YouTubePlayable(box, videoId, false);
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
    timer = window.setTimeout(() => finish(null), timeoutMs);
    player.addEventListener('loadedmetadata', () => void player.play().catch(() => undefined));
    player.addEventListener('playing', () => finish(null));
    // YouTube's player gives one number (150) both for a video kept off other sites and for one that does
    // not exist; its oEmbed tells them apart.
    player.addEventListener('error', () => {
      if (!player.notEmbeddable) {
        finish(LINK_REFUSALS.wouldNotLoad);
        return;
      }
      void youtubeOEmbed(videoId).then(({ status }) => finish(status === 400 || status === 404 ? LINK_REFUSALS.wouldNotLoad : LINK_REFUSALS.notEmbeddable));
    });
  });
}
