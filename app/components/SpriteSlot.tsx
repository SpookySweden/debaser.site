'use client';

import Image from 'next/image';
import { useState } from 'react';
import { SPRITE_SLOT } from '../lib/ui/controls';

type SpriteSlotProps = {
  /** Where the hand-drawn file will live, e.g. `/assets/sprites/walk-cycle.gif`. */
  src: string;
  alt: string;
  /** Rendered size: a sprite is drawn at its own size and never resampled (globals.css). */
  width: number;
  height: number;
  /** What the file is, when the hover needs to say more than the path does. */
  title?: string;
};

/**
 * The room a looping sprite is drawn into.
 *
 * The site draws no artwork of its own: a character, an icon or a little walking figure is a
 * hand-drawn file, and code never stands in for one (AGENTS.md, Asset Rules). So what this component
 * is, is the *space* - a dark dithered field at the exact size the sprite will be, pointed at the path
 * the file belongs at. Until the file is dropped in, the field says which one is missing on hover;
 * when it lands, it loops there and nothing else has to change.
 *
 * It is a `<span>` with a fixed size rather than a sized image, so a slot in a status bar or a taskbar
 * holds its shape (and its dither) whether or not the artwork has arrived yet - which is what keeps
 * the layout honest while the drawing is still being made.
 */
export default function SpriteSlot({ src, alt, width, height, title }: SpriteSlotProps) {
  const [missing, setMissing] = useState(false);

  return (
    <span
      className={`${SPRITE_SLOT} inline-block shrink-0 align-middle`}
      style={{ width, height }}
      title={title ?? `${src} is not in the assets folder yet`}
    >
      {missing ? null : (
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          onError={() => setMissing(true)}
          className="block h-full w-full"
        />
      )}
    </span>
  );
}
