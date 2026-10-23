'use client';

import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { WINDOW_TITLE_BAR } from '../lib/ui/controls';
import { useWindowDrag } from '../lib/ui/use-window-drag';
import {
  beginMove,
  beginResize,
  bringToFront,
  detachWindow,
  endMove,
  endResize,
  liveWindow,
  moveTo,
  registerWindow,
  resizeTo,
  subscribeToWindowLayout,
  toggleMaximise,
  windowClosed,
  windowOpened,
  type ResizeEdges,
  type WindowSize,
} from '../lib/ui/window-layout';

type DockWindowProps = {
  /** Which window this is, for the layout store and the saved layout. Stable, and unique per window. */
  id: string;
  title: string;
  /** Right-hand title bar text: a count or a state the title does not already say. */
  badge?: string;
  onClose: () => void;
  /**
   * What this window is and how to handle it: the hover tip of its title line. It used to be a status
   * line across the foot, always on screen (SPEC-efficiency.md moved every how-to sentence into a tip).
   */
  status?: string;
  /** Which of the two corners it sits in before anybody drags it. */
  dock?: 'top' | 'bottom';
  /** Its size on a desktop before anybody resizes it. */
  defaultSize: WindowSize;
  /** The least it can be resized to before its contents break. */
  minSize: WindowSize;
  children: ReactNode;
};

/** The `sm` breakpoint, read synchronously so a window never draws one frame in the wrong mode. */
const DESKTOP = '(min-width: 640px)';

