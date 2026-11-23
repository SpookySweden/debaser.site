'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as Pointing } from 'react';
import { GRAFFITI_INKS, POINTS_A_STROKE, strokesOn, withStrokes, type GraffitiInk, type Stroke } from '../../lib/seeing/margins';
import { changeMargins, margins, marginsOnServer, subscribeToMargins } from '../../lib/seeing/margins-store';
import { PLATE, PLATE_PRESSED } from '../../lib/ui/controls';
import { subscribeToTheme, themeState } from '../../lib/ui/theme-slot';
import { themeById } from '../../lib/ui/themes';

const WIDE = 5;
const INK_WORDS: Record<GraffitiInk, string> = { bubble: 'ROSE', sun: 'SUN', 'ink-bar': 'WHITE' };

/** GRAFFITI: drawing over the page, which stays where it was drawn as the page moves under it. */
export default function SeeingGraffiti({ drawing, where, at, onScroll }: { drawing: boolean; where: string; at: { y: number; whole: number }; onScroll: (y: number) => void }) {
  const all = useSyncExternalStore(subscribeToMargins, margins, marginsOnServer);
  const strokes = strokesOn(all, where);
  const [ink, setInk] = useState<GraffitiInk>('bubble');
  const [live, setLive] = useState<Stroke | null>(null);
  const [clearing, setClearing] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const themeId = useSyncExternalStore(subscribeToTheme, themeState, themeState).id;

  useEffect(() => {
    const draw = () => {
      const board = canvas.current;
      const pen = board?.getContext('2d') ?? null;
      const room = board?.parentElement;
      if (board === null || pen === null || !room) return;
      const [wide, high] = [room.clientWidth, room.clientHeight];
      if (board.width !== wide) board.width = wide;
      if (board.height !== high) board.height = high;
      pen.clearRect(0, 0, wide, high);
      const tokens = themeById(themeId).tokens;
      pen.lineWidth = WIDE;
      pen.lineCap = 'round';
      pen.lineJoin = 'round';
      for (const stroke of live === null ? strokes : [...strokes, live]) {
        pen.strokeStyle = tokens[stroke.ink];
        pen.beginPath();
        for (let i = 0; i < stroke.points.length; i += 2) pen.lineTo((stroke.points[i] / 1000) * wide, stroke.points[i + 1] - at.y);
        // A press with no drag is a dot.
        if (stroke.points.length === 2) pen.lineTo((stroke.points[0] / 1000) * wide + 0.1, stroke.points[1] - at.y);
        pen.stroke();
      }
    };
    draw();
    const watch = new ResizeObserver(draw);
    if (canvas.current?.parentElement) watch.observe(canvas.current.parentElement);
    return () => watch.disconnect();
  }, [strokes, live, at, themeId]);

  const point = (event: Pointing<HTMLCanvasElement>): [number, number] => {
    const box = event.currentTarget.getBoundingClientRect();
    return [Math.round(((event.clientX - box.left) / Math.max(1, box.width)) * 1000), Math.round(event.clientY - box.top + at.y)];
  };
  const end = () => {
    if (live !== null) changeMargins((each) => withStrokes(each, where, [...strokesOn(each, where), live]));
    setLive(null);
  };

  return (
    <div className={`absolute inset-0 z-10 overflow-hidden ${drawing ? '' : 'pointer-events-none'}`} data-seeing-graffiti={strokes.length}>
      <canvas
        ref={canvas}
        aria-label="Graffiti"
        className={`absolute inset-0 ${drawing ? 'cursor-crosshair touch-none' : ''}`}
        onPointerDown={(event) => {
          if (!drawing || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setLive({ ink, points: point(event) });
        }}
        onPointerMove={(event) => {
          if (live === null) return;
          if (live.points.length >= POINTS_A_STROKE * 2) end();
          else setLive({ ...live, points: [...live.points, ...point(event)] });
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onWheel={(event) => onScroll(Math.min(at.whole, Math.max(0, at.y + event.deltaY)))}
      />
      {drawing ? (
        <p className="absolute top-1 right-1 flex flex-wrap gap-1 bg-paper p-1">
          {GRAFFITI_INKS.map((each) => (
            <button key={each} type="button" aria-pressed={ink === each} onClick={() => setInk(each)} className={ink === each ? `${PLATE_PRESSED} cursor-pointer` : PLATE}>
              {INK_WORDS[each]}
            </button>
          ))}
          <button type="button" disabled={strokes.length === 0} onClick={() => changeMargins((each) => withStrokes(each, where, strokes.slice(0, -1)))} className={PLATE}>
            [ UNDO ]
          </button>
          <button
            type="button"
            disabled={strokes.length === 0}
            onBlur={() => setClearing(false)}
            onClick={() => {
              if (clearing) changeMargins((each) => withStrokes(each, where, []));
              setClearing(!clearing);
            }}
            className={PLATE}
          >
            {clearing ? '[ CLEAR IT? ]' : '[ CLEAR ]'}
          </button>
        </p>
      ) : null}
    </div>
  );
}
