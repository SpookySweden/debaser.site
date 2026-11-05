import type { WebPlatform } from './types';

/**
 * Where an embedded player has got to, so a closed video can start again from there (SPEC-floating-player.md).
 *
 * Only two platforms' players say: YouTube and Vimeo answer messages sent to their frame. The frame stays the platform's
 * own embed, sandboxed as before, and no script of theirs runs in our page. An Internet Archive or PeerTube embed, or a
 * media server's own player, cannot be asked, so those start from the top when played again.
 *
 * YouTube's messages are what its own script sends, not a documented API (the risk is said once, in core.md's "forever
 * project"). If they ever change nothing breaks: no time arrives, and a video played again starts from the top.
 */

export type TimeSource = 'youtube' | 'vimeo';

const YOUTUBE_FRAME_ORIGINS: readonly string[] = ['https://www.youtube-nocookie.com', 'https://www.youtube.com'];
const VIMEO_FRAME_ORIGINS: readonly string[] = ['https://player.vimeo.com'];
/** How often to say we are listening until the player answers: it ignores anything sent before it has loaded. */
const HELLO_MS = 1000;

/** Which players can tell us their time. */
export function timeSourceOf(platform: WebPlatform): TimeSource | null {
  return platform === 'youtube' ? 'youtube' : platform === 'vimeo' ? 'vimeo' : null;
}

/**
 * A checked player address, set up to say its time and to start from `seconds` when there is a place to go back to.
 * Runs after `rowAddresses` has checked the address and `startingEmbed` has added its flags.
 */
export function embedWithPlace(address: string, source: TimeSource | null, seconds: number | null, origin: string): string {
  const from = seconds !== null && seconds >= 1 ? Math.floor(seconds) : null;
  if (source === 'youtube') {
    const url = new URL(address);
    url.searchParams.set('enablejsapi', '1');
    // YouTube answers only a page it has been told about.
    url.searchParams.set('origin', origin);
    if (from !== null) url.searchParams.set('start', String(from));
    return url.toString();
  }
  if (source === 'vimeo' && from !== null) return `${address}#t=${from}s`;
  return address;
}

/** What a player's message said: its time, the end, or nothing we use. Third-party text, so nothing is assumed of it. */
export function readTimeMessage(source: TimeSource, data: unknown): { seconds: number } | 'ended' | null {
  let message: unknown = data;
  if (typeof data === 'string') {
    try {
      message = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (typeof message !== 'object' || message === null) return null;
  const said = message as { event?: unknown; info?: unknown; data?: unknown };
  if (source === 'youtube') {
    if (said.event !== 'infoDelivery' && said.event !== 'initialDelivery') return null;
    const info = said.info as { currentTime?: unknown; playerState?: unknown } | null | undefined;
    if (info?.playerState === 0) return 'ended';
    return typeof info?.currentTime === 'number' && Number.isFinite(info.currentTime) ? { seconds: info.currentTime } : null;
  }
  if (said.event === 'ended') return 'ended';
  if (said.event !== 'timeupdate' && said.event !== 'playProgress') return null;
  const seconds = (said.data as { seconds?: unknown } | null | undefined)?.seconds;
  return typeof seconds === 'number' && Number.isFinite(seconds) ? { seconds } : null;
}

/** Listens to a frame's player. `onTime(null)`: it reached the end. Returns the way to stop listening. */
export function listenForTime(frame: HTMLIFrameElement, source: TimeSource, onTime: (seconds: number | null) => void): () => void {
  const origins = source === 'youtube' ? YOUTUBE_FRAME_ORIGINS : VIMEO_FRAME_ORIGINS;
  const target = () => {
    try {
      return new URL(frame.src).origin;
    } catch {
      return null;
    }
  };
  const hello = () => {
    const origin = target();
    if (origin === null || !origins.includes(origin)) return;
    if (source === 'youtube') {
      frame.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), origin);
    } else {
      for (const value of ['timeupdate', 'ended']) frame.contentWindow?.postMessage(JSON.stringify({ method: 'addEventListener', value }), origin);
    }
  };
  let answered = false;
  const heard = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || !origins.includes(event.origin)) return;
    const said = readTimeMessage(source, event.data);
    if (source === 'vimeo' && !answered && typeof event.data === 'string' && event.data.includes('"ready"')) hello();
    if (said === null) return;
    answered = true;
    onTime(said === 'ended' ? null : said.seconds);
  };
  window.addEventListener('message', heard);
  frame.addEventListener('load', hello);
  const timer = window.setInterval(() => {
    if (answered) window.clearInterval(timer);
    else hello();
  }, HELLO_MS);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener('message', heard);
    frame.removeEventListener('load', hello);
  };
}
