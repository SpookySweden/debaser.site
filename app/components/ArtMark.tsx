'use client';

import Image from 'next/image';
import { useCallback, useState, type ReactNode } from 'react';

type ArtMarkProps = {
  /** The hand-drawn file's address, e.g. `/assets/icons/tv.png` (its slot in app/lib/ui/art/slots.ts). */
  src: string;
  /** The box it is shown at, in CSS pixels (the slot's `shown`): its height, and its width unless `width` says. */
  size: number;
  /** A wide mark's width (the slot's `shown`), when it is not square. */
  width?: number;
  /** What the key shows until the file has loaded: words or a symbol from the system font. */
  fallback: ReactNode;
};

/**
 * A small hand-drawn mark inside a key, the way `GoogleSignInButton` does its `[ G ]`: the stand-in and the
 * picture share one grid cell, so the key keeps the larger of the two boxes and nothing moves when the
 * drawing lands, and the picture shows only once it has loaded. Code never draws the icon itself (the asset
 * rules): a missing file leaves the stand-in in place.
 */
export default function ArtMark({ src, size, width, fallback }: ArtMarkProps) {
  const [drawn, setDrawn] = useState(false);
  // A cached file can finish before the key mounts, when no load event is left to hear.
  const markRef = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) setDrawn(true);
  }, []);

  return (
    <span aria-hidden="true" className="inline-grid place-items-center">
      <span className={`col-start-1 row-start-1 ${drawn ? 'invisible' : ''}`}>{fallback}</span>
      <Image
        src={src}
        alt=""
        width={width ?? size}
        height={size}
        // The file as drawn (k=2): the optimiser would resample it and blur it.
        unoptimized
        loading="eager"
        ref={markRef}
        onLoad={() => setDrawn(true)}
        className={`col-start-1 row-start-1 rounded-none ${drawn ? '' : 'opacity-0'}`}
      />
    </span>
  );
}
