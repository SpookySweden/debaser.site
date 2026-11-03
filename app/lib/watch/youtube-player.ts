import { LINK_PROBE_MS, LINK_REFUSALS, youtubeWatchUrl } from './links';
import { normaliseLanguage } from '../web/language';
import type { SubtitleTrack } from '../web/subtitles';
import { AUTO_QUALITY, type EmbedPlayable, type QualityChoice, type QualityControl, type SubtitleControl } from './playable';

/**
 * YouTube videos in the stream room (SPEC-watch-links.md step 3), through YouTube's own embed player
 * (the IFrame Player API, from the privacy-enhanced youtube-nocookie.com), wrapped as a `Playable` so the
 * room's sync drives it like a `<video>`. The video comes from YouTube to each viewer's browser; this
 * site never touches it.
 *
 * What YouTube does not do as a `<video>` does: it plays at a few fixed speeds, so a follower's small
 * speed nudge has no effect and only the jump (two seconds off) corrects it; ads play at different
 * moments for different people, and the jump catches them up afterwards.
 *
 * **YouTube's own furniture is kept out of the room** (Luke, 2026-11-02): its title strip and buttons along
 * the top, the More videos shelf and its logo along the foot. No setting turns those off any more, so the
 * player is made taller than the picture - the picture sits in the middle of YouTube's player, its strips in
 * the margins above and below - and a box exactly the picture's size clips the margins away. A clear cover
 * over the picture means nothing left inside YouTube's player can be clicked (nothing leaves the site), and it
 * turns black before the picture first plays and after it ends, over YouTube's big play key and its wall of
 * suggestions. YouTube's embedding rules ask sites not to cover its player; if YouTube moves its strips,
 * `BLEED_SHARE` is the number to change, and the cover still keeps every click on the site.
 *
 * **Quality.** YouTube stopped letting other sites choose quality in 2019 (`setPlaybackQuality` does
 * nothing); it picks by the size of its player on screen and the connection. So the QUALITY key changes the
 * size YouTube is told its player is - drawn that size and scaled to fit the picture's box - which nudges
 * what it picks rather than forcing it.
 *
 * **Subtitles** (SPEC-subtitles.md). The SUBS key reads and switches YouTube's captions through the player's
 * captions module (`loadModule('captions')`, `getOption('captions', 'tracklist')`, `setOption('captions', 'track')`).
 * That module is not in YouTube's documented API and may change without notice: when its list never arrives the
 * key is simply not drawn, and the video plays as before. Auto-translated languages are never listed.
 */

/** How far YouTube's player reaches past the picture, above and below, as a share of the picture's height. */
const BLEED_SHARE = 0.3;
/** ...and never less than this many of YouTube's own pixels, so a small player's strips are clipped too. */
const BLEED_FLOOR = 160;

/**
 * The QUALITY key's choices: the picture height each asks YouTube for (0: the player's real size). Measured
 * 2026-11-02 (Big Buck Bunny, pixel ratio 1.25): a player told it is 1920 or 2560 wide got 1080p; one at its
 * real 585 wide, or 640, or 426, got 480p - YouTube's floor for an embed, so LOW asks for 480.
 */
const YOUTUBE_QUALITIES: (QualityChoice & { height: number })[] = [
  { id: AUTO_QUALITY, label: 'AUTO', height: 0 },
  { id: 'high', label: 'HIGH', height: 1080 },
  { id: 'medium', label: 'MEDIUM', height: 720 },
  { id: 'low', label: 'LOW', height: 480 },
];

/**
 * The cover over the picture: black before the first play and after the end, clear but in the way of every
 * click between. When the browser refused to start the video it steps aside, clear and out of the way, so a
 * tap reaches YouTube's own play key: a phone may only start a YouTube video from a tap inside YouTube's
 * player (YouTube says so of `playVideo` on mobile), and before the first play that key is all there is.
 */
const COVERS = {
  shut: 'absolute inset-0 bg-ink-plate',
  open: 'absolute inset-0',
  aside: 'pointer-events-none absolute inset-0',
} as const;
type Cover = keyof typeof COVERS;

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
  /** The captions module: not in YouTube's documented API either, so each is read defensively. */
  loadModule?: (name: string) => void;
  unloadModule?: (name: string) => void;
  getOption?: (module: string, option: string, settings?: Record<string, unknown>) => unknown;
  setOption?: (module: string, option: string, value: unknown) => void;
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
        onApiChange?: () => void;
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

