'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEventHandler, type Ref } from 'react';
import { CANVAS_HEIGHT, CANVAS_WIDTH, type CanvasRaster, type Placement } from '../lib/watch/canvas';

export type CanvasPictureSource =
  /** The live pixels: drawn again whenever `version` changes. */
  | { kind: 'raster'; raster: () => CanvasRaster; version: number }
  /** A saved snapshot's picture (null while its address is being read). */
  | { kind: 'image'; url: string | null };

type CanvasPictureProps = {
  source: CanvasPictureSource;
  placements: readonly Placement[];
  /** The outer box; the picture keeps 16:9 inside it, as large as fits. */
  className?: string;
  /** The drawing surface's own handlers (the room's canvas), and its element (the drop target). */
  surfaceRef?: Ref<HTMLDivElement>;
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
  onPointerMove?: PointerEventHandler<HTMLDivElement>;
  onPointerUp?: PointerEventHandler<HTMLDivElement>;
  onPointerCancel?: PointerEventHandler<HTMLDivElement>;
  cursor?: 'crosshair' | 'default';
  label?: string;
};

/**
 * A room canvas as a picture (SPEC-stream-art.md): its 480 x 270 pixels scaled up with hard edges, and the placed
 * GIFs and lines of text laid over it at the same scale. GIFs are hotlinked from GIPHY / Commons and drawn live,
 * never baked into a picture; one the platform has taken down simply leaves a gap. The room, the archive's pieces,
 * their snapshots and the replay all draw through this.
 */
export default function CanvasPicture({ source, placements, className, surfaceRef, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, cursor = 'default', label }: CanvasPictureProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ width: 0, height: 0 });

  // As large as fits the box, at 16:9.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (box === null) return;
    const measure = () => {
      const width = box.clientWidth;
      const height = box.clientHeight;
      const byWidth = { width, height: (width * CANVAS_HEIGHT) / CANVAS_WIDTH };
      setFit(height > 0 && byWidth.height > height ? { width: (height * CANVAS_WIDTH) / CANVAS_HEIGHT, height } : byWidth);
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(box);
    return () => watch.disconnect();
  }, []);

  const pixelsRef = useRef<HTMLCanvasElement>(null);
  const raster = source.kind === 'raster' ? source.raster : null;
  const version = source.kind === 'raster' ? source.version : 0;
  useEffect(() => {
    const element = pixelsRef.current;
    if (element === null || raster === null) return;
    const context = element.getContext('2d');
    if (context === null) return;
    context.putImageData(new ImageData(new Uint8ClampedArray(raster().rgba), CANVAS_WIDTH, CANVAS_HEIGHT), 0, 0);
  }, [raster, version]);

  const scale = fit.width / CANVAS_WIDTH;

  return (
    <div ref={boxRef} className={`flex min-h-0 min-w-0 items-center justify-center overflow-hidden ${className ?? ''}`}>
      <div
        ref={surfaceRef}
        role={label === undefined ? undefined : 'img'}
        aria-label={label}
        className={`relative shrink-0 touch-none overflow-hidden bg-ink-bar select-none ${cursor === 'crosshair' ? 'cursor-crosshair' : ''}`}
        style={{ width: fit.width, height: fit.height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        data-canvas-surface
      >
        {source.kind === 'raster' ? (
          <canvas ref={pixelsRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} className="canvas-pixels absolute inset-0 h-full w-full" />
        ) : source.url !== null ? (
          // eslint-disable-next-line @next/next/no-img-element -- a snapshot the site holds, shown at its own pixels scaled up
          <img src={source.url} alt="" draggable={false} className="absolute inset-0 h-full w-full" />
        ) : null}
        {/* The placements, laid out at the canvas's own size and scaled with it. */}
        <div className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, transform: `scale(${scale})` }}>
          {placements.map((place, index) => (
            <PlacedThing key={`${index}-${place.type}-${place.x}-${place.y}`} place={place} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PlacedThing({ place }: { place: Placement }) {
  const [gone, setGone] = useState(false);
  if (place.type === 'picture') {
    if (gone) return null;
    return (
      // eslint-disable-next-line @next/next/no-img-element -- hotlinked from GIPHY or Commons, never proxied or copied
      <img
        src={place.url}
        alt={place.title}
        title={place.title}
        draggable={false}
        referrerPolicy="no-referrer"
        onError={() => setGone(true)}
        className="absolute max-w-none -translate-x-1/2 -translate-y-1/2"
        style={{ left: place.x, top: place.y, height: place.h }}
        data-canvas-placed="picture"
      />
    );
  }
  // The writer's name colour as they picked it: the canvas is white paper in every theme, so never the dark shade.
  const ink = place.colour.length > 0 ? ({ '--name-ink': place.colour, '--name-ink-dark': place.colour } as CSSProperties) : undefined;
  return (
    <span
      className={`absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-label ${ink === undefined ? 'text-ink-plate' : 'name-ink'}`}
      style={{ left: place.x, top: place.y, ...ink }}
      title={place.writerLabel}
      data-canvas-placed="text"
    >
      {place.text}
    </span>
  );
}
