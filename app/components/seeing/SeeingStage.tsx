'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as Pointing, type RefObject } from 'react';
import { drawingKey, strokesOn } from '../../lib/seeing/margins';
import { margins, marginsOnServer, subscribeToMargins } from '../../lib/seeing/margins-store';
import type { FoundMedia, SeenDocument } from '../../lib/seeing/engine';
import type { Census, FrameFind, FrameScroll, FrameTools, Pointed } from '../../lib/seeing/frame';
import type { LensSettings } from '../../lib/seeing/lenses/lens';
import type { LensId } from '../../lib/seeing/lenses/names';
import { lensOr } from '../../lib/seeing/lenses/registry';
import SeeingGraffiti from './SeeingGraffiti';
import SeeingViewport, { type Told } from './SeeingViewport';
import SeeingWatchers from './SeeingWatchers';
import SeeingXray from './SeeingXray';
import { isBotCheck } from '../../lib/seeing/bot-check';

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
  /** Told where the page is as it moves, while somebody is being shown it; and how it is moved to where they are. */
  onPlace: ((y: number, whole: number) => void) | null;
  moverRef: RefObject<((to: FrameScroll) => void) | null>;
  /** Passages with a note on them. */
  marks: readonly string[];
  /** How MARGINALIA brings one into sight. */
  finderRef: RefObject<((index: number) => void) | null>;
  /** The page that may be drawn on, or null; and whether it is being drawn on. */
  graffiti: string | null;
  drawn: boolean;
  /** The part the address names after its #, brought into sight once the page is drawn. */
  part?: string | null;
};

const NO_TOOLS: FrameTools = {};
/** A page with scripts of its own, and not a word, a picture, a link or a frame on it: it came out empty (a page that builds itself the machine can't follow). */
/** A page with nothing on it at all, not even a script: the site sent it so (an empty answer, a page still being made). Said, never guessed at. */
// What the census does not count but can still show something: an embed, an object, a background picture.
const DRAWN_OTHERWISE = /<(?:embed|object)|background/i;
const cameBlank = (census: Census) => Object.values(census.counts).every((count) => count === 0);
const cameOutEmpty = (census: Census) => census.counts.scripts > 0 && census.counts.words < 3 && census.counts.pictures === 0 && census.counts.links === 0 && census.counts.frames === 0;
const nothing = () => undefined;

