import { EmbedPlayer, loadScript } from './embed-player';
import { vimeoUrl, type VimeoVideo } from './links';

/**
 * Vimeo videos in the stream room (SPEC-watch-links.md step 4), through Vimeo's own embed player and its
 * Player SDK (from player.vimeo.com, with Vimeo's "do not track" on), wrapped to act as the stage's
 * `<video>`. Vimeo answers every question later (promises), so the time is kept from its own reports,
 * four times a second, and after every seek.
 */

type VimeoPlayer = {
  ready(): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  setCurrentTime(seconds: number): Promise<number>;
  getDuration(): Promise<number>;
  setVolume(volume: number): Promise<number>;
  setMuted(muted: boolean): Promise<boolean>;
  setPlaybackRate(rate: number): Promise<number>;
  on(event: string, listener: (data: { seconds?: number; duration?: number; name?: string }) => void): void;
  destroy(): Promise<void>;
};

declare global {
  interface Window {
    Vimeo?: { Player: new (element: HTMLElement, options: Record<string, string | number | boolean>) => VimeoPlayer };
  }
}

const SDK = 'https://player.vimeo.com/api/player.js';

export class VimeoPlayable extends EmbedPlayer {
  private player: VimeoPlayer | null = null;
  private time = 0;
  private length = 0;

  constructor(container: HTMLElement, video: VimeoVideo, autoPlay: boolean) {
    super(autoPlay);
    const mount = document.createElement('div');
    mount.style.cssText = 'width:100%;height:100%;';
    container.appendChild(mount);
    loadScript(SDK, () => Boolean(window.Vimeo?.Player)).then(
      () => {
        if (this.destroyed || !window.Vimeo) return;
        const player = new window.Vimeo.Player(mount, { url: vimeoUrl(video), autoplay: autoPlay, playsinline: true, dnt: true, responsive: true, title: false, byline: false, portrait: false });
        this.player = player;
        player.on('timeupdate', (data) => {
          this.time = data.seconds ?? this.time;
          this.length = data.duration ?? this.length;
        });
        player.on('playing', () => this.becamePlaying());
        player.on('pause', () => this.becamePaused());
        player.on('ended', () => this.becameEnded());
        player.on('bufferstart', () => {
          this.bufferingNow = true;
        });
        player.on('bufferend', () => {
          this.bufferingNow = false;
        });
        player.on('seeked', (data) => {
          this.time = data.seconds ?? this.time;
          this.becameSeeked();
        });
        player.on('error', (data) => this.refused(data.name === 'PrivacyError' ? 'embed' : 'missing'));
        player.ready().then(
          () => {
            void player.getDuration().then((seconds) => {
              this.length = seconds;
              this.becameReady();
            }, () => this.becameReady());
          },
          (error: { name?: string }) => this.refused(error?.name === 'PrivacyError' ? 'embed' : 'missing'),
        );
      },
      () => this.refused('missing'),
    );
  }

  protected siteTime(): number {
    return this.time;
  }

  protected siteDuration(): number {
    return this.length;
  }

  protected sitePlay(): void {
    // A refusal by the browser (autoplay rules) is seen by play()'s wait.
    void this.player?.play().catch(() => undefined);
  }

  protected sitePause(): void {
    void this.player?.pause().catch(() => undefined);
  }

  protected siteSeek(seconds: number): void {
    this.time = seconds;
    void this.player?.setCurrentTime(seconds).catch(() => undefined);
  }

  protected siteVolume(volume: number, muted: boolean): void {
    void this.player?.setVolume(volume).catch(() => undefined);
    void this.player?.setMuted(muted).catch(() => undefined);
  }

  protected siteRate(rate: number): void {
    // Only some owners' videos allow other speeds; the follower's jump corrects the rest.
    void this.player?.setPlaybackRate(rate).catch(() => undefined);
  }

  protected siteDestroy(): void {
    void this.player?.destroy().catch(() => undefined);
    this.player = null;
  }

  get isLive(): boolean {
    return false;
  }
}

/** The video's title from Vimeo's public oEmbed (the only address this asks), or null. */
export async function fetchVimeoTitle(video: VimeoVideo): Promise<string | null> {
  try {
    const response = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(vimeoUrl(video))}`, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    const body = (await response.json()) as { title?: unknown };
    return typeof body.title === 'string' && body.title.trim().length > 0 ? body.title : null;
  } catch {
    return null;
  }
}
