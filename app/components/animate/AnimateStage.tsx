'use client';

import { useEffect, useRef } from 'react';
import { getEngine } from '../../lib/animate/engine';
import { attachPen } from '../../lib/animate/pointer';
import { useStudio } from '../../lib/animate/store';

const LAYER = 'absolute inset-0 h-full w-full';

/** The sheet: the four canvases (see `engine.ts`), and nothing React re-renders while the pen moves. */
export default function AnimateStage() {
  const root = useRef<HTMLDivElement>(null);
  const below = useRef<HTMLCanvasElement>(null);
  const live = useRef<HTMLCanvasElement>(null);
  const above = useRef<HTMLCanvasElement>(null);
  const ui = useRef<HTMLCanvasElement>(null);

  const badge = useRef<HTMLDivElement>(null);
  const smartOn = useStudio((state) => state.smartOn);
  const big = useStudio((state) => state.settings.bigBadge);

  useEffect(() => {
    const engine = getEngine();
    engine.onHoverMove = (screen) => {
      if (badge.current === null) return;
      // Beside the pen. With no pen over the sheet it waits in the corner, still saying so.
      badge.current.style.transform = screen === null ? 'translate(8px, 8px)' : `translate(${screen.x + 18}px, ${screen.y + 18}px)`;
    };
    return () => {
      engine.onHoverMove = null;
    };
  }, []);

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
      className="relative min-h-[12rem] min-w-0 flex-1 touch-none overflow-hidden bg-chrome-dark max-md:h-[60vh] max-md:flex-none"
    >
      <canvas ref={below} data-animate="below" className={LAYER} />
      <canvas ref={live} data-animate="live" className={`${LAYER} pointer-events-none`} />
      <canvas ref={above} data-animate="above" className={`${LAYER} pointer-events-none`} />
      <canvas ref={ui} data-animate="ui" className={`${LAYER} pointer-events-none`} />
      {!smartOn && (
        <div ref={badge} data-animate-badge className={`pointer-events-none absolute left-0 top-0 bg-bubble-pale px-1.5 py-0.5 text-ink-bar ${big ? 'text-title' : 'text-key'}`}>
          SMART OFF
        </div>
      )}
    </div>
  );
}
