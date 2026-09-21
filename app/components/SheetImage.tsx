'use client';

import Image from 'next/image';
import { useState } from 'react';

type SheetImageProps = {
  src: string;
  alt: string;
  width: number;
  height: number;
  sizes?: string;
  /** Tiny notice instead of the full panel (used by small avatars). */
  compact?: boolean;
};

/**
 * Hand-drawn artwork slot.
 *
 * The art itself is dropped into the project `assets/` folder by hand (never
 * generated), so this component only handles presentation: it renders the
 * standard Next `<Image />` and, if the file is not there yet, swaps in a plain
 * text notice naming the missing path instead of a broken image icon.
 */
export default function SheetImage({ src, alt, width, height, sizes, compact = false }: SheetImageProps) {
  const [missing, setMissing] = useState(false);

  if (missing) {
    if (compact) {
      return (
        <span className="text-[9px] font-bold text-black" title={`${src} is not in the assets folder yet`}>
          [ ? ]
        </span>
      );
    }

    return (
      <div className="flex min-h-40 w-full flex-col items-center justify-center gap-1 rounded-none border-2 border-t-gray-600 border-l-gray-600 border-r-white border-b-white bg-[#f0f0f0] p-4 text-center">
        <span className="text-[10px] font-bold text-black">[ ARTWORK FILE NOT FOUND ]</span>
        <span className="text-[10px] text-black">CHECK THE PROJECT assets/ FOLDER FOR THIS SHEET</span>
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      sizes={sizes ?? '(max-width: 768px) 100vw, 50vw'}
      onError={() => setMissing(true)}
      className="h-auto w-full rounded-none"
    />
  );
}
