import { LINK_PROBE_MS, LINK_REFUSALS, probeVideoLink } from './links';
import { AUTO_QUALITY, heightLabel, type QualityChoice, type QualityControl } from './playable';
import type { WatchLink } from './types';

/**
 * Streaming links in the stage's `<video>` (SPEC-watch-links.md step 2): HLS (`.m3u8`) through hls.js,
 * or the browser's own player where it has one (Safari), and DASH (`.mpd`) through dash.js. Each library
 * is loaded only when such a link is on, so nobody else downloads it.
 *
 * The libraries only feed the element; the room's sync goes on reading and seeking that same element,
 * exactly as for a file. Nothing is fetched by the site: the viewer's browser asks the stream's own host,
 * and a host that refuses (no CORS, a locked address) is a link that won't play.
 */

export type StreamEvents = {
  /** The stream turned out to be live (no end, no seeking) or not. */
  onLive: (live: boolean) => void;
  /** It will not play in this browser. */
  onFatal: () => void;
  /** The stream said which qualities it carries, or the choice changed (the QUALITY key). */
  onQualities?: () => void;
};

/** The library's player, with the QUALITY key's choices once the stream has said what it carries. */
export type StreamHandle = QualityControl & {
  /** Where a live stream should be watched from now; null when not live or not known yet. */
  liveEdge: () => number | null;
  detach: () => void;
};

/** The key's list from a stream's picture heights (best first, each height once): nothing to choose under two. */
function heightChoices(levels: { id: string; height: number }[]): QualityChoice[] {
  const seen = new Set<number>();
  const listed: QualityChoice[] = [];
  for (const level of levels.filter((each) => each.height > 0).sort((a, b) => b.height - a.height)) {
    if (seen.has(level.height)) continue;
    seen.add(level.height);
    listed.push({ id: level.id, label: heightLabel(level.height) });
  }
  return listed.length < 2 ? [] : [{ id: AUTO_QUALITY, label: 'AUTO' }, ...listed];
}

/** Links the stage plays by setting `src` itself, with no library. */
export function playsDirectly(link: WatchLink | null): boolean {
  return link === null || link.kind === 'file';
}

function nativeHls(video: HTMLVideoElement): boolean {
  return video.canPlayType('application/vnd.apple.mpegurl') !== '';
}

/** The live edge as the element knows it, a few seconds back so the player is not starved. */
function seekableEdge(video: HTMLVideoElement): number | null {
  if (video.seekable.length === 0) return null;
  return Math.max(0, video.seekable.end(video.seekable.length - 1) - 3);
}

/**
 * How many times a stream that was already playing is restarted after losing its connection before it
 * counts as dead, waiting 2, 4, 8 then 16 seconds: about half a minute of outage is ridden out.
 */
const STREAM_RETRIES = 4;
const STREAM_RETRY_MS = 2000;

/**
 * Puts an HLS or DASH link into `video`. The handle undoes it; a detach before loading finished is safe.
 * `autoPlay`: start as soon as it can (the host); dash.js would otherwise switch the element's autoplay off.
 */
