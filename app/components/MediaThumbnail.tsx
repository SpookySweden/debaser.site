'use client';

import Image from 'next/image';
import { useState } from 'react';
import type { ForumPreview } from '../lib/forum/types';

type MediaThumbnailProps = {
  media: ForumPreview;
  /** Rendered square size in pixels. */
  size?: number;
};

/**
 * Minimal image preview.
 *
 * A small square crop used on collapsed board cards and beside replies, so a
 * picture in a post is visible before the post is expanded.
 */
export default function MediaThumbnail({ media, size = 64 }: MediaThumbnailProps) {
  const [missing, setMissing] = useState(false);

  if (missing) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-none border border-gray-600 bg-[#f0f0f0] text-[10px] font-bold text-black"
        style={{ width: size, height: size }}
      >
        [ NO IMG ]
      </span>
    );
  }

  return (
    <span className="inline-block rounded-none border border-black bg-white">
      <Image
        src={media.src}
        alt={media.alt}
        width={size}
        height={size}
        sizes={`${size}px`}
        onError={() => setMissing(true)}
        className="block rounded-none object-cover"
        style={{ width: size, height: size }}
      />
    </span>
  );
}
