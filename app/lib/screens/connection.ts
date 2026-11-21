import { sendOffer } from './host-client';

/**
 * SCREENS: the stream itself, ported from the engine's own viewer page (`engine/web/viewer.html`, its CONNECT part).
 * The "hello": our offer goes to the site (`/api/screens/offer`), which checks who is asking and passes it to the
 * engine on the PC; the engine's answer comes back, and the video and CONTROL's two channels then travel directly
 * between this browser and the engine.
 */

export type ConnectionHooks = {
  /** The stream's video has arrived. */
  onTrack: (track: MediaStreamTrack, stream: MediaStream) => void;
  /** The picture is on its way: the moment to tell the PC what this device wants of it. */
  onConnected: () => void;
  /** The connection failed or the engine stopped sending, said in plain words; '' when it is flowing (again). */
  onProblem: (why: string) => void;
  /** What the PC says about control (a `keys` message). */
  onPcSays: (bytes: Uint8Array) => void;
  /** CONTROL's channel closed. */
  onKeysClosed: () => void;
};

/** The receiver's own numbers, for the readouts. */
export type StreamStats = {
  connectionState: string;
  framesDecoded: number;
  framesDropped: number;
  packetsLost: number;
  nackCount: number;
  pliCount: number;
  framesPerSecond: number | null;
  frameWidth: number | null;
  frameHeight: number | null;
  jitterBufferDelayMsPerFrame: number | null;
  processingDelayMsPerFrame: number | null;
  decodeMsPerFrame: number | null;
  decoderImplementation: string | null;
  mimeType: string | null;
};

