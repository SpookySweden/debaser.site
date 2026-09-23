'use client';

import { type ReactNode } from 'react';
import { PANEL, PLATE, STATUS_BAR, WINDOW_TITLE_BAR } from '../lib/ui/controls';
import { useWindowDrag } from '../lib/ui/use-window-drag';

type DockWindowProps = {
  title: string;
  /** Right-hand title bar text, e.g. `[ MP3 ]`. */
  badge?: string;
  onClose: () => void;
  /** The one line in the status bar: what this window is, and how to get rid of it. */
  status?: string;
  /** Which of the two corners it sits in before anybody drags it. */
  dock?: 'top' | 'bottom';
  /** Tailwind width for the docked window on a wide screen. */
  widthClass?: string;
  children: ReactNode;
};

/**
 * A utility window: docked beside the page, draggable, and no scrim.
 *
 * The pop-ups (`./PopoutWindow.tsx`) are dialogues - they take the screen, they close on ESC, and
 * they are right to. This is the other kind of window, the one a desktop kept open *next to* the work:
 * the music archive and the arcade are things a reader consults while standing in a thread, so this
 * frame draws no overlay at all. The feed stays visible and stays usable behind it, which is the
 * whole reason the archive is a window instead of a page.
 *
 * It docks to the right on a wide screen and becomes a bottom sheet on a phone, where there is no
 * "beside". ESC is deliberately not wired: two of these can be open at once, and one key closing
 * both is worse than a `[ CLOSE ]` that says what it closes.
 */
export default function DockWindow({
  title,
  badge,
  onClose,
  status,
  dock = 'top',
  widthClass = 'sm:w-[min(28rem,calc(100vw-1.5rem))]',
  children,
}: DockWindowProps) {
  const { offset, dragHandlers } = useWindowDrag();

  const corner = dock === 'bottom' ? 'sm:top-auto sm:bottom-28' : 'sm:top-16 sm:bottom-auto';

  return (
    <aside
      aria-label={title}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      className={`fixed inset-x-1 bottom-20 z-[90] max-h-[62vh] sm:inset-x-auto sm:right-2 sm:max-h-[78vh] ${corner} ${widthClass}`}
    >
      <div className={`${PANEL} flex max-h-full flex-col shadow-2xl`}>
        <div {...dragHandlers} className={`${WINDOW_TITLE_BAR} cursor-move touch-none select-none`}>
          <span className="truncate">{title}</span>
          <span className="flex items-center gap-2">
            {badge === undefined ? null : <span>{badge}</span>}
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={onClose}
              aria-label={`Close ${title}`}
              className="cursor-pointer rounded-none border-t border-l border-white border-r border-b border-black bg-[#c0c0c0] px-2 py-[1px] text-[10px] font-bold leading-none text-black hover:bg-gray-300"
            >
              ×
            </button>
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">{children}</div>

        <div className={STATUS_BAR}>
          <span className="truncate">{status ?? 'DOCKED BESIDE THE BOARD :: DRAG THE TITLE BAR TO MOVE IT'}</span>
          <button type="button" onClick={onClose} className={PLATE}>
            [ CLOSE ]
          </button>
        </div>
      </div>
    </aside>
  );
}