function subscribeToDesktop(listener: () => void) {
  const query = window.matchMedia(DESKTOP);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

const isDesktop = () => window.matchMedia(DESKTOP).matches;
const onServer = () => false;

/** The eight grips: four edges, four corners. Each says which edges it moves and what the pointer becomes. */
const GRIPS: { edges: ResizeEdges; className: string }[] = [
  { edges: { top: true }, className: '-top-1 left-2 right-2 h-2 cursor-ns-resize' },
  { edges: { bottom: true }, className: '-bottom-1 left-2 right-2 h-2 cursor-ns-resize' },
  { edges: { left: true }, className: '-left-1 top-2 bottom-2 w-2 cursor-ew-resize' },
  { edges: { right: true }, className: '-right-1 top-2 bottom-2 w-2 cursor-ew-resize' },
  { edges: { top: true, left: true }, className: '-top-1 -left-1 h-3 w-3 cursor-nwse-resize' },
  { edges: { bottom: true, right: true }, className: '-bottom-1 -right-1 h-3 w-3 cursor-nwse-resize' },
  { edges: { top: true, right: true }, className: '-top-1 -right-1 h-3 w-3 cursor-nesw-resize' },
  { edges: { bottom: true, left: true }, className: '-bottom-1 -left-1 h-3 w-3 cursor-nesw-resize' },
];

/** Pointer capture for a press that should keep tracking off the element it started on. */
function capture(event: ReactPointerEvent<HTMLElement>) {
  event.currentTarget.setPointerCapture(event.pointerId);
}

function release(event: ReactPointerEvent<HTMLElement>) {
  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
}

/**
 * A utility window: docked beside the page, draggable, and no scrim.
 *
 * The pop-ups (`./PopoutWindow.tsx`) are dialogues - they take the screen, they close on ESC, and
 * they are right to. This is the other kind of window, the one a desktop kept open *next to* the work:
 * the music archive and the arcade are things a reader consults while standing in a thread, so this
 * frame draws no overlay at all. The feed stays visible and stays usable behind it, which is the
 * whole reason the archive is a window instead of a page.
 *
 * **On a desktop** it is a real window, run by `lib/ui/window-layout.ts`: dragged by its title bar, it
 * snaps flush to other docked windows and they become a group that moves together; any edge or corner
 * resizes it (pushing its group's neighbours along); a double-click on the title bar maximises it; and
 * where it was is saved per account and per screen shape. A shake while dragging, or the `⇲` key, takes
 * it out of its group. **On a phone** it is the bottom sheet it always was, and none of that applies.
 *
 * ESC is deliberately not wired: two of these can be open at once, and one key closing both is worse
 * than a `[ CLOSE ]` that says what it closes.
 */
export default function DockWindow({
  id,
  title,
  badge,
  onClose,
  status,
  dock = 'top',
  defaultSize,
  minSize,
  children,
}: DockWindowProps) {
  const desktop = useSyncExternalStore(subscribeToDesktop, isDesktop, onServer);
  const getLive = useCallback(() => liveWindow(id), [id]);
  const live = useSyncExternalStore(subscribeToWindowLayout, getLive, () => undefined);

  // Mounting is opening and unmounting is closing: every docked window draws nothing while it is shut.
  useEffect(() => {
    if (!desktop) return;
    registerWindow(id, { min: minSize, size: defaultSize, dock });
    windowOpened(id);
    return () => windowClosed(id);
    // The sizes are per-window constants; re-registering on every render would only churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop, id]);

  const managed = desktop && live !== undefined && live.open;
  const grouped = managed && live.grouped;

  // A phone keeps the sheet's own drag, exactly as it was before windows had layouts.
  const { offset, dragHandlers: sheetDrag } = useWindowDrag();

  const layoutHandlers = {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!managed || event.button !== 0) return;
      capture(event);
      beginMove(id, event.clientX, event.clientY);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (managed && event.currentTarget.hasPointerCapture(event.pointerId)) moveTo(event.clientX, event.clientY);
    },
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      release(event);
      endMove();
    },
    onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => {
      release(event);
      endMove();
    },
    onDoubleClick: () => {
      if (managed) toggleMaximise(id);
    },
  };

  const titleHandlers = managed ? layoutHandlers : sheetDrag;

  const style = managed
    ? { left: live.rect.x, top: live.rect.y, width: live.rect.w, height: live.rect.h, zIndex: 90 + Math.min(live.z, 8) }
    : { transform: `translate(${offset.x}px, ${offset.y}px)` };
  const corner = dock === 'bottom' ? 'sm:top-auto sm:bottom-28' : 'sm:top-16 sm:bottom-auto';
  const placement = managed
    ? 'fixed'
    : `fixed inset-x-1 bottom-20 z-dock max-h-[62vh] sm:inset-x-auto sm:right-2 sm:max-h-[78vh] ${corner} sm:w-[min(28rem,calc(100vw-1.5rem))]`;

  return (
    <aside
      aria-label={title}
      style={style}
      className={placement}
      onPointerDownCapture={managed ? () => bringToFront(id) : undefined}
      data-dock-window={id}
      data-grouped={grouped ? 'true' : undefined}
    >
      <div className={`frame bg-sun-pale flex ${managed ? 'h-full' : 'max-h-full'} flex-col`}>
        <div
          {...titleHandlers}
          className={`${WINDOW_TITLE_BAR} cursor-move touch-none select-none`}
          title={
            grouped
              ? 'GROUPED :: SHAKE WHILE DRAGGING TO DETACH, OR PRESS ⇲'
              : (status ?? 'DOCKED BESIDE THE BOARD :: DRAG THE TITLE BAR TO MOVE IT')
          }
        >
          <span className="truncate">{title}</span>
          <span className="flex items-center gap-2">
            {badge === undefined ? null : <span>{badge}</span>}
            {/* The key way out of a group, for a hand that cannot shake a mouse. Drawn only while the
                window is grouped: a key that is always there and always disabled is a key nobody can use. */}
            {grouped ? (
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onClick={() => detachWindow(id)}
                aria-label={`Detach ${title} from its group`}
                title="Detach from group"
                className="hidden cursor-pointer key px-1 py-0.75 text-label font-bold leading-none sm:inline-block"
              >
                ⇲
              </button>
            ) : null}
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onClick={onClose}
              aria-label={`Close ${title}`}
              className="cursor-pointer key px-1 py-0.75 text-label font-bold leading-none max-sm:min-h-tap max-sm:min-w-tap max-sm:text-sm"
            >
              ×
            </button>
          </span>
        </div>

        {/* No foot: its how-to line is the title line's tip, and its close key is the `×` above. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-2">{children}</div>
      </div>

      {/* The detach cue: a pink frame that blinks and is gone. Keyed by the detach count, so it plays once
          per detach and never on an ordinary render; nothing at all under reduced motion. */}
      {managed && live.flash > 0 ? (
        <div
          key={`detach-${live.flash}`}
          aria-hidden="true"
          className="pointer-events-none absolute -inset-1 hidden border-thick border-bubble motion-safe:block motion-safe:animate-detach"
        />
      ) : null}

      {/* Resize grips: always present on a desktop, outside the content, so revealing nothing and moving
          nothing. A mouse affordance - the cursor says which way - and hidden from assistive tech. */}
      {managed
        ? GRIPS.map((grip) => (
            <div
              key={grip.className}
              aria-hidden="true"
              className={`absolute touch-none ${grip.className}`}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.stopPropagation();
                capture(event);
                beginResize(id, grip.edges, event.clientX, event.clientY);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeTo(event.clientX, event.clientY);
              }}
              onPointerUp={(event) => {
                release(event);
                endResize();
              }}
              onPointerCancel={(event) => {
                release(event);
                endResize();
              }}
            />
          ))
        : null}
    </aside>
  );
}