const perFrameMs = (total: unknown, count: unknown): number | null => (typeof total === 'number' && typeof count === 'number' && count > 0 ? (total / count) * 1000 : null);
const numberOf = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const textOf = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export class ScreenConnection {
  /** The number the PC gave this viewer. */
  viewer: string | null = null;
  connected = false;

  private connection: RTCPeerConnection | null = null;
  private keys: RTCDataChannel | null = null;
  private pointer: RTCDataChannel | null = null;
  private stopped = false;

  constructor(private readonly hooks: ConnectionHooks) {}

  /** Connects. Rejects with the reason in plain words when the hello could not be made. */
  async start(): Promise<void> {
    // No outside helpers (STUN or TURN servers): the engine tells us its own address in its answer.
    const connection = new RTCPeerConnection({ iceServers: [] });
    this.connection = connection;
    const transceiver = connection.addTransceiver('video', { direction: 'recvonly' });

    // CONTROL's two channels are part of the offer. Keys, buttons and the wheel must all arrive, in order.
    // Pointer movement must be NEW: a position that was lost is not sent again, the next one replaces it.
    const keys = connection.createDataChannel('keys', { ordered: true });
    this.keys = keys;
    this.pointer = connection.createDataChannel('pointer', { ordered: false, maxRetransmits: 0 });
    keys.binaryType = 'arraybuffer';
    keys.onmessage = (event: MessageEvent) => {
      if (!this.stopped && event.data instanceof ArrayBuffer) this.hooks.onPcSays(new Uint8Array(event.data));
    };
    keys.onclose = () => {
      if (!this.stopped) this.hooks.onKeysClosed();
    };

    // Ask for H.264 first, since that is what the engine's video chip makes.
    try {
      const all = RTCRtpReceiver.getCapabilities('video')?.codecs ?? [];
      const isH264 = (codec: RTCRtpCodec) => codec.mimeType.toLowerCase() === 'video/h264';
      const h264 = all.filter(isH264);
      if (h264.length > 0) transceiver.setCodecPreferences([...h264, ...all.filter((codec) => !isH264(codec))]);
    } catch {
      /* an older browser: it still offers H.264, just not first */
    }

    connection.ontrack = (event) => {
      if (this.stopped) return;
      // Ask the browser to keep no waiting queue: show each frame as soon as it is decoded.
      try {
        event.receiver.jitterBufferTarget = 0;
      } catch {
        /* not in this browser */
      }
      try {
        (event.receiver as RTCRtpReceiver & { playoutDelayHint?: number }).playoutDelayHint = 0;
      } catch {
        /* not in this browser */
      }
      this.hooks.onTrack(event.track, event.streams[0] ?? new MediaStream([event.track]));
    };
    connection.onconnectionstatechange = () => {
      if (this.stopped) return;
      const state = connection.connectionState;
      if (state === 'connected') {
        // Back after a hiccup: whatever was said about it no longer holds.
        this.hooks.onProblem('');
        if (!this.connected) {
          this.connected = true;
          this.hooks.onConnected();
        }
      }
      if (state === 'failed') this.hooks.onProblem('the connection failed');
      if (state === 'closed' || state === 'disconnected') this.hooks.onProblem('the engine stopped sending');
    };

    await connection.setLocalDescription(await connection.createOffer());
    // Let go of before the hello was even sent: it is not sent.
    if (this.stopped) return;
    const offer = connection.localDescription?.sdp ?? '';
    const answer = await sendOffer(offer);
    // Let go of while the hello was on its way: nothing more is done with its answer.
    if (this.stopped) return;
    // The PC numbers its viewers; saying ours back lets it tell this device whether control is "yours".
    this.viewer = answer.viewer;
    await connection.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
  }

  /**
   * Closes the connection and both channels. Nothing is heard from it from this moment on. `lastWordsMs` gives a
   * message just sent ("I am letting go" of control) that long to leave before the line is cut: closing at once can
   * drop it, and the PC would then only find out by the silence.
   */
  stop(lastWordsMs = 0): void {
    if (this.stopped) return;
    this.stopped = true;
    this.connected = false;
    if (lastWordsMs > 0) window.setTimeout(() => this.close(), lastWordsMs);
    else this.close();
  }

  private close(): void {
    const connection = this.connection;
    this.connection = null;
    for (const channel of [this.keys, this.pointer]) {
      if (channel === null) continue;
      channel.onmessage = null;
      channel.onclose = null;
      try {
        channel.close();
      } catch {
        /* already closed */
      }
    }
    this.keys = null;
    this.pointer = null;
    if (connection !== null) {
      connection.ontrack = null;
      connection.onconnectionstatechange = null;
      connection.close();
    }
  }

  private static send(channel: RTCDataChannel | null, bytes: Uint8Array<ArrayBuffer>): boolean {
    if (channel === null || channel.readyState !== 'open') return false;
    try {
      channel.send(bytes);
      return true;
    } catch {
      return false;
    }
  }

  /** On the `keys` channel: in order and never lost. False when it is not open. */
  sendKeys(bytes: Uint8Array<ArrayBuffer>): boolean {
    return ScreenConnection.send(this.keys, bytes);
  }

  /** On the `pointer` channel: the newest only. False when it is not open. */
  sendPointer(bytes: Uint8Array<ArrayBuffer>): boolean {
    return ScreenConnection.send(this.pointer, bytes);
  }

  async stats(): Promise<StreamStats> {
    const connection = this.connection;
    const result: StreamStats = {
      connectionState: connection === null ? 'none' : connection.connectionState,
      framesDecoded: 0,
      framesDropped: 0,
      packetsLost: 0,
      nackCount: 0,
      pliCount: 0,
      framesPerSecond: null,
      frameWidth: null,
      frameHeight: null,
      jitterBufferDelayMsPerFrame: null,
      processingDelayMsPerFrame: null,
      decodeMsPerFrame: null,
      decoderImplementation: null,
      mimeType: null,
    };
    if (connection === null) return result;
    const report = await connection.getStats();
    const inbound: Record<string, unknown>[] = [];
    const codecs = new Map<string, Record<string, unknown>>();
    report.forEach((entry: Record<string, unknown>) => {
      if (entry.type === 'inbound-rtp' && entry.kind === 'video') inbound.push(entry);
      if (entry.type === 'codec' && typeof entry.id === 'string') codecs.set(entry.id, entry);
    });
    if (inbound.length === 0) return result;
    const seen = inbound[inbound.length - 1];
    result.framesDecoded = numberOf(seen.framesDecoded) ?? 0;
    result.framesDropped = numberOf(seen.framesDropped) ?? 0;
    result.packetsLost = numberOf(seen.packetsLost) ?? 0;
    result.nackCount = numberOf(seen.nackCount) ?? 0;
    result.pliCount = numberOf(seen.pliCount) ?? 0;
    result.framesPerSecond = numberOf(seen.framesPerSecond);
    result.frameWidth = numberOf(seen.frameWidth);
    result.frameHeight = numberOf(seen.frameHeight);
    result.decoderImplementation = textOf(seen.decoderImplementation);
    result.jitterBufferDelayMsPerFrame = perFrameMs(seen.jitterBufferDelay, seen.jitterBufferEmittedCount);
    result.processingDelayMsPerFrame = perFrameMs(seen.totalProcessingDelay, seen.framesDecoded);
    result.decodeMsPerFrame = perFrameMs(seen.totalDecodeTime, seen.framesDecoded);
    const codec = typeof seen.codecId === 'string' ? codecs.get(seen.codecId) : undefined;
    result.mimeType = codec === undefined ? null : textOf(codec.mimeType);
    return result;
  }
}
