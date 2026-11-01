'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

type SheetImageProps = {
  src: string;
  alt: string;
  width: number;
  height: number;
  sizes?: string;
  /** Tiny notice instead of the full panel (used by small avatars). */
  compact?: boolean;
  /**
   * Fill a square box instead of taking the picture's own height: 'cover' cuts the picture to the
   * box at `position` (CSS object-position), 'contain' fits all of it with blank bars. Unset keeps
   * the picture's own shape. Profile pictures use it (./ProfileAvatar.tsx).
   */
  fit?: { mode: 'cover' | 'contain'; position?: string };
};

/**
 * Hand-drawn artwork slot.
 *
 * The art itself is dropped into the project `assets/` folder by hand (never
 * generated), so this component only handles presentation: it renders the
 * standard Next `<Image />` and, if the file is not there yet, swaps in a plain
 * text notice naming the missing path instead of a broken image icon.
 */
export default function SheetImage({ src, alt, width, height, sizes, compact = false, fit }: SheetImageProps) {
  const [missing, setMissing] = useState(false);
  /**
   * Width over height, once the file has loaded. A covered wide picture is drawn wider than its box,
   * so the file fetched for it has to be that much wider too or the crop comes out blurred.
   */
  const [ratio, setRatio] = useState(1);
  const image = useRef<HTMLImageElement>(null);
  const fitMode = fit?.mode;

  // A file that arrived before the page came alive never fires `onLoad`, so read it here as well.
  useEffect(() => {
    const node = image.current;
    if (fitMode === undefined || node === null || !node.complete || node.naturalHeight === 0) return;
    const measured = node.naturalWidth / node.naturalHeight;
    const frame = window.requestAnimationFrame(() => setRatio(measured));
    return () => window.cancelAnimationFrame(frame);
  }, [fitMode, src]);

  if (missing) {
    if (compact) {
      return (
        <span className="whitespace-nowrap text-label text-ink" title={`${src} is not in the assets folder yet`}>
          [ ? ]
        </span>
      );
    }

    return (
      <div className="flex min-h-40 w-full flex-col items-center justify-center gap-1 frame bg-ice-pale p-4 text-center">
        <span className="text-label font-bold text-ink">[ ARTWORK FILE NOT FOUND ]</span>
        <span className="text-label text-ink">CHECK THE PROJECT assets/ FOLDER FOR THIS SHEET</span>
      </div>
    );
  }

  return (
    <Image
      ref={image}
      src={src}
      alt={alt}
      width={width}
      height={height}
      sizes={fit?.mode === 'cover' && ratio > 1 ? `${Math.ceil(width * ratio)}px` : (sizes ?? '(max-width: 768px) 100vw, 50vw')}
      onError={() => setMissing(true)}
      onLoad={(event) => {
        const image = event.currentTarget;
        if (fit !== undefined && image.naturalHeight > 0) setRatio(image.naturalWidth / image.naturalHeight);
      }}
      className={
        fit === undefined
          ? 'h-auto w-full rounded-none'
          : `h-full w-full rounded-none ${fit.mode === 'cover' ? 'object-cover' : 'object-contain'}`
      }
      style={fit?.position === undefined ? undefined : { objectPosition: fit.position }}
    />
  );
}
