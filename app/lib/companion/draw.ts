import type { MotionId } from '../character/motion';
import { cellAt, type CharacterSheet } from '../character/sheet';
import { LEDGE_SELECTOR, measureFloor, type Floor } from './floor';
import type { ThrowLook } from './throw';
import type { CompanionMood } from './wire';

/**
 * How a companion's figure is drawn (moved out of `app/components/Companion.tsx`, 2026-11-16, so a profile ROOM's
 * character taken out of its window, `LooseCharacter.tsx`, draws the same way without pulling in the companion layer):
 * its box, the empty margin round its picture, the floor it stands on, and one frame written straight to the figure's
 * style. Plain DOM, no React, nothing drawn: a cell of its owner's baked strip, moved, mirrored, squashed and copied.
 */

/** The placeholder's box, in CSS pixels, when there is no SHOWN character to wear. */
export const PLACEHOLDER = { w: 32, h: 32 } as const;
/** Screen pixels per strip pixel: a whole number, so every block of the character is the same size. */
export const SCALE = 2;

/** No empty margin known round its picture: its box is taken as full. */
export const NO_INSETS = { left: 0, right: 0, top: 0 } as const;
export type Insets = { left: number; right: number; top: number };

/**
 * The empty margin round the figure in one cell of its strip, in screen pixels: how far its picture stops short of its
 * box on the left, the right and the top. A splat puts the figure itself on the glass, not the empty edge of its box, so
 * the cell it splats in is looked at once (its own baked frame, read back; nothing is drawn). No margin when it cannot
 * be read.
 */
export function measureInsets(look: NonNullable<Look>, motion: MotionId): Promise<Insets> {
  return new Promise((resolve) => {
    const { sheet } = look;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onerror = () => resolve(NO_INSETS);
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = sheet.cell.w;
        canvas.height = sheet.cell.h;
        const context = canvas.getContext('2d');
        if (context === null) return resolve(NO_INSETS);
        const at = cellAt(sheet, sheet.motions[motion].ticks[0]);
        context.drawImage(image, at.x, at.y, sheet.cell.w, sheet.cell.h, 0, 0, sheet.cell.w, sheet.cell.h);
        const { data } = context.getImageData(0, 0, sheet.cell.w, sheet.cell.h);
        let left = sheet.cell.w;
        let right = -1;
        let top = sheet.cell.h;
        for (let row = 0; row < sheet.cell.h; row += 1) {
          for (let column = 0; column < sheet.cell.w; column += 1) {
            if (data[(row * sheet.cell.w + column) * 4 + 3] === 0) continue;
            left = Math.min(left, column);
            right = Math.max(right, column);
            top = Math.min(top, row);
          }
        }
        if (right < 0) return resolve(NO_INSETS);
        resolve({ left: left * SCALE, right: (sheet.cell.w - 1 - right) * SCALE, top: top * SCALE });
      } catch {
        // A picture this page may not read back: its box is taken as full.
        resolve(NO_INSETS);
      }
    };
    image.src = look.stripUrl;
  });
}

/** What a figure wears: a SHOWN character's baked strip, or nothing (the placeholder field). */
export type Look = { stripUrl: string; sheet: CharacterSheet } | null;

export type Size = { w: number; h: number };

/** The box: a cell of the strip, cut at the feet (the spare row under them is margin), or the placeholder's. */
export function sizeOf(look: Look): Size {
  return look === null ? PLACEHOLDER : { w: look.sheet.cell.w * SCALE, h: look.sheet.floor * SCALE };
}

/** The floor, measured at most once a second (and at once when the screen changes size), shared by figures of a size. */
const floorCache = new Map<string, { at: number; w: number; h: number; ledge: string; floor: Floor }>();
/** Where the stream room's window is just now (its top and two sides, or that it is folded away or not there). */
function ledgeMark(): string {
  const ledge = document.querySelector<HTMLElement>(LEDGE_SELECTOR);
  if (ledge === null) return 'none';
  if (ledge.dataset.minimized === 'true') return 'folded';
  const box = ledge.getBoundingClientRect();
  return `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.right)}`;
}
export function floorNow(size: Size): Floor {
  const now = Date.now();
  const key = `${size.w}x${size.h}`;
  const held = floorCache.get(key);
  // A stream room's window moving, folding or closing changes the floor at once: it is looked at every time (one box).
  const ledge = ledgeMark();
  if (held === undefined || now - held.at > 1_000 || held.w !== window.innerWidth || held.h !== window.innerHeight || held.ledge !== ledge) {
    const floor = measureFloor(size.w, size.h);
    floorCache.set(key, { at: now, w: window.innerWidth, h: window.innerHeight, ledge: ledgeMark(), floor });
    return floor;
  }
  return held.floor;
}

