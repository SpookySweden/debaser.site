'use client';

import { useEffect, useRef } from 'react';
import { getEngine } from '../../lib/animate/engine';
import { attachPen } from '../../lib/animate/pointer';

const LAYER = 'absolute inset-0 h-full w-full';

/** The sheet: the four canvases (see `engine.ts`), and nothing React re-renders while the pen moves. */
export default function AnimateStage() {
  const root = useRef<HTMLDivElement>(null);
  const below = useRef<HTMLCanvasElement>(null);
  const live = useRef<HTMLCanvasElement>(null);
  const above = useRef<HTMLCanvasElement>(null);
  const ui = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (root.current === null || below.current === null || live.current === null || above.current === null || ui.current === null) return undefined;
    const engine = getEngine();
    engine.attach({ root: root.current, below: below.current, live: live.current, above: above.current, ui: ui.current });
    const detachPen = attachPen(root.current, engine);
    return () => {
      detachPen();
      engine.detach();
    };
  }, []);

  return (
    <div
      ref={root}
      role="application"
      aria-label="Drawing sheet"
      data-no-cat
      data-animate-stage
      className="relative min-h-[12rem] min-w-0 flex-1 touch-none overflow-hidden bg-chrome-dark"
    >
      <canvas ref={below} data-animate="below" className={LAYER} />
      <canvas ref={live} data-animate="live" className={`${LAYER} pointer-events-none`} />
      <canvas ref={above} data-animate="above" className={`${LAYER} pointer-events-none`} />
      <canvas ref={ui} data-animate="ui" className={`${LAYER} pointer-events-none`} />
    </div>
  );
}
