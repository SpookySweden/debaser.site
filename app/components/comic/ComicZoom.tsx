'use client';

import { useEffect, useRef } from 'react';
import type { ComicPage } from '../../lib/comic/types';
import { PLATE, TITLE_BAR } from '../../lib/ui/controls';
import ComicPageImage from './ComicPageImage';
import { explain } from '../../lib/ui/explain';

type Props = { page: ComicPage; label: string; onClose: () => void };

/**
 * One page alone at its sharper zoom copy (SPEC-comic.md, Q17), over the whole window: dragged to pan, closed with Esc or
 * `[ CLOSE ]`. Readers never receive Luke's original.
 */
export default function ComicZoom({ page, label, onClose }: Props) {
  const area = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const closeKey = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeKey.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const zoomWidth = page.width && page.height ? Math.min(4000, page.width >= page.height ? 4000 : Math.round((4000 * page.width) / page.height)) : 2000;

  return (
    <div role="dialog" aria-modal="true" aria-label={`${label}, ZOOMED`} className="fixed inset-0 z-50 flex flex-col bg-paper">
      <div className="flex items-center gap-2 px-3 py-1">
        <h2 className={`${TITLE_BAR} flex-1`}>{label}</h2>
        <button ref={closeKey} type="button" onClick={onClose} className={PLATE} {...explain('Closes the large view and goes back to the chapter.', 'Esc does the same.')}>
          [ CLOSE ]
        </button>
      </div>
      <div
        ref={area}
        className="flex-1 cursor-grab overflow-auto active:cursor-grabbing"
        onPointerDown={(event) => {
          const box = area.current;
          if (!box) return;
          drag.current = { x: event.clientX, y: event.clientY, left: box.scrollLeft, top: box.scrollTop };
          box.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const box = area.current;
          const start = drag.current;
          if (!box || !start) return;
          box.scrollLeft = start.left - (event.clientX - start.x);
          box.scrollTop = start.top - (event.clientY - start.y);
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <ComicPageImage page={page} size="zoom" label={label} className="mx-auto" style={{ width: zoomWidth, maxWidth: 'none' }} />
      </div>
    </div>
  );
}