/** One of YouTube's caption tracks as its captions module lists it. */
type YTCaptionTrack = { languageCode?: unknown; languageName?: unknown; displayName?: unknown; kind?: unknown; vss_id?: unknown };

export class YouTubePlayable extends EventTarget implements EmbedPlayable, QualityControl, SubtitleControl {
  private player: YTPlayer | null = null;
  private ready = false;
  private destroyed = false;
  private state: number = STATE.unstarted;
  /** The stage's box, the picture's box inside it that clips YouTube's strips, and the cover over the picture. */
  private readonly container: HTMLElement;
  private readonly frame: HTMLDivElement;
  private readonly cover: HTMLDivElement;
  private readonly resizing: ResizeObserver;
  private qualityNow: string = AUTO_QUALITY;
  /** YouTube's caption tracks once its captions module has listed them, as the SUBS key's list, and the one showing. */
  private captionTracks: { track: SubtitleTrack; raw: YTCaptionTrack }[] = [];
  private captionNow: string | null = null;
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
    this.container = container;
    if (window.getComputedStyle(container).position === 'static') container.style.position = 'relative';
    this.frame = document.createElement('div');
    this.frame.style.cssText = 'position:absolute;overflow:hidden;';
    const mount = document.createElement('div');
    this.frame.appendChild(mount);
    this.cover = document.createElement('div');
    this.cover.setAttribute('aria-hidden', 'true');
    this.setCover('shut');
    this.frame.appendChild(this.cover);
    container.appendChild(this.frame);
    this.resizing = new ResizeObserver(() => this.layout());
    this.resizing.observe(container);
    this.layout();
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
            onApiChange: () => this.readCaptions(),
          },
        });
        this.layout();
      },
      () => this.onError(-1),
    );
  }

  private emit(type: string) {
    this.dispatchEvent(new Event(type));
  }

  /**
   * Fits the picture's box to the stage (16:9, as large as fits, in the middle) and YouTube's player into it:
   * the size YouTube is told (the box's own, or the one a chosen quality asks for), taller by the margins its
   * strips sit in, scaled so the picture lands exactly on the box.
   */
  private layout() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;
    const w = Math.min(width, (height * 16) / 9);
    const h = (w * 9) / 16;
    Object.assign(this.frame.style, { left: `${(width - w) / 2}px`, top: `${(height - h) / 2}px`, width: `${w}px`, height: `${h}px` });

    const iframe = this.frame.querySelector('iframe');
    if (iframe === null) return;
    const asked = YOUTUBE_QUALITIES.find((choice) => choice.id === this.qualityNow)?.height ?? 0;
    const shownHeight = asked > 0 ? asked / (window.devicePixelRatio || 1) : h;
    const shownWidth = (shownHeight * 16) / 9;
    const scale = w / shownWidth;
    const bleed = Math.max(BLEED_FLOOR, shownHeight * BLEED_SHARE);
    Object.assign(iframe.style, {
      position: 'absolute',
      left: '0',
      top: `${-bleed * scale}px`,
      width: `${shownWidth}px`,
      height: `${shownHeight + 2 * bleed}px`,
      maxWidth: 'none',
      border: '0',
      transform: Math.abs(scale - 1) < 0.001 ? '' : `scale(${scale})`,
      transformOrigin: '0 0',
    });
    // The room's own bar is the way to work it: YouTube's player is not a stop for the keyboard.
    iframe.tabIndex = -1;
  }

  /** Black over the picture, clear over it, or out of the way of a tap (`COVERS`). */
  private setCover(cover: Cover) {
    this.cover.className = COVERS[cover];
    this.cover.dataset.youtubeCover = cover;
  }

  private onReady() {
    if (this.destroyed || this.player === null) return;
    this.ready = true;
    this.layout();
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
    // The captions module lists the video's caption tracks; its answer comes through onApiChange.
    try {
      this.player.loadModule?.('captions');
    } catch {
      // An older or newer player without the module: no SUBS key, nothing else changes.
    }
    this.emit('loadedmetadata');
  }

  private onState(next: number) {
    const before = this.state;
    this.state = next;
    if (next === STATE.playing) {
      this.setCover('open');
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
      this.setCover('shut');
      this.wanted = false;
      this.saidPlay = false;
      this.emit('pause');
      this.emit('ended');
    }
  }

  /* --- the QUALITY key --------------------------------------------------------------------------- */

  qualities(): QualityChoice[] {
    return YOUTUBE_QUALITIES.map(({ id, label }) => ({ id, label }));
  }

  get quality(): string {
    return this.qualityNow;
  }

  setQuality(id: string): void {
    if (id === this.qualityNow || !YOUTUBE_QUALITIES.some((choice) => choice.id === id)) return;
    this.qualityNow = id;
    this.layout();
    this.emit('qualities');
  }

  onQualities(listener: () => void): () => void {
    this.addEventListener('qualities', listener);
    return () => this.removeEventListener('qualities', listener);
  }

  /* --- the SUBS key (YouTube's captions module, unofficial) ----------------------------------------- */

  /** Reads the captions module's list when YouTube says its API changed (the module loaded, a list arrived). */
  private readCaptions() {
    const player = this.player;
    if (this.destroyed || player === null || typeof player.getOption !== 'function') return;
    let list: unknown;
    let current: unknown;
    try {
      // includeAsr: the automatic captions too, which some players list only when asked (not seen in 5 videos checked
      // 2026-11-03, none of which had any; harmless where ignored).
      list = player.getOption('captions', 'tracklist', { includeAsr: true });
      current = player.getOption('captions', 'track');
    } catch {
      return;
    }
    if (!Array.isArray(list)) return;
    const tracks = list.flatMap((raw: YTCaptionTrack) => {
      if (typeof raw !== 'object' || raw === null || typeof raw.languageCode !== 'string') return [];
      const auto = raw.kind === 'asr';
      const label = typeof raw.languageName === 'string' ? raw.languageName : typeof raw.displayName === 'string' ? raw.displayName : raw.languageCode;
      const id = typeof raw.vss_id === 'string' && raw.vss_id.length > 0 ? raw.vss_id : `${auto ? 'a' : ''}.${raw.languageCode}`;
      return [{ track: { id, language: normaliseLanguage(raw.languageCode), label, auto }, raw }];
    });
    if (tracks.length === 0 && this.captionTracks.length > 0) return;
    this.captionTracks = tracks;
    // What YouTube shows now, unless this viewer already chose (the module may come up showing its own pick).
    const showing = current as YTCaptionTrack | undefined;
    if (this.captionNow === null && showing && typeof showing.languageCode === 'string') {
      const match = tracks.find(({ raw }) => raw.languageCode === showing.languageCode && (raw.kind === 'asr') === (showing.kind === 'asr'));
      this.captionNow = match?.track.id ?? null;
    }
    this.emit('subtitles');
  }

  subtitles(): SubtitleTrack[] {
    return this.captionTracks.map(({ track }) => track);
  }

  get subtitle(): string | null {
    return this.captionNow;
  }

  setSubtitle(id: string | null): void {
    const player = this.player;
    if (player === null || typeof player.setOption !== 'function') return;
    const chosen = id === null ? null : this.captionTracks.find(({ track }) => track.id === id);
    if (chosen === undefined) return;
    try {
      // Off as an empty track keeps the module (and its list) loaded; a track is asked for as YouTube listed it.
      player.setOption('captions', 'track', chosen === null ? {} : chosen.raw);
    } catch {
      return;
    }
    this.captionNow = id;
    this.emit('subtitles');
  }

  onSubtitles(listener: () => void): () => void {
    this.addEventListener('subtitles', listener);
    return () => this.removeEventListener('subtitles', listener);
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
          // Still not started: the browser would not start it without a press (autoplay rules). The press
          // may have to land on YouTube's own play key, so the cover steps aside until it plays.
          this.wanted = false;
          if (this.state !== STATE.ended) this.setCover('aside');
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
    this.resizing.disconnect();
    // Quietly: a play() still waiting when the player goes is not a refusal to show anybody.
    this.settle(null);
    try {
      this.player?.destroy();
    } catch {
      // Already gone with its page.
    }
    this.player = null;
    this.frame.remove();
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
