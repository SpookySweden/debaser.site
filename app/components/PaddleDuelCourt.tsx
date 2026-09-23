'use client';

import { useCallback, useRef } from 'react';
import {
  BALL_RADIUS,
  COURT_HEIGHT,
  COURT_WIDTH,
  PADDLE_HEIGHT,
  PADDLE_INSET,
  PADDLE_WIDTH,
  type DuelSide,
  type DuelState,
} from '../lib/games/paddle-duel';
import { PANEL_INSET } from '../lib/ui/controls';

/**
 * The court: a ball, two paddles, and the wall behind each of them.
 *
 * Everything on it is a rectangle of the site's own colours, and every position is a percentage of
 * the court's own units (`./paddle-duel.ts` works in 1000 x 600), so the same match looks the same
 * on a desktop and on a phone held either way - there is no pixel arithmetic here and nothing to
 * overflow. Rects are not artwork: this is the same chrome the whole site is built from, moved by
 * rules (AGENTS.md, Asset Rules - a screen that wanted a character would point at a drawn file).
 *
 * Aiming is by pointer: wherever the finger or mouse is on the court is where the paddle is asked to
 * be, at both ends, so one gesture serves both players' devices and no on-screen buttons are needed.
 */
export default function PaddleDuelCourt({
  state,
  mySide,
  onAim,
  scoresHidden = false,
}: {
  state: DuelState;
  mySide: DuelSide;
  /** Where this player wants their own paddle, in court units; null when they let go. */
  onAim: (y: number | null) => void;
  /** True while the other side is not here yet: the ball holds still until both are. */
  scoresHidden?: boolean;
}) {
  const field = useRef<HTMLDivElement | null>(null);

  const aim = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const box = field.current?.getBoundingClientRect();
      if (box === undefined) return;

      const y = ((event.clientY - box.top) / box.height) * COURT_HEIGHT;
      onAim(Math.min(COURT_HEIGHT, Math.max(0, y)));
    },
    [onAim],
  );

  const percent = (value: number, of: number) => `${(value / of) * 100}%`;

  const paddle = (side: DuelSide) => {
    const mine = side === mySide;
    const centre = side === 'left' ? state.leftY : state.rightY;

    return (
      <span
        aria-hidden
        className={`absolute border ${mine ? 'border-ena bg-ena' : 'border-[#800000] bg-[#800000]'}`}
        style={{
          left: side === 'left' ? `${(PADDLE_INSET / COURT_WIDTH) * 100}%` : undefined,
          right: side === 'right' ? `${(PADDLE_INSET / COURT_WIDTH) * 100}%` : undefined,
          width: `${(PADDLE_WIDTH / COURT_WIDTH) * 100}%`,
          height: `${(PADDLE_HEIGHT / COURT_HEIGHT) * 100}%`,
          top: percent(centre - PADDLE_HEIGHT / 2, COURT_HEIGHT),
        }}
      />
    );
  };

  return (
    <div className={`${PANEL_INSET} bg-[#005000] p-1`}>
      <div
        ref={field}
        onPointerMove={aim}
        onPointerDown={aim}
        onPointerLeave={() => onAim(null)}
        onPointerUp={() => onAim(null)}
        className="relative aspect-[1000/600] w-full touch-none select-none overflow-hidden bg-[#008000]"
      >
        {/* The net: one dashed line down the middle, drawn as a border rather than a picture. */}
        <span
          aria-hidden
          className="absolute top-0 h-full border-l-2 border-dashed border-white/60"
          style={{ left: '50%' }}
        />

        {/* The walls the ball comes off, drawn as a line at each end. */}
        <span aria-hidden className="absolute top-0 left-0 h-full border-l-4 border-black/40" />
        <span aria-hidden className="absolute top-0 right-0 h-full border-r-4 border-black/40" />

        {paddle('left')}
        {paddle('right')}

        <span
          aria-hidden
          className="absolute border border-black bg-black"
          style={{
            width: `${(BALL_RADIUS * 2 / COURT_WIDTH) * 100}%`,
            height: `${(BALL_RADIUS * 2 / COURT_HEIGHT) * 100}%`,
            left: percent(state.ballX - BALL_RADIUS, COURT_WIDTH),
            top: percent(state.ballY - BALL_RADIUS, COURT_HEIGHT),
          }}
        />

        {scoresHidden ? (
          <span className="absolute inset-0 flex items-center justify-center bg-sun-pale/85 px-2 text-center text-xs font-bold text-black">
            WAITING FOR THE OTHER PLAYER. THE BALL HOLDS STILL UNTIL THEY ARE HERE.
          </span>
        ) : null}

        <span className="absolute bottom-1 left-1 bg-sun-pale px-1 text-[10px] font-bold text-black">
          {state.leftScore} - {state.rightScore}
        </span>
      </div>

      <p className="mt-1 truncate text-[10px] font-bold text-white">
        {mySide === 'left' ? 'YOU ARE THE LEFT PADDLE.' : 'YOU ARE THE RIGHT PADDLE.'} DRAG ANYWHERE TO MOVE IT.
      </p>
    </div>
  );
}
