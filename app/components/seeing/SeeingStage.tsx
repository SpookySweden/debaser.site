'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as Pointing } from 'react';
import type { FoundMedia, SeenDocument } from '../../lib/seeing/engine';
import type { Census, FrameScroll, FrameTools, Pointed } from '../../lib/seeing/frame';
import type { LensSettings } from '../../lib/seeing/lenses/lens';
import type { LensId } from '../../lib/seeing/lenses/names';
import { lensOr } from '../../lib/seeing/lenses/registry';
import SeeingViewport, { type Told } from './SeeingViewport';
import SeeingWatchers from './SeeingWatchers';
import SeeingXray from './SeeingXray';

/** LOUPE: another lens under the pointer, or the same words larger. */
export type Loupe = LensId | 2 | 3 | 4;
const LOUPE_WIDE = 300;
const LOUPE_HIGH = 190;

type Props = {
  drawing: string;
  document: SeenDocument;
  lens: LensId;
  settings: LensSettings;
  /** The lens on the right of the SEAM, or none. */
  seam: LensId | null;
  loupe: Loupe | null;
  erasing: boolean;
  erased: readonly string[];
  onErase: (selector: string) => void;
  onOpen: (address: string, newTab: boolean) => void;
  onNotice: (words: string) => void;
  onRestricted: (count: number) => void;
  onMedia: (media: readonly FoundMedia[]) => void;
  /** Told what is selected while there is somewhere to put it; null when there is not. */
  onSelect: ((text: string) => void) | null;
};

const NO_TOOLS: FrameTools = {};
const nothing = () => undefined;

/** The page, and over it a second drawing of it when there is a SEAM or a LOUPE. */
export default function SeeingStage({ drawing, document, lens, settings, seam, loupe, erasing, erased, onErase, onOpen, onNotice, onRestricted, onMedia, onSelect }: Props) {
  const front = lensOr(lens);
  const [at, setAt] = useState(50);
  const [dragging, setDragging] = useState(false);
  const [point, setPoint] = useState<Pointed | null>(null);
  const [census, setCensus] = useState<Census | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const glass = useRef<HTMLDivElement>(null);
  const moveBack = useRef<((to: FrameScroll) => void) | null>(null);
  const moveFront = useRef<((to: FrameScroll) => void) | null>(null);
  const second = seam !== null ? lensOr(seam) : loupe !== null ? (typeof loupe === 'number' ? front : lensOr(loupe)) : null;

  const selecting = onSelect !== null;
  const tools = useMemo<FrameTools>(() => ({ ...(erasing ? { erase: true as const } : {}), ...(seam !== null || loupe !== null ? { scroll: true as const } : {}), ...(loupe !== null ? { pointer: true as const } : {}), ...(selecting ? { select: true as const } : {}) }), [erasing, seam, loupe, selecting]);
  const overTools = useMemo<FrameTools>(() => (seam !== null ? { scroll: true, ...(erasing ? { erase: true as const } : {}) } : NO_TOOLS), [seam, erasing]);

  // The site's own background through the window, while GLASS is the lens.
  useEffect(() => {
    if (front.clear !== true && second?.clear !== true) return;
    const root = window.document.documentElement;
    root.dataset.seeGlass = '';
    return () => {
      delete root.dataset.seeGlass;
    };
  }, [front, second]);

  const told = useCallback(
    (message: Told) => {
      if (message.see === 'point') setPoint(message.point);
      else if (message.see === 'census') setCensus(message.census);
      else if (message.see === 'erase') onErase(message.selector);
      else if (message.see === 'media') onMedia(message.media);
      else if (message.see === 'select') onSelect?.(message.text);
      else if (message.see === 'scroll') moveFront.current?.({ see: 'scrollTo', x: message.x, y: message.y, whole: message.whole });
      else if (message.see === 'pointer' && glass.current !== null) {
        const over = glass.current;
        const by = typeof loupe === 'number' ? loupe : 1;
        over.style.visibility = 'visible';
        // Scaled about the pointer, so what is under it stays under it; the box is cut in the drawing's own measure.
        over.style.transformOrigin = `${message.x}px ${message.y}px`;
        over.style.transform = `scale(${by})`;
        const [halfWide, halfHigh] = [LOUPE_WIDE / 2 / by, LOUPE_HIGH / 2 / by];
        over.style.clipPath = `polygon(${message.x - halfWide}px ${message.y - halfHigh}px, ${message.x + halfWide}px ${message.y - halfHigh}px, ${message.x + halfWide}px ${message.y + halfHigh}px, ${message.x - halfWide}px ${message.y + halfHigh}px)`;
      }
    },
    [loupe, onErase, onMedia, onSelect],
  );
  const toldOver = useCallback(
    (message: Told) => {
      if (message.see === 'scroll') moveBack.current?.({ see: 'scrollTo', x: message.x, y: message.y, whole: message.whole });
      else if (message.see === 'erase') onErase(message.selector);
    },
    [onErase],
  );

  const drag = (event: Pointing<HTMLElement>) => {
    const box = stage.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0) return;
    setAt(Math.min(96, Math.max(4, ((event.clientX - box.left) / box.width) * 100)));
  };

  return (
    <>
      <div ref={stage} className="relative min-w-0 flex-1 overflow-hidden" data-seeing-stage>
        <div className="absolute inset-0">
          <SeeingViewport key={`${drawing}:${front.form}`} document={document} lens={front} settings={settings} tools={tools} erased={erased} scrollerRef={moveBack} onTold={told} onOpen={onOpen} onNotice={onNotice} onRestricted={onRestricted} />
        </div>
        {second !== null ? (
          <div
            ref={glass}
            className={`absolute inset-0 ${seam === null ? 'pointer-events-none invisible' : ''}`}
            style={seam === null ? undefined : { clipPath: `inset(0 0 0 ${at}%)` }}
            aria-hidden={seam === null ? true : undefined}
            data-seeing-second={seam !== null ? 'seam' : 'loupe'}
          >
            <SeeingViewport key={`${drawing}:${second.form}:second:${seam !== null ? 'seam' : 'loupe'}`} document={document} lens={second} settings={settings} tools={overTools} erased={erased} scrollerRef={moveFront} onTold={toldOver} onOpen={onOpen} onNotice={onNotice} onRestricted={nothing} />
          </div>
        ) : null}
        {seam !== null ? (
          <>
            {/* While it is dragged the frames must not take the pointer. */}
            {dragging ? <div className="absolute inset-0 z-10 cursor-col-resize" /> : null}
            <div
              role="slider"
              aria-label="Seam"
              aria-valuemin={4}
              aria-valuemax={96}
              aria-valuenow={Math.round(at)}
              tabIndex={0}
              className="absolute inset-y-0 z-20 -ml-1.5 w-3 cursor-col-resize touch-none border-x-line border-ink bg-sun focus-visible:outline-2 focus-visible:outline-bubble"
              style={{ left: `${at}%` }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragging(true);
              }}
              onPointerMove={(event) => {
                if (dragging) drag(event);
              }}
              onPointerUp={() => setDragging(false)}
              onPointerCancel={() => setDragging(false)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') setAt((each) => Math.max(4, each - 4));
                if (event.key === 'ArrowRight') setAt((each) => Math.min(96, each + 4));
              }}
              data-seeing-seam
            />
          </>
        ) : null}
      </div>
      {front.beside === 'watchers' ? <SeeingWatchers document={document} /> : front.beside === 'xray' ? <SeeingXray point={point} census={census} /> : null}
    </>
  );
}
