import { EmbedPlayer } from './embed-player';

/**
 * LUKE'S SERVER (his Jellyfin, through the bridge at media.debaser.site) kept in step in a room (Luke, 2026-11-27, 3A "full sync").
 *
 * The site can't reach inside the server's frame (another address), so the bridge on SERVER adds a small script to Jellyfin's
 * own page (`G:\MEDIA-HOST\debaser-bridge\bridge.cjs`, `/debaser/remote.js`). It takes play, pause, a jump, the speed and the
 * volume from debaser.site only, and says where Jellyfin's player is. This wraps that conversation to act as the stage's
 * `<video>`, as the YouTube and Vimeo players do, so the room's host writes it and its followers follow it.
 *
 * It is made only once the frame's script has said hello (`isJellyfinHello`): a server without the script, or a Jellyfin whose
 * page changed under it, never says it, and the room keeps today's way (the host's PLAY FOR ALL starts everyone's from the top).
 */

/** The word every message of this conversation carries, both ways. */
export const JELLYFIN_REMOTE = 'debaser-jellyfin';

/** What the frame's script says: an event, and where its player is. */
type RemoteState = {
  debaser: typeof JELLYFIN_REMOTE;
  event: string;
  ready: boolean;
  time: number;
  duration: number;
  paused: boolean;
  ended: boolean;
};

function asState(data: unknown): RemoteState | null {
  if (typeof data !== 'object' || data === null) return null;
  const said = data as Partial<RemoteState>;
  if (said.debaser !== JELLYFIN_REMOTE || typeof said.event !== 'string') return null;
  const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  return {
    debaser: JELLYFIN_REMOTE,
    event: said.event,
    ready: said.ready === true,
    time: Math.max(0, number(said.time)),
    duration: Math.max(0, number(said.duration)),
    paused: said.paused !== false,
    ended: said.ended === true,
  };
}

/** Whether a message is the server's frame saying it can be driven (any word of the conversation counts). */
export function isJellyfinHello(event: MessageEvent, frame: HTMLIFrameElement, origin: string): boolean {
  return event.source === frame.contentWindow && event.origin === origin && asState(event.data) !== null;
}

/** How long a start may take before the frame has a player (its play key pressed, the film loading) and still count as on its way. */
const START_WAIT_MS = 12000;

export class JellyfinPlayable extends EmbedPlayer {
  private time = 0;
  private length = 0;
  private playingHere = false;
  private startingSince: number | null = null;
  private readonly heard = (event: MessageEvent) => this.hear(event);

  constructor(
    private readonly frame: HTMLIFrameElement,
    private readonly origin: string,
    autoPlay: boolean,
  ) {
    super(autoPlay);
    window.addEventListener('message', this.heard);
    this.send({ cmd: 'state' });
    // The frame has spoken already (that is why this exists): it can take orders now, before its own player is made.
    window.setTimeout(() => this.becameReady(), 0);
  }

  private send(order: Record<string, unknown>) {
    this.frame.contentWindow?.postMessage({ debaser: JELLYFIN_REMOTE, ...order }, this.origin);
  }

  private hear(event: MessageEvent) {
    if (this.destroyed || event.source !== this.frame.contentWindow || event.origin !== this.origin) return;
    const state = asState(event.data);
    if (state === null) return;
    this.time = state.time;
    this.length = state.duration;
    // A new video element in the frame comes up with its own sound: it is told this device's volume and mute again.
    if (state.event === 'player' || state.event === 'loadedmetadata') this.siteVolume(this.volume, this.muted);
    if (state.event === 'blocked') {
      this.startingSince = null;
      this.blockedByBrowser();
      return;
    }
    if (state.event === 'starting') {
      // Its play key was pressed; the film is on its way (a server converting it takes a moment).
      this.startingSince = Date.now();
      this.bufferingNow = true;
      return;
    }
    if (state.event === 'waiting') this.bufferingNow = true;
    if (state.ended && state.event === 'ended') {
      this.playingHere = false;
      this.becameEnded();
      return;
    }
    if (state.event === 'seeked') this.becameSeeked();
    const playing = state.ready && !state.paused && !state.ended;
    if (playing && !this.playingHere) {
      this.playingHere = true;
      this.startingSince = null;
      this.becamePlaying();
    } else if (!playing && this.playingHere && state.ready) {
      this.playingHere = false;
      this.becamePaused();
    }
    if (this.startingSince !== null && Date.now() - this.startingSince > START_WAIT_MS) {
      this.startingSince = null;
      this.bufferingNow = false;
    }
  }

  protected siteTime(): number {
    return this.time;
  }

  protected siteDuration(): number {
    return this.length;
  }

  protected sitePlay(): void {
    this.send({ cmd: 'play' });
  }

  protected sitePause(): void {
    this.send({ cmd: 'pause' });
  }

  protected siteSeek(seconds: number): void {
    this.time = seconds;
    this.send({ cmd: 'seek', seconds });
  }

  protected siteVolume(volume: number, muted: boolean): void {
    this.send({ cmd: 'volume', volume, muted });
  }

  protected siteRate(rate: number): void {
    this.send({ cmd: 'rate', rate });
  }

  protected siteDestroy(): void {
    window.removeEventListener('message', this.heard);
  }

  get isLive(): boolean {
    return false;
  }
}
