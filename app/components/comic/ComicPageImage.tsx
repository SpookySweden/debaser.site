'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { pageFileUrl } from '../../lib/comic/rules';
import { COMIC_DATA_SOURCE } from '../../lib/comic/source';
import { sessionHeaders } from '../../lib/comic/upload';
import type { ComicPage } from '../../lib/comic/types';
import { SPRITE_SLOT } from '../../lib/ui/controls';

type Props = {
  page: Pick<ComicPage, 'id' | 'version' | 'readingWidth' | 'readingHeight' | 'releasedAt' | 'words'>;
  size?: 'reading' | 'zoom';
  /** What a screen reader hears when the page has no WORDS ON THIS PAGE. */
  label: string;
  className?: string;
  style?: CSSProperties;
  /** Set on the picture itself, for a box drawn over it. */
  onReady?: () => void;
};

/**
 * One comic page's picture, in a box that holds its shape before it loads (the reading copy's own size), so the column never
 * jumps as pages arrive.
 *
 *   - A released page is a plain picture from the file route: cached by the browser and by Cloudflare.
 *   - An unreleased page (only the house account ever sees one) is fetched with its session and shown from memory, never cached.
 *   - A page whose file is missing (the mock store's seeded pages) is a blank dithered sheet with its words: a tile pattern
 *     and text, never drawn art.
 */
export default function ComicPageImage({ page, size = 'reading', label, className = '', style, onReady }: Props) {
  const preview = page.releasedAt === null && COMIC_DATA_SOURCE === 'supabase';
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const src = preview ? previewUrl : pageFileUrl(page, size);
  const ratio = page.readingWidth && page.readingHeight ? `${page.readingWidth} / ${page.readingHeight}` : '2 / 3';

  useEffect(() => {
    if (!preview) return;
    let live = true;
    let made: string | null = null;
    void (async () => {
      try {
        const response = await fetch(pageFileUrl(page, size), { headers: await sessionHeaders(), cache: 'no-store' });
        if (!response.ok) throw new Error('missing');
        made = URL.createObjectURL(await response.blob());
        if (live) setPreviewUrl(made);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [preview, page, size]);

  const alt = page.words.trim().length > 0 ? page.words : label;

  return (
    <div className={`relative w-full ${className}`} style={{ aspectRatio: ratio, ...style }}>
      {failed || src === null ? (
        <div className={`${SPRITE_SLOT} absolute inset-0 flex items-center justify-center`} role="img" aria-label={alt}>
          {failed ? <span className="bg-paper px-1 text-label text-ink">{label}</span> : null}
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- the file route's own copy; the optimiser would make a third
        <img
          src={src}
          alt={alt}
          width={page.readingWidth ?? undefined}
          height={page.readingHeight ?? undefined}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={onReady}
          onError={() => setFailed(true)}
          className="absolute inset-0 block h-full w-full select-none"
        />
      )}
    </div>
  );
}
