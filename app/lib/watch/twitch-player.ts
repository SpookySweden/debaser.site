import { EmbedPlayer, loadScript } from './embed-player';
import type { TwitchTarget } from './links';

/**
 * Twitch in the stream room (SPEC-watch-links.md step 4): a channel, watched live, or one of its past
 * broadcasts, through Twitch's own embed player (from player.twitch.tv), wrapped to act as the stage's
 * `<video>`. Twitch asks to be told which site it is embedded on (`parent`), which is this page's own
 * address. A channel that is not broadcasting is refused (`offline`).
 */

type TwitchPlayer = {
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  addEventListener(event: string, listener: () => void): void;
  destroy?: () => void;
};

type TwitchPlayerClass = {
  new (elementId: string, options: Record<string, string | number | boolean | string[]>): TwitchPlayer;
  READY: string;
  PLAY: string;
  PLAYING: string;
  PAUSE: string;
  ENDED: string;
  ONLINE: string;
  OFFLINE: string;
  SEEK: string;
  PLAYBACK_BLOCKED?: string;
};

declare global {
  interface Window {
    Twitch?: { Player: TwitchPlayerClass };
  }
}

const SDK = 'https://player.twitch.tv/js/embed/v1.js';
/** A channel or broadcast that does not exist makes Twitch's player say nothing at all. */
const NO_ANSWER_MS = 15000;
let mounts = 0;

export class TwitchPlayable extends EmbedPlayer {
  private player: TwitchPlayer | null = null;
  private readonly live: boolean;
  private mount: HTMLElement;
  private silence = 0;
  /** Twitch said the channel is broadcasting (a past broadcast never says). */
  online = false;

  constructor(container: HTMLElement, target: TwitchTarget, autoPlay: boolean, muted = false) {
    super(autoPlay);
    this.live = target.channel !== undefined;
    this.mount = document.createElement('div');
    mounts += 1;
    this.mount.id = `twitch-player-${mounts}`;
    this.mount.style.cssText = 'width:100%;height:100%;';
    container.appendChild(this.mount);
    loadScript(SDK, () => Boolean(window.Twitch?.Player)).then(
      () => {
        const Player = window.Twitch?.Player;
        if (this.destroyed || !Player) return;
        const where: Record<string, string> = target.channel !== undefined ? { channel: target.channel } : { video: target.video };
        const player = new Player(this.mount.id, { width: '100%', height: '100%', ...where, parent: [window.location.hostname], autoplay: autoPlay, muted });
        this.player = player;
        this.silence = window.setTimeout(() => {
          if (!this.ready) this.refused('missing');
        }, NO_ANSWER_MS);
        player.addEventListener(Player.READY, () => {
          window.clearTimeout(this.silence);
          // Twitch often plays an ad before the picture and says PLAYING only after it: until then it is
          // loading, not refused, so nobody is offered JOIN PLAYBACK and the room is not paused.
          this.becameReady();
          // Only when it is meant to be playing: a paused room's player is not loading anything.
          if (!this.paused) this.bufferingNow = true;
        });
        player.addEventListener(Player.ONLINE, () => {
          this.online = true;
          this.emit('online');
        });
        player.addEventListener(Player.PLAYING, () => this.becamePlaying());
        player.addEventListener(Player.PAUSE, () => {
          this.bufferingNow = false;
          this.becamePaused();
        });
        player.addEventListener(Player.PLAY, () => {
          this.bufferingNow = true;
        });
        player.addEventListener(Player.ENDED, () => this.becameEnded());
        player.addEventListener(Player.SEEK, () => this.becameSeeked());
        player.addEventListener(Player.OFFLINE, () => this.refused('offline'));
        if (Player.PLAYBACK_BLOCKED !== undefined) player.addEventListener(Player.PLAYBACK_BLOCKED, () => this.blockedByBrowser());
      },
      () => this.refused('missing'),
    );
  }

  protected siteTime(): number {
    return this.player?.getCurrentTime() ?? 0;
  }

  protected siteDuration(): number {
    return this.live ? 0 : (this.player?.getDuration() ?? 0);
  }

  protected sitePlay(): void {
    this.player?.play();
  }

  protected sitePause(): void {
    this.player?.pause();
  }

  protected siteSeek(seconds: number): void {
    // A live channel has nothing to seek to: it is always at the live edge.
    if (!this.live) this.player?.seek(seconds);
  }

  protected siteVolume(volume: number, muted: boolean): void {
    this.player?.setVolume(volume);
    this.player?.setMuted(muted);
  }

  protected siteDestroy(): void {
    window.clearTimeout(this.silence);
    this.player?.destroy?.();
    this.player = null;
    this.mount.remove();
  }

  get isLive(): boolean {
    return this.live;
  }
}
