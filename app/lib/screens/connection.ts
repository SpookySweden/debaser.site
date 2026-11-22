import { gathered } from './devices';
import { iceServersNow } from './relay-client';
import { sendOffer, type EngineId } from './host-client';
import { routeFromStats, type NetRoute } from './net-route';
import { frameTimes, type VideoTotals } from './frame-times';
import { isLoopbackAddress } from './wire';

/**
 * SCREENS: the stream itself, ported from the engine's own viewer page (`engine/web/viewer.html`, its CONNECT part).
 * The "hello": our offer goes to the site (`/api/screens/offer`), which checks who is asking and passes it to the
 * engine on the PC; the engine's answer comes back, and the video and CONTROL's two channels then travel directly
 * between this browser and the engine.
 */

export type ConnectionHooks = {
  /** Which machine's engine the hello goes to (THE PC when not said). */
  engine?: EngineId;
  /** The stream's video has arrived, in a stream of its own. */
  onTrack: (track: MediaStreamTrack, stream: MediaStream) => void;
  /** The stream's sound line has arrived, in a stream of its own (silent until this device asks for sound). */
  onSound: (track: MediaStreamTrack, stream: MediaStream) => void;
  /** The `keys` channel is open: the PC can be told things now. */
  onKeysOpen: () => void;
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
  /**
   * The browser's "wait in buffer" (jitterBufferDelay), over the last few seconds. The browser starts its clock when
   * a frame's FIRST packet arrives, so it is the two below added together.
   */
  jitterBufferDelayMsPerFrame: number | null;
  /** Of that: from a frame's first packet arriving to its last (the network spreading the frame out; totalAssemblyTime). */
  arrivingMsPerFrame: number | null;
  /** Of that: the frame held, whole, by the browser before decoding. */
  heldMsPerFrame: number | null;
  processingDelayMsPerFrame: number | null;
  decodeMsPerFrame: number | null;
  /** The connection's round trip, this browser to the PC and back. */
  roundTripMs: number | null;
  decoderImplementation: string | null;
  mimeType: string | null;
  /** The browser's own numbers for the sound it has received. */
  sound: { packetsReceived: number; packetsLost: number; jitterBufferDelayMsPerSample: number | null; mimeType: string | null };
  /**
   * Whether the engine was reached on this very machine (the connection's far end is 127.0.0.1 or ::1): then this
   * device IS the PC. Null until the connection has chosen its path.
   */
  reachedOnThisMachine: boolean | null;
  /** Which way the picture travels (net-route.ts). Null until the connection has chosen. */
  route: NetRoute | null;
};

