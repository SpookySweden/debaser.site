/**
 * SCREENS: the per-frame times in the viewer's readout, over the last few seconds.
 *
 * The browser keeps running totals from the start of the connection, so a hiccup at the start (or a minute ago) would
 * stay in an average of them for good. These sums take the newest totals against the oldest kept from a few seconds
 * back instead.
 *
 * The browser's "wait in buffer" (jitterBufferDelay) starts its clock when a frame's FIRST packet arrives, so it is two
 * things added together: the rest of the frame's packets arriving (totalAssemblyTime: the network spreading the frame
 * out, which over Wi-Fi is nearly all of it) and the browser holding the whole frame before decoding it.
 */

/** The browser's running totals for the picture at one reading (seconds, as getStats gives them). */
export type VideoTotals = {
  at: number;
  decoded: number;
  emitted: number | null;
  buffer: number | null;
  assembly: number | null;
  processing: number | null;
  decode: number | null;
};

/** How far back the per-frame numbers look. */
export const RECENT_MS = 3000;

export type FrameTimes = {
  /** The readings kept for next time. */
  recent: VideoTotals[];
  /** Milliseconds a frame, or null when the browser does not say. */
  bufferMs: number | null;
  arrivingMs: number | null;
  heldMs: number | null;
  processingMs: number | null;
  decodeMs: number | null;
};

const perFrameMs = (total: number | null, count: number | null): number | null => (total !== null && count !== null && count > 0 ? (total / count) * 1000 : null);
const grew = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a - b);
const START: VideoTotals = { at: 0, decoded: 0, emitted: 0, buffer: 0, assembly: 0, processing: 0, decode: 0 };

/** Adds the newest reading and works out the per-frame times since the oldest one kept (since the start at first). */
export function frameTimes(recent: VideoTotals[], now: VideoTotals): FrameTimes {
  const last = recent[recent.length - 1];
  // A new connection: its totals start again from nothing.
  const kept = last !== undefined && now.decoded < last.decoded ? [now] : [...recent, now];
  while (kept.length > 2 && now.at - kept[0].at > RECENT_MS) kept.shift();
  const from = kept.length > 1 ? kept[0] : START;
  const emitted = grew(now.emitted, from.emitted);
  const decoded = now.decoded - from.decoded;
  const buffer = grew(now.buffer, from.buffer);
  const assembly = grew(now.assembly, from.assembly);
  return {
    recent: kept,
    bufferMs: perFrameMs(buffer, emitted),
    arrivingMs: perFrameMs(assembly, emitted),
    heldMs: buffer === null || assembly === null ? null : perFrameMs(Math.max(0, buffer - assembly), emitted),
    processingMs: perFrameMs(grew(now.processing, from.processing), decoded),
    decodeMs: perFrameMs(grew(now.decode, from.decode), decoded),
  };
}
