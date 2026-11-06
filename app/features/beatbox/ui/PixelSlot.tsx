'use client';

/* eslint-disable @next/next/no-img-element */
// Places for Luke's own pixel art. This never draws anything itself: with no art given a slot is
// empty, and `showEmpty` marks where it is with a dotted box so the art can be placed by eye.
import { useState } from "react";

export interface BeatBoxArt {
  /** Beside the Record button. */
  readonly recordLight?: string;
  /** One per channel, in channel order. */
  readonly channelIcons?: readonly string[];
  /** Beside the title of a bar with no notes. */
  readonly emptyState?: string;
}

const SLOT_SIZES = {
  light: "var(--slot-light)",
  icon: "var(--slot-icon)",
  scene: "var(--slot-scene)",
} as const;

export function PixelSlot({
  name,
  size,
  src,
  showEmpty,
}: {
  /** Which slot this is, for finding it on the page. */
  name: string;
  size: keyof typeof SLOT_SIZES;
  src?: string;
  showEmpty: boolean;
}) {
  const box = { width: SLOT_SIZES[size], height: SLOT_SIZES[size] };
  const [fileMissing, setFileMissing] = useState(false);
  if (src && !fileMissing) {
    return (
      <img
        src={src}
        alt=""
        data-art-slot={name}
        onError={() => setFileMissing(true)}
        className="flex-none [image-rendering:pixelated]"
        style={box}
      />
    );
  }
  // A file that hasn't been drawn yet keeps its space, so nothing moves on the day it arrives.
  if (src && !showEmpty) return <span aria-hidden="true" data-art-slot={name} className="block flex-none" style={box} />;
  if (!showEmpty) return null;
  return (
    <span
      aria-hidden="true"
      data-art-slot={name}
      className="block flex-none border-(length:--frame-width) border-dotted border-bb-white"
      style={box}
    />
  );
}
