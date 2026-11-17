/**
 * The frame both room windows are drawn in (SPEC-rooms-your-room.md, part 1; Luke, 2026-11-16: "in the pre room
 * version of the room i need it so the ui is congruent with the streaming version"): a live room (`WatchRoom.tsx`) and
 * your own room before GO LIVE (`OwnRoomWindow.tsx`).
 *
 * One set of class lists, read by both, so the two cannot drift apart: the picture with its bar of keys under it on
 * the left and the side column on the right; on a phone the picture, then the column. What each window puts in the
 * frame is its own business (a live room's chat, your room's JUST YOU HERE); where things sit is decided here.
 */

/** The whole room, inside its window. */
export const ROOM_ROOT = 'flex flex-col gap-2 sm:h-full sm:min-h-0';
/** The stage and the side column, side by side from `sm` up. */
export const ROOM_COLUMNS = 'flex flex-col gap-2 sm:min-h-0 sm:flex-1 sm:flex-row sm:gap-3';
/** The left column: the screen, and any line said under it. */
export const ROOM_STAGE = 'flex min-w-0 flex-col gap-1 sm:min-h-0 sm:flex-1';
/** The picture with its bar under it, on the black plate: the two go fullscreen together. */
export const ROOM_SCREEN = 'flex flex-col bg-ink-plate sm:min-h-0 sm:flex-1';
/** The picture's box, in the screen (a live room adds where it stands: in the room, or floating). */
export const ROOM_PICTURE_BOX = 'flex min-h-0 flex-1 items-center justify-center';
/** On a desktop the picture takes the column's height; on a phone its own shape. */
export const ROOM_PICTURE_FIT = 'aspect-video w-full sm:aspect-auto sm:h-full';
/** The bar of keys under the picture. `relative`: on a phone the SUBS list opens as a sheet across the bar, just above it. */
export const ROOM_BAR = 'relative flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 bg-ink-plate px-2 py-1 text-label text-sun max-sm:gap-x-1';
/** Where it is and the time, on the bar: a row of its own on a phone, so the keys fit on the one under it. */
export const ROOM_BAR_PLACE = 'flex min-w-12 flex-1 items-center gap-2 max-sm:order-first max-sm:basis-full';
/** The right column: the QUEUE line with the cog, then whoever is here. `relative`: the edge to drag it by sits on its left. */
export const ROOM_SIDE = 'flex flex-col gap-1 sm:relative sm:min-h-0 sm:w-80 sm:shrink-0 lg:w-96';
/** The same, at the width the reader dragged it to (`room-side-width.ts`), given as `--room-side-w`. */
const ROOM_SIDE_SIZED = 'flex flex-col gap-1 sm:relative sm:min-h-0 sm:w-(--room-side-w) sm:shrink-0';

/** The right column's classes and style: the frame's own width, or the one the reader dragged it to (Luke, 2026-11-16). */
export function roomSide(width: number | null): { className: string; style: Record<string, string> | undefined } {
  return width === null ? { className: ROOM_SIDE, style: undefined } : { className: ROOM_SIDE_SIZED, style: { '--room-side-w': `${width}px` } };
}
/** What fills the rest of the side column: a live room's chat, your room's JUST YOU HERE. */
export const ROOM_SIDE_BODY = 'flex flex-col gap-1 sm:min-h-0 sm:flex-1';
/** The settings key's mark: the cog, asked for as a symbol rather than a coloured emoji. */
export const ROOM_COG = '⚙︎';

/*
 * The picture's keys as the marks most video players use (Luke, 2026-11-17: "convert the fullscreen and back button into
 * symbols like used in most video players", "pip should also by symbolised as well as the quality button"). The site's face
 * is IBM Plex Mono's Latin subset, so each of these comes from the reader's own symbol font (Segoe UI Symbol on Windows,
 * Apple Symbols on a Mac, Noto on Android): only marks every system has, none with a coloured emoji form. Each key keeps
 * its words in its accessible name and tooltip.
 */
/** FULL: arrows out to the corners. */
export const ROOM_FULL_MARK = '⤢';
/** Leaving fullscreen: arrows in from the corners. */
export const ROOM_LEAVE_FULL_MARK = '⤡';
/** Picture in picture: a small box over a larger one. */
export const ROOM_PIP_MARK = '⧉';
/** QUALITY: the letters every player's quality key wears; a gear would read as the room's cog. */
export const ROOM_QUALITY_MARK = 'HD';
/**
 * The visualiser and canvas keys' stand-ins until Luke's drawn marks land (`ArtMark`; Luke, 2026-11-17: "symbolised rather
 * than saying exactly what they are"): rising bars for the visualiser, a pencil (U+270E, not U+270F, which has an emoji form)
 * for the canvas.
 */
export const ROOM_VIS_MARK = '▁▃▅';
export const ROOM_CANVAS_MARK = '✎';
/**
 * How long the visualiser and canvas keys stay in the picture's corner after the pointer was last over the picture (Luke,
 * 2026-11-17: "dissapear after not hovering on the player for 5 minutes"). The one number to change.
 */
export const ROOM_CORNER_KEYS_AWAKE_MS = 5 * 60 * 1000;