/** The page, and over it a second drawing of it when there is a SEAM or a LOUPE. */
export default function SeeingStage({ drawing, document, lens, settings, seam, loupe, erasing, erased, onErase, onOpen, onNotice, onRestricted, onMedia, onSelect, onPlace, moverRef, marks, finderRef, graffiti, drawn, part = null }: Props) {
  const front = lensOr(lens);
  const [at, setAt] = useState(50);
  const [dragging, setDragging] = useState(false);
  const [point, setPoint] = useState<Pointed | null>(null);
  const [census, setCensus] = useState<Census | null>(null);
  const [lit, setLit] = useState<string | null>(null);
  const [reach, setReach] = useState<{ at: string; n: number } | null>(null);
  // Another row lit lets go of the last press, so pointing back at a pressed row never scrolls by itself.
  const litTo = useCallback((to: string | null) => {
    setLit(to);
    setReach((was) => (was !== null && was.at !== to ? null : was));
  }, []);
  // The address's #part is brought into sight once drawn, and left alone after the first X-RAY press.
  const [pressed, setPressed] = useState(false);
  const reachTo = useCallback((to: string) => {
    setPressed(true);
    setReach((was) => ({ at: to, n: (was?.n ?? 0) + 1 }));
  }, []);
  const stage = useRef<HTMLDivElement>(null);
  const glass = useRef<HTMLDivElement>(null);
  const moveBack = useRef<((to: FrameScroll | FrameFind) => void) | null>(null);
  const moveFront = useRef<((to: FrameScroll | FrameFind) => void) | null>(null);
  const movedByOther = useRef(0);
  const [place, setPlace] = useState({ y: 0, whole: 1 });
  const everyMargin = useSyncExternalStore(subscribeToMargins, margins, marginsOnServer);
  const board = graffiti === null ? null : drawingKey(graffiti, front.form === 'reading');
  const drawOn = board !== null && (drawn || strokesOn(everyMargin, board).length > 0);
  useEffect(() => {
    finderRef.current = (index) => moveBack.current?.({ see: 'find', index });
    moverRef.current = (to) => moveBack.current?.(to);
    return () => {
      finderRef.current = null;
      moverRef.current = null;
    };
  }, [finderRef, moverRef]);
  const second = seam !== null ? lensOr(seam) : loupe !== null ? (typeof loupe === 'number' ? front : lensOr(loupe)) : null;

  const selecting = onSelect !== null;
  const placing = onPlace !== null;
  const tools = useMemo<FrameTools>(() => ({ ...(erasing ? { erase: true as const } : {}), ...(seam !== null || loupe !== null ? { scroll: true as const } : {}), ...(loupe !== null ? { pointer: true as const } : {}), ...(selecting ? { select: true as const } : {}), ...(drawOn || placing ? { place: true as const } : {}), ...(marks.length > 0 ? { marks: [...marks] } : {}) }), [erasing, seam, loupe, selecting, drawOn, placing, marks]);
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
      else if (message.see === 'scroll') {
        setPlace({ y: message.y, whole: message.whole });
        onPlace?.(message.y, message.whole);
        // Where it is because the other drawing moved it is not news to the other.
        if (Date.now() - movedByOther.current > 250) moveFront.current?.({ see: 'scrollTo', x: message.x, y: message.y, whole: message.whole });
      } else if (message.see === 'pointer' && glass.current !== null) {
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
    [loupe, onErase, onMedia, onSelect, onPlace],
  );
  const toldOver = useCallback(
    (message: Told) => {
      if (message.see === 'scroll') movedByOther.current = Date.now();
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
          <SeeingViewport key={`${drawing}:${front.form}`} document={document} lens={front} settings={settings} tools={tools} erased={erased} lit={front.beside === 'xray' ? lit : null} bring={front.beside === 'xray' && reach !== null && reach.at === lit ? reach : part !== null && !pressed ? { at: part, n: 0 } : null} scrollerRef={moveBack} onTold={told} onOpen={onOpen} onNotice={onNotice} onRestricted={onRestricted} />
        </div>
        {board !== null && drawOn ? (
          <SeeingGraffiti
            drawing={drawn}
            where={board}
            at={place}
            onScroll={(y) => {
              setPlace({ ...place, y });
              moveBack.current?.({ see: 'scrollTo', x: 0, y, whole: place.whole });
            }}
          />
        ) : null}
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
        {isBotCheck(document) ? (
          // A site's check that a person is asking: never answered here (decision 48), said over it, with where it can be done.
          <p role="status" className="absolute inset-x-0 top-0 z-20 border-b-line border-ink bg-paper px-2 py-1 text-label text-ink" data-seeing-botcheck>
            THE SITE WANTS TO CHECK A PERSON IS ASKING. THE MACHINE NEVER ANSWERS THOSE: OWN EYE OR OPEN SOURCE, IN YOUR OWN BROWSER, CAN.
          </p>
        ) : census !== null && document.scripts && cameOutEmpty(census) ? (
          // A page that builds itself and came out with nothing: said, over the top of it, with where it can be seen.
          <p role="status" className="absolute inset-x-0 top-0 z-20 border-b-line border-ink bg-paper px-2 py-1 text-label text-ink" data-seeing-empty>
            NOTHING CAME OUT: THIS PAGE BUILDS ITSELF IN A WAY THE MACHINE CAN&apos;T FOLLOW. OWN EYE OR OPEN SOURCE SHOWS IT.
          </p>
        ) : census !== null && cameBlank(census) && !DRAWN_OTHERWISE.test(document.html) ? (
          <p role="status" className="absolute inset-x-0 top-0 z-20 border-b-line border-ink bg-paper px-2 py-1 text-label text-ink" data-seeing-empty>
            THE SITE SENT A PAGE WITH NO WORDS, PICTURES OR LINKS ON IT. OPEN SOURCE ASKS IT AGAIN IN YOUR OWN BROWSER.
          </p>
        ) : null}
        {/* The page tunes in: the busy view's dither steps off it, top to bottom, once (globals.css; nothing under reduced motion). */}
        <div aria-hidden="true" className="seeing-arrive" data-seeing-arrive />
      </div>
      {front.beside === 'watchers' ? <SeeingWatchers document={document} /> : front.beside === 'xray' ? <SeeingXray point={point} census={census} lit={lit} onLit={litTo} onReach={reachTo} /> : null}
    </>
  );
}
