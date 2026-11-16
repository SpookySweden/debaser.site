import { youtubeId } from './links';
import { agreeBars, hasTrim, judgeBars, NO_TRIM, readBars, sameTrim, spoils, type Bars, type Trim } from './video-bars';
import { videoShape, videoStill, WIDE } from './video-shape';

/**
 * Where the pictures come from that `video-bars.ts` reads for black bars (SPEC-rooms-your-room.md, part 4). In the
 * browser only: nothing is sent to the site's server, nothing is kept past the visit.
 *
 * - **YouTube** publishes three stills of every video, taken about a quarter, half and three quarters of the way through
 *   (`i.ytimg.com/vi/<id>/mq1.jpg`, `mq2`, `mq3`), each the 16:9 frame its player shows, bars and all, and lets any page
 *   read them. They are the video's own frames, not the picture an uploader chose for it. The risk, said once: the address
 *   is long-standing but written down nowhere by YouTube; if it goes, nothing is trimmed and the frame is as it was.
 * - **Vimeo** gives one picture with a video's details (its oEmbed `thumbnail_url`), the video's own shape. It is usually a
 *   frame, but an uploader may put any picture there, so it is believed only when it is the shape the video is.
 * - **A file the site plays itself** is read as it plays, every few seconds, where its host lets a page read it (the
 *   site's own storage and the Internet Archive's file servers do).
 * - Any other player (Twitch, an embedded Archive or PeerTube player, a friend's server) shows nothing a page may read.
 */

/** What a frame's stills say: the shape of the frame they picture, and what to trim off it. */
export type FrameBars = { base: number; trim: Trim };

/** The widest a picture is read at: bars are whole rows and columns, so a small copy says as much as a big one. */
const READ_WIDTH = 320;
const STILL_WAIT_MS = 8000;

/** The pixels of a picture or of a video's frame now, drawn `width` by `height`; null where the browser will not hand them over. */
function pixelsOf(source: CanvasImageSource, width: number, height: number): Uint8ClampedArray | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) return null;
  try {
    context.drawImage(source, 0, 0, width, height);
    return context.getImageData(0, 0, width, height).data;
  } catch {
    // A picture from a host that does not let pages read it: drawn, but not handed back.
    return null;
  }
}

/** One still, loaded so its pixels may be read; null when it did not come. */
function loadStill(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    const wait = window.setTimeout(() => resolve(null), STILL_WAIT_MS);
    const done = (found: HTMLImageElement | null) => {
      window.clearTimeout(wait);
      resolve(found);
    };
    image.crossOrigin = 'anonymous';
    image.referrerPolicy = 'no-referrer';
    image.decoding = 'async';
    image.onload = () => done(image.naturalWidth > 0 && image.naturalHeight > 0 ? image : null);
    image.onerror = () => done(null);
    image.src = src;
  });
}

/** The bars in one still, when it is the shape it should be (`shape`, wide for tall): a stand-in picture of another shape says nothing. */
function barsOfStill(image: HTMLImageElement | null, shape: number): Bars | null | undefined {
  if (image === null) return undefined;
  if (Math.abs(image.naturalWidth / image.naturalHeight - shape) / shape > 0.03) return undefined;
  const width = Math.min(READ_WIDTH, image.naturalWidth);
  const height = Math.max(8, Math.round(width / (image.naturalWidth / image.naturalHeight)));
  const pixels = pixelsOf(image, width, height);
  return pixels === null ? undefined : readBars(pixels, width, height);
}

/** The addresses of YouTube's three stills of a video, or none for an address that is not one of its videos. */
export function youtubeStills(address: string): string[] {
  try {
    const id = youtubeId(new URL(address));
    return id === null || id === 'videoseries' ? [] : [1, 2, 3].map((n) => `https://i.ytimg.com/vi/${id}/mq${n}.jpg`);
  } catch {
    return [];
  }
}

const asked = new Map<string, Promise<FrameBars | null>>();

/**
 * What the stills of the video at this address say is bar, or null: a site with no stills, none that came, or no bars
 * found. Asked once a video for the visit. YouTube needs two stills that can be judged; Vimeo has only the one.
 */
