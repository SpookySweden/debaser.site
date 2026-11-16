import { vimeoUrl, vimeoVideo, youtubeId, youtubeWatchUrl } from './links';
import { hasTrim, NO_TRIM, trimmedShape, type Trim } from './video-bars';

/**
 * A video's true shape: how wide it is for how tall (SPEC-rooms-your-room.md, part 3; Luke, 2026-11-16: "when
 * fullscreening a video that has black bars i want the black bars replaced by the backround of the website").
 *
 * Another site's player draws its own black bars inside its frame when the frame is not the video's shape, and nothing
 * outside the frame can recolour them. So the frame is made the video's shape, and what is round it is ours. The shape
 * comes from the site's public oEmbed, the same address the room already asks for a video's title (`youtube-player.ts`,
 * `vimeo-player.ts`): its `width` and `height`. Asked from the browser, once a video, and kept for the visit. A video
 * whose shape is not known is 16:9, which is what both sites' players are.
 *
 * The risk, said once: oEmbed is a public, documented endpoint, but what it answers for an unusual video (a very wide
 * film) is each site's choice. A wrong answer only means bars inside the frame again, as before this existed.
 */

/** 16:9, what a player is when nobody knows better. */
export const WIDE = 16 / 9;

/** The shapes video comes in. A measured shape within a hair of one of these is that one (oEmbed rounds to whole pixels). */
const COMMON = [16 / 9, 4 / 3, 21 / 9, 2.39, 1.85, 2, 1, 5 / 4, 3 / 2, 9 / 16, 3 / 4, 4 / 5];
/** How near counts: 200x113 is YouTube's 16:9, half a percent off. */
const NEAR = 0.015;
/** Nothing is drawn narrower or wider than these, whatever a site says. */
const NARROWEST = 0.4;
const WIDEST = 3;

/** The shape of a picture this many pixels wide and tall, or null when those are not sizes. */
export function shapeFrom(width: unknown, height: unknown): number | null {
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const measured = width / height;
  const common = COMMON.find((shape) => Math.abs(measured - shape) / shape <= NEAR);
  return Math.min(WIDEST, Math.max(NARROWEST, common ?? measured));
}

const share = (part: number) => `${(part * 100).toFixed(2)}%`;

/**
 * What another site's frame of this shape is fitted by in a fullscreen surround: `.stage-fit` reads it (globals.css). With
 * bars to trim, the box that shows is the shape of what is left, and the frame is made that much bigger than the box and
 * cut back to it, so the bars fall outside (nothing else can remove them: the frame's inside is the other site's).
 */
export function stageStyle(shape: number, trim: Trim = NO_TRIM): Record<string, string> {
  if (!hasTrim(trim)) return { '--stage-ratio': shape.toFixed(4) };
  return {
    '--stage-ratio': trimmedShape(shape, trim).toFixed(4),
    '--stage-grow-x': (1 / (1 - 2 * trim.x)).toFixed(4),
    '--stage-grow-y': (1 / (1 - 2 * trim.y)).toFixed(4),
    '--stage-trim-x': share(trim.x),
    '--stage-trim-y': share(trim.y),
  };
}

/**
 * The same for a `<video>` of our own: the element is the shape of what is left and shows only that part of its picture
 * (`object-view-box`, Chrome and Edge; `object-fit: cover` beside it does the same wherever the bars are on one pair of
 * edges only, in every browser). The browser's own controls stay whole, which a frame cut back could not keep.
 */
export function pictureStyle(shape: number, trim: Trim = NO_TRIM): Record<string, string> {
  if (!hasTrim(trim)) return { '--stage-ratio': shape.toFixed(4) };
  return { '--stage-ratio': trimmedShape(shape, trim).toFixed(4), objectViewBox: `inset(${share(trim.y)} ${share(trim.x)})`, objectFit: 'cover' };
}

/** The largest box of this shape that fits in a space this big, in its middle. */
export function fitShape(width: number, height: number, shape: number): { left: number; top: number; w: number; h: number } {
  const w = Math.min(width, height * shape);
  const h = w / shape;
  return { left: (width - w) / 2, top: (height - h) / 2, w, h };
}

/**
 * A frame of shape `base` placed so that what is left of it after `trim` exactly fills the largest box of that shape that
 * fits a space this big: the box (in the space), and the whole frame's place and size measured from the box's corner. The
 * frame is bigger than the box by the bars, which hang outside it and are cut off by whatever clips the box.
 */
export function fitTrimmed(width: number, height: number, base: number, trim: Trim): { box: { left: number; top: number; w: number; h: number }; frame: { left: number; top: number; w: number; h: number } } {
  const box = fitShape(width, height, trimmedShape(base, trim));
  const w = box.w / (1 - 2 * trim.x);
  const h = box.h / (1 - 2 * trim.y);
  return { box, frame: { left: -trim.x * w, top: -trim.y * h, w, h } };
}

/** Where a video's shape can be asked: its site's oEmbed address, or null for a video of no site that says. */
export function shapeAddress(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  const youtube = youtubeId(url);
  // A playlist's player (`/embed/videoseries`) is no one video: its name only looks like a video's.
  if (youtube !== null && youtube !== 'videoseries') return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(youtubeWatchUrl(youtube))}`;
  const vimeo = vimeoVideo(url);
  if (vimeo !== null) return `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(vimeoUrl(vimeo))}`;
  return null;
}

/** What a site's oEmbed says of a video: its shape, and a still of it where the answer has one (an https picture). */
type Facts = { shape: number | null; still: string | null };
const NOTHING: Facts = { shape: null, still: null };

function stillFrom(address: unknown): string | null {
  if (typeof address !== 'string') return null;
  try {
    return new URL(address).protocol === 'https:' ? address : null;
  } catch {
    return null;
  }
}

const asked = new Map<string, Promise<Facts>>();

/** Asked once per video for the visit; never throws. */
function videoFacts(address: string): Promise<Facts> {
  const from = shapeAddress(address);
  if (from === null) return Promise.resolve(NOTHING);
  const before = asked.get(from);
  if (before !== undefined) return before;
  const asking = (async (): Promise<Facts> => {
    try {
      const response = await fetch(from, { signal: AbortSignal.timeout(6000) });
      if (!response.ok) return NOTHING;
      const body = (await response.json()) as { width?: unknown; height?: unknown; thumbnail_url?: unknown };
      return { shape: shapeFrom(body.width, body.height), still: stillFrom(body.thumbnail_url) };
    } catch {
      return NOTHING;
    }
  })();
  asked.set(from, asking);
  // An answer that never came is asked again next time, not remembered as "no shape".
  void asking.then((facts) => {
    if (facts.shape === null) asked.delete(from);
  });
  return asking;
}

/**
 * The shape of the video at this address (a watch page or a player's own address), or null: not a site that says, not
 * reached, or no sizes in the answer. Never throws; asked once per video for the visit.
 */
export function videoShape(address: string): Promise<number | null> {
  return videoFacts(address).then((facts) => facts.shape);
}

/** A still of the video at this address, where its site's answer gives one (Vimeo's does), or null. The same asking as its shape. */
export function videoStill(address: string): Promise<string | null> {
  return videoFacts(address).then((facts) => facts.still);
}
