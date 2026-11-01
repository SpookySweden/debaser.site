import type { EmbedPlayable } from './playable';

/**
 * What the Vimeo and Twitch players (SPEC-watch-links.md step 4) share: acting like a `<video>` for the
 * room's sync. A site's wrapper reports what its player did (`becameReady`, `becamePlaying`...) and
 * says how to tell its player to do something (`sitePlay`, `siteSeek`...); this keeps `paused`, the
 * play() promise and the events the way the room expects them.
 *
 * The YouTube player (youtube-player.ts) came first and does the same by itself.
 */

/** How long a play() waits for the site to really start before it counts as refused (autoplay blocked). */
const PLAY_WAIT_MS = 4000;

/** Why a site refused a video: kept off other sites, not there, or a channel not broadcasting now. */
export type EmbedRefusal = 'embed' | 'missing' | 'offline';

/** A site's player script, loaded once from the site, then whatever global it makes. */
const scripts = new Map<string, Promise<void>>();
export function loadScript(src: string, isLoaded: () => boolean): Promise<void> {
  if (isLoaded()) return Promise.resolve();
  const known = scripts.get(src);
  if (known !== undefined) return known;
  const loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => (isLoaded() ? resolve() : reject(new Error('The player did not load.')));
    script.onerror = () => {
      scripts.delete(src);
      reject(new Error('The player could not be reached.'));
    };
    document.head.appendChild(script);
  });
  scripts.set(src, loading);
  return loading;
}

export abstract class EmbedPlayer extends EventTarget implements EmbedPlayable {
  protected ready = false;
  protected destroyed = false;
  /** play() was asked for and pause() was not since: what `paused` reports, as a `<video>` does. */
  private wanted: boolean;
  /** `play` has been said for the current run of playing. */
  private saidPlay = false;
  private playingNow = false;
  private endedNow = false;
  protected bufferingNow = false;
  private pendingSeek: number | null = null;
  private rate = 1;
  private vol = 1;
  private mutedNow = false;
  private ticker = 0;
  /** JOIN PLAYBACK has been asked for since the last start, so it is said once. */
  private saidBlocked = false;
  private waiting: { resolve: () => void; reject: (error: Error) => void; timer: number }[] = [];
  /** Set once the site has refused this video. */
  refusal: EmbedRefusal | null = null;

  constructor(autoPlay: boolean) {
    super();
    this.wanted = autoPlay;
  }

  /* --- what each site says how to do ------------------------------------------------------------- */

  protected abstract siteTime(): number;
  protected abstract siteDuration(): number;
  protected abstract sitePlay(): void;
  protected abstract sitePause(): void;
  protected abstract siteSeek(seconds: number): void;
  protected abstract siteVolume(volume: number, muted: boolean): void;
  protected siteRate(rate: number): void {
    void rate;
  }
  protected abstract siteDestroy(): void;
  abstract get isLive(): boolean;
  liveEdge(): number | null {
    return null;
  }

  /* --- what each site reports ------------------------------------------------------------------- */

  protected emit(type: string) {
    if (!this.destroyed) this.dispatchEvent(new Event(type));
  }

  protected becameReady() {
    if (this.destroyed || this.ready) return;
    this.ready = true;
    this.siteVolume(this.vol, this.mutedNow);
    if (this.pendingSeek !== null) this.siteSeek(this.pendingSeek);
    this.pendingSeek = null;
    // Through play(), so a start the browser blocks is noticed: `paused` comes back true, the room hears
    // a pause, and the stage offers JOIN PLAYBACK (`blocked`).
    if (this.wanted)
      void this.play().catch(() => {
        if (this.destroyed || this.refusal !== null || this.saidBlocked) return;
        this.saidBlocked = true;
        this.emit('pause');
        this.emit('blocked');
      });
    this.ticker = window.setInterval(() => this.emit('timeupdate'), 250);
    this.emit('loadedmetadata');
  }