export function stillBars(address: string): Promise<FrameBars | null> {
  const before = asked.get(address);
  if (before !== undefined) return before;
  const asking = (async (): Promise<FrameBars | null> => {
    const tube = youtubeStills(address);
    if (tube.length > 0) {
      const stills = await Promise.all(tube.map(loadStill));
      // None came (offline for a moment): asked again next time, not remembered as "no bars".
      if (stills.every((still) => still === null)) asked.delete(address);
      const reads = stills.map((image) => barsOfStill(image, WIDE)).filter((read): read is Bars | null => read !== undefined);
      const trim = agreeBars(reads, 2);
      return hasTrim(trim) ? { base: WIDE, trim } : null;
    }
    const still = await videoStill(address);
    if (still === null) return null;
    const shape = (await videoShape(address)) ?? WIDE;
    const read = barsOfStill(await loadStill(still), shape);
    if (read === undefined) return null;
    const trim = agreeBars([read], 1);
    return hasTrim(trim) ? { base: shape, trim } : null;
  })().catch(() => null);
  asked.set(address, asking);
  return asking;
}

/**
 * How often a playing file is looked at, how far apart two looks must be in the video to count as two, how many are kept,
 * and how many of those must show the same hard edge before anything is trimmed (about six seconds of playing).
 */
const LOOK_MS = 2500;
const FIRST_LOOK_MS = 700;
const APART_SECONDS = 1;
const KEPT = 7;
const SURE = 3;
const WATCH_WIDTH = 160;

/**
 * Watches one of our own `<video>`s for bars as it plays: `onTrim` hears what to trim once enough looks agree. A trim, once
 * found, is held through scenes too dark to judge (a picture that grew and shrank with the lighting would be worse than
 * bars). It is let go for the rest of the play, on that pair of edges, the first time something shows inside a bar:
 * subtitles sitting there, or a film that changes shape part way. Stops for good the first time the browser will not
 * hand the pixels over. Returns the way to stop it.
 */
export function watchVideoBars(video: HTMLVideoElement, onTrim: (trim: Trim) => void): () => void {
  const reads: (Bars | null)[] = [];
  let lookedAt = Number.NaN;
  let said: Trim = NO_TRIM;
  const held = { x: 0, y: 0 };
  const spoilt = { x: false, y: false };
  let timer = 0;
  let first = 0;
  const stop = () => {
    window.clearInterval(timer);
    window.clearTimeout(first);
  };
  const look = () => {
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return;
    if (Number.isFinite(lookedAt) && Math.abs(video.currentTime - lookedAt) < APART_SECONDS) return;
    const height = Math.max(8, Math.round(WATCH_WIDTH / (video.videoWidth / video.videoHeight)));
    const pixels = pixelsOf(video, WATCH_WIDTH, height);
    if (pixels === null) {
      stop();
      return;
    }
    lookedAt = video.currentTime;
    const seen = readBars(pixels, WATCH_WIDTH, height);
    reads.push(seen);
    // Something inside a bar that is being trimmed: let go at once, before the looks kept have had time to agree on it.
    if (seen !== null) {
      const broke = spoils(seen, held);
      spoilt.x = spoilt.x || broke.x;
      spoilt.y = spoilt.y || broke.y;
    }
    if (reads.length > KEPT) reads.shift();
    const judged = judgeBars(reads, SURE);
    spoilt.x = spoilt.x || judged.spoilt.x;
    spoilt.y = spoilt.y || judged.spoilt.y;
    if (judged.trim.x > 0) held.x = judged.trim.x;
    if (judged.trim.y > 0) held.y = judged.trim.y;
    const trim = { x: spoilt.x ? 0 : held.x, y: spoilt.y ? 0 : held.y };
    if (sameTrim(trim, said)) return;
    said = trim;
    onTrim(trim);
  };
  first = window.setTimeout(look, FIRST_LOOK_MS);
  timer = window.setInterval(look, LOOK_MS);
  return stop;
}
