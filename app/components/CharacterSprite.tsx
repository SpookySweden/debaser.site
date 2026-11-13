import type { MotionId } from '../lib/character/motion';
import { cellAt, type CharacterSheet } from '../lib/character/sheet';

/**
 * One frame of a baked character (`bake.ts`): a cell of its picture strip, scaled up in whole pixels with no smoothing,
 * mirrored when it faces left (only side-facing motions turn; a front-facing one is square to the viewer either way).
 *
 * Shared by the profile's character and the companion (SPEC-companion.md). It draws a picture the owner's browser
 * baked from their own hand-built character; it never draws anything itself.
 */
export default function CharacterSprite({
  stripUrl,
  sheet,
  motion,
  tick,
  dir,
  scale,
  className,
}: {
  stripUrl: string;
  sheet: CharacterSheet;
  motion: MotionId;
  /** Ticks into the motion: a looping motion wraps, a one-off holds its last frame. */
  tick: number;
  dir: 1 | -1;
  /** Screen pixels per strip pixel: a whole number, so every block is the same size. */
  scale: number;
  className?: string;
}) {
  const playing = sheet.motions[motion];
  const count = playing.ticks.length;
  const index = playing.ticks[playing.loop ? ((tick % count) + count) % count : Math.min(Math.max(0, tick), count - 1)];
  const at = cellAt(sheet, index);
  const rows = Math.ceil(sheet.cells / sheet.columns);
  const flip = dir < 0 && playing.facing === 'side';

  return (
    <div
      aria-hidden="true"
      className={className}
      style={{
        width: sheet.cell.w * scale,
        height: sheet.cell.h * scale,
        backgroundImage: `url("${stripUrl}")`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${sheet.columns * sheet.cell.w * scale}px ${rows * sheet.cell.h * scale}px`,
        backgroundPosition: `${-at.x * scale}px ${-at.y * scale}px`,
        imageRendering: 'pixelated',
        transform: flip ? 'scaleX(-1)' : undefined,
      }}
    />
  );
}
