import { EmbedPlayer, loadScript } from './embed-player';
import { vimeoUrl, type VimeoVideo } from './links';
import { normaliseLanguage } from '../web/language';
import type { SubtitleTrack } from '../web/subtitles';
import { AUTO_QUALITY, type QualityChoice, type QualityControl, type SubtitleControl } from './playable';

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
  getQualities(): Promise<{ id?: unknown; label?: unknown; active?: unknown }[]>;
  /** Refused unless the video's owner has a paid Vimeo account. */
  setQuality(id: string): Promise<string>;
  /** The video's subtitles and captions (official, player.js); `texttrackchange` says which shows. */
  getTextTracks(): Promise<{ language?: unknown; kind?: unknown; label?: unknown; mode?: unknown }[]>;
  enableTextTrack(language: string, kind?: string): Promise<unknown>;
  disableTextTrack(): Promise<void>;
  on(event: string, listener: (data: { seconds?: number; duration?: number; name?: string; quality?: string; language?: string | null; kind?: string | null }) => void): void;
  destroy(): Promise<void>;
};

declare global {
  interface Window {
    Vimeo?: { Player: new (element: HTMLElement, options: Record<string, string | number | boolean>) => VimeoPlayer };
  }
}

const SDK = 'https://player.vimeo.com/api/player.js';

export class VimeoPlayable extends EmbedPlayer implements QualityControl, SubtitleControl {
  private player: VimeoPlayer | null = null;
  private time = 0;
  private length = 0;
  /** What the QUALITY key offers, from Vimeo once ready; emptied if Vimeo refuses a change (its owner's plan). */
  private qualityList: QualityChoice[] = [];
  private qualityNow: string = AUTO_QUALITY;
  /** The SUBS key's list from Vimeo's text tracks once ready (id: `<kind>:<language>`), and the one showing. */
  private textTracks: SubtitleTrack[] = [];
  private textNow: string | null = null;

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
        player.on('texttrackchange', (data) => {
          this.textNow = typeof data.language === 'string' && data.language.length > 0 ? `${data.kind ?? 'subtitles'}:${data.language}` : null;
          this.emit('subtitles');
        });
        player.on('qualitychange', (data) => {
          if (typeof data.quality !== 'string' || this.qualityList.length === 0) return;
          this.qualityNow = data.quality === 'auto' ? AUTO_QUALITY : data.quality;
          this.emit('qualities');
        });
        player.ready().then(
          () => {
            void player.getDuration().then((seconds) => {
              this.length = seconds;
              this.becameReady();
            }, () => this.becameReady());
            void player.getQualities().then((found) => this.listQualities(found), () => undefined);
            void player.getTextTracks().then((found) => this.listTextTracks(found), () => undefined);
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

  /* --- the QUALITY key --------------------------------------------------------------------------- */

  private listQualities(found: { id?: unknown; label?: unknown; active?: unknown }[]) {
    const listed = found.flatMap((entry): QualityChoice[] =>
      typeof entry.id === 'string' && typeof entry.label === 'string' && entry.id !== 'auto' ? [{ id: entry.id, label: entry.label.toUpperCase() }] : [],
    );
    if (listed.length === 0) return;
    this.qualityList = [{ id: AUTO_QUALITY, label: 'AUTO' }, ...listed];
    const active = found.find((entry) => entry.active === true);
    this.qualityNow = typeof active?.id === 'string' && active.id !== 'auto' ? active.id : AUTO_QUALITY;
    this.emit('qualities');
  }

  qualities(): QualityChoice[] {
    return this.qualityList;
  }

  get quality(): string {
    return this.qualityNow;
  }

  setQuality(id: string): void {
    if (id === this.qualityNow || !this.qualityList.some((choice) => choice.id === id)) return;
    const before = this.qualityNow;
    this.qualityNow = id;
    this.emit('qualities');
    void this.player?.setQuality(id === AUTO_QUALITY ? 'auto' : id).catch(() => {
      // Only a paid owner's videos may be changed: this one cannot, so the key goes rather than lie.
      this.qualityNow = before;
      this.qualityList = [];
      this.emit('qualities');
    });
  }

  onQualities(listener: () => void): () => void {
    this.addEventListener('qualities', listener);
    return () => this.removeEventListener('qualities', listener);
  }

  /* --- the SUBS key ------------------------------------------------------------------------------ */

  private listTextTracks(found: { language?: unknown; kind?: unknown; label?: unknown; mode?: unknown }[]) {
    this.textTracks = found.flatMap((entry): SubtitleTrack[] => {
      if (typeof entry.language !== 'string' || entry.language.length === 0) return [];
      const kind = typeof entry.kind === 'string' ? entry.kind : 'subtitles';
      const label = typeof entry.label === 'string' ? entry.label : entry.language;
      // Vimeo names its machine-made captions "English (auto-generated)".
      return [{ id: `${kind}:${entry.language}`, language: normaliseLanguage(entry.language), label, auto: /auto/i.test(label) }];
    });
    const showing = found.find((entry) => entry.mode === 'showing');
    this.textNow = showing && typeof showing.language === 'string' ? `${typeof showing.kind === 'string' ? showing.kind : 'subtitles'}:${showing.language}` : null;
    this.emit('subtitles');
  }

  subtitles(): SubtitleTrack[] {
    return this.textTracks;
  }

  get subtitle(): string | null {
    return this.textNow;
  }

  setSubtitle(id: string | null): void {
    if (this.player === null || (id !== null && !this.textTracks.some((track) => track.id === id))) return;
    this.textNow = id;
    this.emit('subtitles');
    if (id === null) {
      void this.player.disableTextTrack().catch(() => undefined);
      return;
    }
    const [kind, ...language] = id.split(':');
    void this.player.enableTextTrack(language.join(':'), kind).catch(() => undefined);
  }

  onSubtitles(listener: () => void): () => void {
    this.addEventListener('subtitles', listener);
    return () => this.removeEventListener('subtitles', listener);
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