/** Places the figure and paints its body: a cell of the strip (mirrored when it faces left), or the placeholder. */
export function draw(
  place: HTMLDivElement | null,
  body: HTMLSpanElement | null,
  look: Look,
  frame: {
    x: number;
    floorY: number;
    facing: 1 | -1;
    mood: CompanionMood;
    motion: MotionId;
    tick: number;
    lift: number;
    held?: boolean;
    /** By the player bar's TV (`./tv-seat.ts`): half size, `x` and `floorY` being the small figure's left and feet. */
    half?: boolean;
    /** Thrown, or settling after it: its frame squashed, stretched, nudged, and copies of it trailing (`throw.ts`). */
    fx?: ThrowLook | null;
    /** Which part of a throw it is in, written on the figure (`data-throw`) for the drives to read. */
    thrown?: string;
  },
) {
  const size = sizeOf(look);
  if (place !== null) {
    // Its name opens toward the middle of the screen, so it is never cut off at either edge.
    const side = frame.x > window.innerWidth / 2 ? 'right' : 'left';
    if (place.dataset.side !== side) {
      place.dataset.side = side;
      const tag = place.querySelector<HTMLElement>('[data-companion-name]');
      if (tag !== null) {
        tag.style.left = side === 'left' ? '0' : 'auto';
        tag.style.right = side === 'right' ? '0' : 'auto';
      }
    }
    const half = frame.half === true;
    // Half size is the whole box scaled from its top-left: two of the strip's pixels to one of the screen's, still hard.
    place.style.transformOrigin = half ? '0 0' : '';
    place.style.transform = `translate3d(${Math.round(frame.x)}px, ${Math.round(frame.floorY - (half ? size.h / 2 : size.h))}px, 0)${half ? ' scale(0.5)' : ''}`;
    if ((place.dataset.half === 'true') !== half) place.dataset.half = String(half);
    place.style.visibility = 'visible';
    // Where the rules have it this frame, written on the figure for the drives: in the hand or in the air it is drawn
    // between frames too (`glide`), so its box alone is not always a frame's own place.
    const at = String(Math.round(frame.x));
    const feet = String(Math.round(frame.floorY));
    if (place.dataset.x !== at) place.dataset.x = at;
    if (place.dataset.feet !== feet) place.dataset.feet = feet;
    if (place.dataset.mood !== frame.mood) place.dataset.mood = frame.mood;
    if (place.dataset.motion !== frame.motion) place.dataset.motion = frame.motion;
    const face = frame.facing === 1 ? 'right' : 'left';
    if (place.dataset.facing !== face) place.dataset.facing = face;
    // Off its strip in the reader's hand, or falling back to it.
    const held = frame.held === true ? 'true' : 'false';
    if (place.dataset.held !== held) place.dataset.held = held;
    // Up at the top of the screen (on a room's window) its name opens under it: over its head would be off the screen.
    const tag = frame.floorY - size.h < 28 ? 'under' : 'over';
    if (place.dataset.tag !== tag) place.dataset.tag = tag;
    const thrown = frame.thrown ?? '';
    if ((place.dataset.throw ?? '') !== thrown) place.dataset.throw = thrown;
  }
  if (body === null) return;
  const fx = frame.fx ?? null;
  // A squash or a stretch is its own frame scaled about the middle of its box, in whole steps a frame at a time: a plain
  // 2D transform, so the blocks stay hard-edged (`image-rendering: pixelated`), never a blur.
  const shape = fx === null ? '' : `matrix(${fx.a.toFixed(3)}, ${fx.b.toFixed(3)}, ${fx.c.toFixed(3)}, ${fx.d.toFixed(3)}, 0, 0)`;
  const bent = fx === null ? '' : `translate(${fx.dx}px, ${fx.dy}px) ${shape}`;
  const ghosts = place === null ? [] : [...place.querySelectorAll<HTMLElement>('[data-companion-smear]')];
  if (look === null) {
    body.style.transform = `${bent}${frame.lift === 0 ? '' : ` translateY(${frame.lift}px)`}`.trim();
    return;
  }
  // The same arithmetic as CharacterSprite.tsx, written straight to the style so a frame re-renders nothing.
  const { sheet } = look;
  const playing = sheet.motions[frame.motion];
  const count = playing.ticks.length;
  const index = playing.ticks[playing.loop ? ((frame.tick % count) + count) % count : Math.min(Math.max(0, frame.tick), count - 1)];
  const at = cellAt(sheet, index);
  const cell = `${-at.x * SCALE}px ${-at.y * SCALE}px`;
  const mirror = frame.facing < 0 && playing.facing === 'side' ? 'scaleX(-1)' : '';
  body.style.backgroundPosition = cell;
  body.style.transform = `${bent} ${mirror}`.trim();
  // The smear: copies of the very frame it is showing, back along its path, fainter the further back.
  ghosts.forEach((ghost, order) => {
    const back = fx?.ghosts[order];
    if (back === undefined) {
      if (ghost.style.visibility !== '') ghost.style.visibility = '';
      return;
    }
    ghost.style.backgroundPosition = cell;
    ghost.style.transform = `translate(${back.dx}px, ${back.dy}px) ${shape} ${mirror}`.trim();
    ghost.style.visibility = 'visible';
  });
}