const perFrameMs = (total: unknown, count: unknown): number | null => (typeof total === 'number' && typeof count === 'number' && count > 0 ? (total / count) * 1000 : null);
const numberOf = (value: unknown): number | null => (typeof value === 'number' ? value : null);const textOf = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export class ScreenConnection {
  /** The number the PC gave this viewer. */
  viewer: string | null = null;
  connected = false;

  private connection: RTCPeerConnection | null = null;
  private keys: RTCDataChannel | null = null;
  private pointer: RTCDataChannel | null = null;
  private stopped = false;
  private recent: VideoTotals[] = [];

  constructor(private readonly hooks: ConnectionHooks) {}

  /** Connects. Rejects with the reason in plain words when the hello could not be made. */
  async start(): Promise<void> {
    // Cloudflare's public STUN server tells this browser its outside address, so an engine outside this network can
    // reach it too, and once the relay key is set Cloudflare's TURN relay carries the picture where no direct way
    // exists (a phone on mobile data). On the home network the engine's own addresses still win.
    const connection = new RTCPeerConnection({ iceServers: await iceServersNow() });
    this.connection = connection;
    const transceiver = connection.addTransceiver('video', { direction: 'recvonly' });
    // SOUND has a line of its own in the same hello. Nothing travels on it until this device asks.
    connection.addTransceiver('audio', { direction: 'recvonly' });

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
    keys.onopen = () => {
      if (!this.stopped) this.hooks.onKeysOpen();
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
      // The sound and the picture are kept apart on purpose, each in a stream of its own: a browser that knew the
      // two belonged together would hold the picture back to keep it in step with the sound's queue.
      if (event.track.kind === 'audio') this.hooks.onSound(event.track, new MediaStream([event.track]));
      else this.hooks.onTrack(event.track, new MediaStream([event.track]));
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
    // The hello carries this browser's addresses, the outside one too, so an engine outside the home can send its
    // checks back (both sides at once is what opens the way through routers). At most 1.5 s, once per connection.
    await gathered(connection, 1500);
    // Let go of before the hello was even sent: it is not sent.
    if (this.stopped) return;
    const offer = connection.localDescription?.sdp ?? '';
    const answer = await sendOffer(offer, this.hooks.engine ?? 'pc');
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
      arrivingMsPerFrame: null,
      heldMsPerFrame: null,
      processingDelayMsPerFrame: null,
      decodeMsPerFrame: null,
      roundTripMs: null,
      decoderImplementation: null,
      mimeType: null,
      sound: { packetsReceived: 0, packetsLost: 0, jitterBufferDelayMsPerSample: null, mimeType: null },
      reachedOnThisMachine: null,
      route: null,
    };
    if (connection === null) return result;
    const report = await connection.getStats();
    const inbound: Record<string, unknown>[] = [];
    const heard: Record<string, unknown>[] = [];
    const codecs = new Map<string, Record<string, unknown>>();
    const byId = new Map<string, Record<string, unknown>>();
    report.forEach((entry: Record<string, unknown>) => {
      if (typeof entry.id === 'string') byId.set(entry.id, entry);
      if (entry.type === 'inbound-rtp' && entry.kind === 'video') inbound.push(entry);
      if (entry.type === 'inbound-rtp' && entry.kind === 'audio') heard.push(entry);
      if (entry.type === 'codec' && typeof entry.id === 'string') codecs.set(entry.id, entry);
    });
    // The path the connection chose: the transport names its pair, the pair its far end, the far end its address.
    let pair: Record<string, unknown> | undefined;
    for (const entry of byId.values()) {
      if (entry.type === 'transport' && typeof entry.selectedCandidatePairId === 'string') pair = byId.get(entry.selectedCandidatePairId);
    }
    if (pair === undefined) {
      for (const entry of byId.values()) if (entry.type === 'candidate-pair' && entry.nominated === true && entry.state === 'succeeded') pair = entry;
    }
    const far = pair !== undefined && typeof pair.remoteCandidateId === 'string' ? byId.get(pair.remoteCandidateId) : undefined;
    const address = far === undefined ? null : (textOf(far.address) ?? textOf(far.ip));
    // This device is the PC itself when the far end is this machine's loopback address, or (with the engine checking
    // both ways, --internet) when both ends of the chosen path have the same address.
    const near = pair !== undefined && typeof pair.localCandidateId === 'string' ? byId.get(pair.localCandidateId) : undefined;
    const nearAddress = near === undefined ? null : (textOf(near.address) ?? textOf(near.ip));
    if (address !== null && address !== '') result.reachedOnThisMachine = isLoopbackAddress(address) || (nearAddress !== null && nearAddress === address);
    result.route = routeFromStats(byId);
    const roundTrip = pair === undefined ? null : numberOf(pair.currentRoundTripTime);
    result.roundTripMs = roundTrip === null ? null : roundTrip * 1000;
    if (heard.length > 0) {
      const sound = heard[heard.length - 1];
      const soundCodec = typeof sound.codecId === 'string' ? codecs.get(sound.codecId) : undefined;
      result.sound = {
        packetsReceived: numberOf(sound.packetsReceived) ?? 0,
        packetsLost: numberOf(sound.packetsLost) ?? 0,
        // How long, on average, a sample of sound waits in this browser before it is played.
        jitterBufferDelayMsPerSample: perFrameMs(sound.jitterBufferDelay, sound.jitterBufferEmittedCount),
        mimeType: soundCodec === undefined ? null : textOf(soundCodec.mimeType),
      };
    }
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
    // Per frame over the last few seconds, not since the start (frame-times.ts).
    const times = frameTimes(this.recent, {
      at: performance.now(),
      decoded: result.framesDecoded,
      emitted: numberOf(seen.jitterBufferEmittedCount),
      buffer: numberOf(seen.jitterBufferDelay),
      assembly: numberOf(seen.totalAssemblyTime),
      processing: numberOf(seen.totalProcessingDelay),
      decode: numberOf(seen.totalDecodeTime),
    });
    this.recent = times.recent;
    result.jitterBufferDelayMsPerFrame = times.bufferMs;
    result.arrivingMsPerFrame = times.arrivingMs;
    result.heldMsPerFrame = times.heldMs;
    result.processingDelayMsPerFrame = times.processingMs;
    result.decodeMsPerFrame = times.decodeMs;
    const codec = typeof seen.codecId === 'string' ? codecs.get(seen.codecId) : undefined;
    result.mimeType = codec === undefined ? null : textOf(codec.mimeType);
    return result;
  }
}