  protected becamePlaying() {
    this.playingNow = true;
    this.endedNow = false;
    this.bufferingNow = false;
    this.wanted = true;
    this.saidBlocked = false;
    if (!this.saidPlay) this.emit('play');
    this.saidPlay = true;
    this.emit('playing');
    this.settle(null);
  }

  protected becamePaused() {
    this.playingNow = false;
    this.wanted = false;
    this.saidPlay = false;
    this.emit('pause');
  }

  protected becameEnded() {
    this.playingNow = false;
    this.endedNow = true;
    this.wanted = false;
    this.saidPlay = false;
    this.emit('pause');
    this.emit('ended');
  }

  protected becameSeeked() {
    this.emit('seeked');
  }

  protected refused(why: EmbedRefusal) {
    if (this.refusal !== null) return;
    this.refusal = why;
    this.settle(new Error('The site refused this video.'));
    this.emit('error');
  }

  /** The browser would not start it without a press (the site said so). */
  protected blockedByBrowser() {
    this.wanted = false;
    this.bufferingNow = false;
    this.settle(new Error('Blocked.'));
    if (this.saidBlocked) return;
    this.saidBlocked = true;
    this.emit('pause');
    this.emit('blocked');
  }

  private settle(failure: Error | null) {
    const waiting = this.waiting;
    this.waiting = [];
    for (const wait of waiting) {
      window.clearTimeout(wait.timer);
      if (failure === null) wait.resolve();
      else wait.reject(failure);
    }
  }

  /* --- the <video> it acts as -------------------------------------------------------------------- */

  get currentTime(): number {
    return this.ready ? this.siteTime() : (this.pendingSeek ?? 0);
  }

  set currentTime(seconds: number) {
    if (!this.ready) {
      this.pendingSeek = seconds;
      return;
    }
    this.siteSeek(seconds);
  }

  get duration(): number {
    const seconds = this.ready ? this.siteDuration() : 0;
    return Number.isFinite(seconds) && seconds > 0 ? seconds : Number.NaN;
  }

  get paused(): boolean {
    return !this.wanted || this.endedNow;
  }

  get ended(): boolean {
    return this.endedNow;
  }

  get readyState(): number {
    return this.ready ? 4 : 0;
  }

  get playbackRate(): number {
    return this.rate;
  }

  set playbackRate(rate: number) {
    this.rate = rate;
    if (this.ready) this.siteRate(rate);
  }

  get volume(): number {
    return this.vol;
  }

  set volume(volume: number) {
    this.vol = volume;
    if (this.ready) this.siteVolume(this.vol, this.mutedNow);
  }

  get muted(): boolean {
    return this.mutedNow;
  }

  set muted(muted: boolean) {
    this.mutedNow = muted;
    if (this.ready) this.siteVolume(this.vol, this.mutedNow);
  }

  play(): Promise<void> {
    this.wanted = true;
    if (this.playingNow) return Promise.resolve();
    if (this.refusal !== null) return Promise.reject(new Error('The site refused this video.'));
    if (this.ready) this.sitePlay();
    return new Promise((resolve, reject) => {
      const wait = {
        resolve,
        reject,
        timer: window.setTimeout(() => {
          this.waiting = this.waiting.filter((other) => other !== wait);
          // Playing, or still loading the start (a slow connection): it is on its way.
          if (this.playingNow || this.bufferingNow) {
            resolve();
            return;
          }
          this.wanted = false;
          reject(new Error('The player did not start.'));
        }, PLAY_WAIT_MS),
      };
      this.waiting.push(wait);
    });
  }

  pause(): void {
    this.wanted = false;
    if (this.ready) this.sitePause();
  }

  destroy(): void {
    this.destroyed = true;
    window.clearInterval(this.ticker);
    // Quietly: a play() still waiting when the player goes is not a refusal to show anybody.
    this.settle(null);
    try {
      this.siteDestroy();
    } catch {
      // Already gone with its page.
    }
  }
}