export function attachStream(video: HTMLVideoElement, link: WatchLink, events: StreamEvents, autoPlay = false): StreamHandle {
  let detached = false;
  // Before the first picture an error means the link is no good; after it, a hiccup (a dropped part of a
  // live stream) is retried a few times rather than abandoning the stream for the whole room.
  let retries = 0;
  let played = false;
  const giveUp = () => !played || ++retries > STREAM_RETRIES;
  // Playing (again, after a restart) starts the count over.
  const recovered = () => {
    played = true;
    retries = 0;
  };
  video.addEventListener('playing', recovered);
  let undo: () => void = () => undefined;
  let edge: () => number | null = () => null;
  // The QUALITY key: what the library says the stream carries, what was picked, and how to ask for it.
  let qualityList: QualityChoice[] = [];
  let qualityNow: string = AUTO_QUALITY;
  let choose: (id: string) => void = () => undefined;
  const qualityListeners = new Set<() => void>();
  const listed = (next: QualityChoice[]) => {
    if (detached) return;
    qualityList = next;
    for (const listener of qualityListeners) listener();
    events.onQualities?.();
  };

  const native = () => {
    const durationChanged = () => events.onLive(video.duration === Infinity);
    const failed = () => events.onFatal();
    video.addEventListener('durationchange', durationChanged);
    video.addEventListener('error', failed);
    video.src = link.url;
    edge = () => (video.duration === Infinity ? seekableEdge(video) : null);
    undo = () => {
      video.removeEventListener('durationchange', durationChanged);
      video.removeEventListener('error', failed);
      if (video.getAttribute('src') === link.url) {
        video.removeAttribute('src');
        video.load();
      }
    };
  };

  if (link.kind === 'hls') {
    void import('hls.js').then(({ default: Hls }) => {
      if (detached) return;
      if (!Hls.isSupported()) {
        if (nativeHls(video)) native();
        else events.onFatal();
        return;
      }
      const hls = new Hls();
      let live = false;
      let retryTimer = 0;
      hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
        live = data.details.live;
        events.onLive(live);
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => listed(heightChoices(hls.levels.map((level, index) => ({ id: String(index), height: level.height })))));
      choose = (id) => {
        hls.currentLevel = id === AUTO_QUALITY ? -1 : Number(id);
      };
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (giveUp()) events.onFatal();
        else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) retryTimer = window.setTimeout(() => hls.startLoad(), STREAM_RETRY_MS * 2 ** (retries - 1));
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else events.onFatal();
      });
      hls.attachMedia(video);
      hls.loadSource(link.url);
      edge = () => (live ? hls.liveSyncPosition : null);
      undo = () => {
        window.clearTimeout(retryTimer);
        hls.destroy();
      };
    }, () => events.onFatal());
  } else if (link.kind === 'dash') {
    void import('dashjs').then(({ MediaPlayer }) => {
      if (detached) return;
      const player = MediaPlayer().create();
      let live = false;
      player.on(MediaPlayer.events.STREAM_INITIALIZED, () => {
        live = player.isDynamic();
        events.onLive(live);
        listed(heightChoices(player.getRepresentationsByType('video').map((representation) => ({ id: representation.id, height: representation.height }))));
      });
      choose = (id) => {
        // AUTO hands the choice back to dash.js; anything else holds it on that one.
        player.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: id === AUTO_QUALITY } } } });
        if (id !== AUTO_QUALITY) player.setRepresentationForTypeById('video', id, true);
      };
      // dash.js has already retried a download by the time it reports it.
      player.on(MediaPlayer.events.ERROR, () => {
        if (giveUp()) events.onFatal();
      });
      player.initialize(video, link.url, autoPlay);
      edge = () => (live ? seekableEdge(video) : null);
      undo = () => player.destroy();
    }, () => events.onFatal());
  } else {
    events.onFatal();
  }

  return {
    liveEdge: () => edge(),
    detach: () => {
      detached = true;
      video.removeEventListener('playing', recovered);
      qualityListeners.clear();
      undo();
    },
    qualities: () => qualityList,
    get quality() {
      return qualityNow;
    },
    setQuality: (id) => {
      if (detached || id === qualityNow || !qualityList.some((choice) => choice.id === id)) return;
      qualityNow = id;
      choose(id);
      listed(qualityList);
    },
    onQualities: (listener) => {
      qualityListeners.add(listener);
      return () => qualityListeners.delete(listener);
    },
  };
}

/**
 * Loads a streaming link in this browser, off screen, before it is queued: true when it would play.
 * Only the stream's list of parts is read (and, for DASH, its first parts); nothing is kept.
 */
export function probeStream(link: WatchLink, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    let timer = 0;
    let done = false;
    let handle: StreamHandle | null = null;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      // Not from inside the library's own event: dash.js carries on after its handlers and throws if
      // it was torn down under them.
      window.setTimeout(() => handle?.detach(), 0);
      resolve(ok);
    };
    // As for files (links.ts): a browser that never started loading (iPhone Safari) is let through.
    timer = window.setTimeout(() => finish(video.error === null && video.readyState === 0 && video.networkState === video.NETWORK_IDLE && video.currentSrc !== ''), timeoutMs);
    // A live/not-live answer means the stream's list was read and understood.
    handle = attachStream(video, link, { onLive: () => finish(true), onFatal: () => finish(false) });
    video.addEventListener('loadedmetadata', () => finish(true), { once: true });
  });
}

/** The check a link gets in the adder's browser before it is queued: null when it plays, else the refusal. */
export async function checkLink(link: WatchLink): Promise<string | null> {
  if (link.kind === 'file') return probeVideoLink(link.url);
  if (link.kind === 'youtube' || link.kind === 'vimeo' || link.kind === 'twitch') {
    const { probeEmbed } = await import('./embeds');
    return probeEmbed(link);
  }
  return (await probeStream(link, LINK_PROBE_MS)) ? null : LINK_REFUSALS.wouldNotLoad;
}
