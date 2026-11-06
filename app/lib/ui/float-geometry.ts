/**
 * Where a floating picture may be (SPEC-floating-player.md). Pure sums, so `Temp/check-floating-player.cjs` can hold them.
 * Used by the site's one floating video (`FloatingPlayer.tsx`) and by a stream room's floated picture (`WatchRoom.tsx`).
 */

export type FloatRect = { x: number; y: number; w: number; h: number };
export type FloatEdges = { top?: boolean; bottom?: boolean; left?: boolean; right?: boolean };
export type FloatScreen = { w: number; h: number };
export type FloatSize = { w: number; h: number };
/** The part of a box the page shows, in screen pixels. */
export type ClipRect = { left: number; top: number; right: number; bottom: number };

/** The room the float's title line takes, on top of the picture. */
export const FLOAT_BAR_HEIGHT = 40;
/** ...and the row of keys under it. */
const FLOAT_KEYS_HEIGHT = 34;
/** Wide enough for its four keys on one row. */
export const FLOAT_VIDEO_SIZE: FloatSize = { w: 440, h: 248 + FLOAT_BAR_HEIGHT + FLOAT_KEYS_HEIGHT };
export const FLOAT_AUDIO_SIZE: FloatSize = { w: 440, h: 44 + FLOAT_BAR_HEIGHT + FLOAT_KEYS_HEIGHT };
/** A folded room's picture: its keys stay on the music bar, so it has the title line alone. */
export const FLOAT_ROOM_SIZE: FloatSize = { w: 384, h: 216 + FLOAT_BAR_HEIGHT };
/** Its keys still fit at this width, on two rows. */
export const FLOAT_MIN: FloatSize = { w: 280, h: 44 + FLOAT_BAR_HEIGHT + FLOAT_KEYS_HEIGHT };
/** The gap kept from the screen's edge and from the strips along the foot. */
const FLOAT_MARGIN = 8;

/** Floats once less than this share of the box is showing: most of the picture has gone by. */
export const KEEP_IN_BOX_SHARE = 1 / 3;

/** The bottom-right corner of the screen, above the strips along the foot. */
export function defaultFloat(size: FloatSize, screen: FloatScreen, floor: number): FloatRect {
  return clampFloat({ x: screen.w - size.w - FLOAT_MARGIN, y: screen.h - floor - size.h - FLOAT_MARGIN, w: size.w, h: size.h }, screen, floor);
}

/**
 * Keeps it whole on screen and off the strips along the foot (`floor` is how far up they reach: the music bar, the
 * START bar). A screen too small for it shrinks it, never below what the screen allows.
 */
export function clampFloat(rect: FloatRect, screen: FloatScreen, floor: number): FloatRect {
  const room = Math.max(FLOAT_MIN.h, screen.h - floor - FLOAT_MARGIN);
  const w = Math.min(Math.max(rect.w, FLOAT_MIN.w), screen.w);
  const h = Math.min(Math.max(rect.h, FLOAT_MIN.h), room);
  const x = Math.min(Math.max(rect.x, 0), Math.max(0, screen.w - w));
  const y = Math.min(Math.max(rect.y, 0), Math.max(0, room - h));
  return { x, y, w, h };
}

/** The rect a grip's drag makes: the far edge stays where it is, as the site's windows do. */
export function resizedFloat(start: FloatRect, edges: FloatEdges, dx: number, dy: number): FloatRect {
  const w = Math.max(FLOAT_MIN.w, start.w + (edges.right ? dx : edges.left ? -dx : 0));
  const h = Math.max(FLOAT_MIN.h, start.h + (edges.bottom ? dy : edges.top ? -dy : 0));
  return {
    x: edges.left ? start.x + start.w - w : start.x,
    y: edges.top ? start.y + start.h - h : start.y,
    w,
    h,
  };
}

/** The part of `box` every one of `clips` (the scrolling panes around it, the screen) lets show. */
export function visiblePart(box: ClipRect, clips: readonly ClipRect[]): ClipRect {
  return clips.reduce(
    (part, clip) => ({
      left: Math.max(part.left, clip.left),
      top: Math.max(part.top, clip.top),
      right: Math.min(part.right, clip.right),
      bottom: Math.min(part.bottom, clip.bottom),
    }),
    box,
  );
}

/**
 * How much of the box shows, 0 to 1. Measured by height against the smaller of the box and the room around it, so a box
 * taller than its pane still counts as fully showing when it fills the pane.
 */
export function shownShare(box: ClipRect, clips: readonly ClipRect[]): number {
  const part = visiblePart(box, clips);
  if (part.right <= part.left || part.bottom <= part.top) return 0;
  const boxHeight = box.bottom - box.top;
  if (boxHeight <= 0 || box.right <= box.left) return 0;
  const room = clips.reduce((least, clip) => Math.min(least, clip.bottom - clip.top), boxHeight);
  return Math.min(1, (part.bottom - part.top) / Math.max(1, Math.min(boxHeight, room)));
}

/** The whole rule for when the video leaves its box: no box, `[ PIP ]`, or scrolled past. */
export function shouldFloat(hasBox: boolean, asked: boolean, share: number): boolean {
  return !hasBox || asked || share < KEEP_IN_BOX_SHARE;
}

/** Biggest of the strips the site publishes along the foot (`use-edge-reserve.ts`); each is `<n>px` or unset. */
export function floorFrom(values: readonly string[]): number {
  return values.reduce((most, value) => {
    const pixels = Number.parseFloat(value);
    return Number.isFinite(pixels) ? Math.max(most, pixels) : most;
  }, 0);
}
