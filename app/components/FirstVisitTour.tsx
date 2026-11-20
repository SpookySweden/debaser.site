'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { accountSettingsLoaded, serverAccountSettingsLoaded, subscribeToAccountSettingsLoaded } from '../lib/settings/account-settings';
import { PLATE, PLATE_MAIN } from '../lib/ui/controls';
import {
  automatedWithoutTour,
  endTour,
  readTourSaid,
  serverTourHeld,
  serverTourReplaying,
  serverTourSaid,
  stepsFor,
  subscribeToTour,
  tourHeld,
  tourOwed,
  tourReplaying,
  TOUR_STEPS,
  type TourStep,
} from '../lib/ui/first-visit-tour';
import { useAuth } from './AuthProvider';

type Box = { top: number; left: number; width: number; height: number };

/** The first visible element a step points at, or null. */
function find(target: string): Element | null {
  for (const element of document.querySelectorAll(target)) {
    const box = element.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) return element;
  }
  return null;
}

function measure(target: string): Box | null {
  const element = find(target);
  if (element === null) return null;
  const box = element.getBoundingClientRect();
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

/** How long the tour waits for the board to be drawn before it gives up for this page (it asks again next time). */
const READY_TRIES = 40;
const READY_EVERY_MS = 300;
/** The board's layout settles as posts and the sidebar load: the outline follows. */
const REMEASURE_MS = 400;
const CARD_WIDTH = 352;
const GAP = 12;
const EDGE = 8;

/**
 * FIRSTVISIT (Luke, 2026-11-20): the short tour of the desktop that replaced the full-page "HAD AN ACCOUNT?" pop-up.
 * Seven steps, each the real thing outlined on screen with a few words beside it ("entirely visual tour with text"):
 * NEXT, BACK, SKIP or Esc. Played on the board for every reader not yet toured under v2 (Luke: everyone once more), signed in
 * or not, never while a new account's PRIVACY window is open; remembered when finished or skipped (`first-visit-tour.ts`); the MODULOS window's TOUR key
 * plays it again. Instant: nothing slides or fades; under reduced motion the outline holds still. Drawn once in `layout.tsx`.
 */
export default function FirstVisitTour() {
  const said = useSyncExternalStore(subscribeToTour, readTourSaid, serverTourSaid);
  const replaying = useSyncExternalStore(subscribeToTour, tourReplaying, serverTourReplaying);
  const loaded = useSyncExternalStore(subscribeToAccountSettingsLoaded, accountSettingsLoaded, serverAccountSettingsLoaded);
  const held = useSyncExternalStore(subscribeToTour, tourHeld, serverTourHeld);
  const { status } = useAuth();
  const path = usePathname();
  const signedIn = status === 'signed-in';
  // A signed-in account waits for its own settings, so one toured on another computer is not toured again here.
  const settled = status === 'anonymous' || (signedIn && loaded);
  const owed = settled && tourOwed({ said, held, replaying, path });
  const [ready, setReady] = useState<{ steps: TourStep[]; run: number } | null>(null);

  useEffect(() => {
    // A scripted test browser is not toured unless it asks (`automatedWithoutTour`).
    if (!owed || automatedWithoutTour()) return;
    let tries = 0;
    let lastCount = -1;
    const timer = window.setInterval(() => {
      tries += 1;
      // The board first, then until the list stops growing (the music bar, the shelf and LOG IN can come a moment later).
      const steps = find(TOUR_STEPS[0].target) === null ? [] : stepsFor(signedIn, (target) => find(target) !== null);
      if (steps.length > 0 && (steps.length === lastCount || tries >= READY_TRIES)) {
        window.clearInterval(timer);
        setReady({ steps, run: Date.now() });
      } else if (tries >= READY_TRIES) window.clearInterval(timer);
      lastCount = steps.length;
    }, READY_EVERY_MS);
    return () => {
      window.clearInterval(timer);
      // Left the board (or signed in or out) mid-tour: a return starts afresh, waiting for the board again.
      setReady(null);
    };
  }, [owed, signedIn]);

  if (!owed || ready === null || ready.steps.length === 0) return null;

  return (
    <TourRun
      key={ready.run}
      steps={ready.steps}
      onEnd={(how) => {
        setReady(null);
        endTour(how);
      }}
    />
  );
}

function TourRun({ steps, onEnd }: { steps: TourStep[]; onEnd: (how: 'done' | 'skipped') => void }) {
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const [box, setBox] = useState<Box | null>(null);
  const next = useRef<HTMLButtonElement>(null);
  const last = index === steps.length - 1;

  useEffect(() => {
    const update = () => setBox(measure(step.target));
    const first = window.requestAnimationFrame(update);
    const timer = window.setInterval(update, REMEASURE_MS);
    window.addEventListener('resize', update);
    next.current?.focus();
    return () => {
      window.cancelAnimationFrame(first);
      window.clearInterval(timer);
      window.removeEventListener('resize', update);
    };
  }, [step.target]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onEnd('skipped');
        return;
      }
      // Tab stays in the card: the dimmed page waits while the tour talks, for the keyboard as for the pointer.
      if (event.key !== 'Tab') return;
      const keys = [...document.querySelectorAll<HTMLButtonElement>('[data-tour-card] button')];
      if (keys.length === 0) return;
      const at = keys.indexOf(document.activeElement as HTMLButtonElement);
      const to = at === -1 ? 0 : (at + (event.shiftKey ? keys.length - 1 : 1)) % keys.length;
      event.preventDefault();
      keys[to].focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onEnd]);

  const width = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const height = typeof window === 'undefined' ? 900 : window.innerHeight;
  const hole = box === null ? null : { top: box.top - GAP / 2, left: box.left - GAP / 2, width: box.width + GAP, height: box.height + GAP };

  // Where the card sits: under the thing when there is room, over it when not, and inside it when it fills the screen (the board).
  let card: { top?: number; bottom?: number; left: number };
  let mark: '▲' | '▼' | null = null;
  let markLeft = 0;
  if (hole === null) {
    card = { top: height / 3, left: (width - CARD_WIDTH) / 2 };
  } else {
    const left = Math.min(Math.max(hole.left, EDGE), Math.max(EDGE, width - CARD_WIDTH - EDGE));
    const room = 200;
    if (hole.height > height * 0.5) card = { top: Math.max(hole.top + GAP * 3, EDGE), left: Math.min(Math.max(hole.left + GAP * 2, EDGE), Math.max(EDGE, width - CARD_WIDTH - EDGE)) };
    else if (hole.top + hole.height + room < height) {
      card = { top: hole.top + hole.height + GAP, left };
      mark = '▲';
    } else {
      card = { bottom: height - hole.top + GAP, left };
      mark = '▼';
    }
    markLeft = Math.min(Math.max(hole.left + Math.min(hole.width, CARD_WIDTH) / 2 - card.left, GAP), CARD_WIDTH - GAP * 3);
  }

  return (
    <div className="fixed inset-0 z-overlay" data-tour-layer>
      {/* The dither round the hole; the whole layer catches presses, so the page waits while the tour talks. */}
      {hole === null ? (
        <div className="tour-scrim absolute inset-0" />
      ) : (
        <>
          <div className="tour-scrim absolute inset-x-0 top-0" style={{ height: Math.max(hole.top, 0) }} />
          <div className="tour-scrim absolute inset-x-0 bottom-0" style={{ top: hole.top + hole.height }} />
          <div className="tour-scrim absolute left-0" style={{ top: hole.top, height: hole.height, width: Math.max(hole.left, 0) }} />
          <div className="tour-scrim absolute right-0" style={{ top: hole.top, height: hole.height, left: hole.left + hole.width }} />
          <div className="tour-outline pointer-events-none absolute" style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }} data-tour-outline={step.id} />
        </>
      )}

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        className="absolute frame bg-sun-pale font-mono text-ink"
        style={{ ...card, width: CARD_WIDTH, maxWidth: `calc(100vw - ${EDGE * 2}px)` }}
        data-tour-card={step.id}
      >
        {mark === '▲' ? (
          <span aria-hidden className="absolute bottom-full text-title text-bubble" style={{ left: markLeft }}>
            ▲
          </span>
        ) : null}
        {mark === '▼' ? (
          <span aria-hidden className="absolute top-full text-title text-bubble" style={{ left: markLeft }}>
            ▼
          </span>
        ) : null}
        <div className="flex items-baseline justify-between gap-2 border-b-line border-ink px-2 py-1">
          <h2 id="tour-title" className="text-title font-bold text-accent-ink">
            {step.title}
          </h2>
          <span className="text-label text-ink">{`${index + 1}/${steps.length}`}</span>
        </div>
        <p className="px-2 pt-2 text-prose text-ink">{step.line}</p>
        <div className="flex flex-wrap items-center gap-2 p-2">
          <button ref={next} type="button" onClick={() => (last ? onEnd('done') : setIndex(index + 1))} className={`${PLATE_MAIN} min-h-tap`} data-tour-next>
            {last ? '[ DONE ]' : '[ NEXT ► ]'}
          </button>
          {index > 0 ? (
            <button type="button" onClick={() => setIndex(index - 1)} className={`${PLATE} min-h-tap`}>
              [ ◄ BACK ]
            </button>
          ) : null}
          {last ? null : (
            <button type="button" onClick={() => onEnd('skipped')} className={`${PLATE} ml-auto min-h-tap`} data-tour-skip>
              [ SKIP ]
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
