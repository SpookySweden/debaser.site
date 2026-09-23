'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { STATUS_BAR, TITLE_BAR, TITLE_BAR_BUTTON } from '../lib/ui/controls';
import { useWindowDrag } from '../lib/ui/use-window-drag';

type PopoutWindowProps = {
  title: string;
  /** Optional right-hand title bar text, e.g. `[ COMPOSE ]`. */
  badge?: string;
  onClose: () => void;
  /** Status bar text, left of the buttons. */
  status?: string;
  /** Status bar controls, right of the default close button. */
  actions?: ReactNode;
  /** Tailwind max-width class for the window itself. */
  maxWidth?: string;
  /** Background class for the window body (white for reading windows). */
  bodyClassName?: string;
  children: ReactNode;
};

/**
 * The shared Win95 pop-up window shell.
 *
 * It renders through a portal into `<body>`, so a pop-up is never part of the
 * page that opened it: it cannot reflow the page, cannot be clipped by a panel,
 * and cannot be scrolled by whatever container the trigger happened to sit in.
 * The page underneath stays a read-only surface.
 *
 * ESC, a click on the desktop behind it, the `×` or `[ CLOSE ]` all dismiss it,
 * and the title bar drags.
 */
export default function PopoutWindow({
  title,
  badge,
  onClose,
  status,
  actions,
  maxWidth = 'max-w-2xl',
  bodyClassName = 'bg-sun-pale',
  children,
}: PopoutWindowProps) {
  const titleId = useId();
  const [host, setHost] = useState<HTMLElement | null>(null);
  const windowRef = useRef<HTMLDivElement | null>(null);
  const { offset, dragHandlers } = useWindowDrag();

  // The portal target is only available in the browser. The window also takes focus as it opens: a
  // dialogue nobody is standing in lets a keyboard user tab straight into the page behind it, which
  // is the page the dialogue is covering.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setHost(document.body);
      windowRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  // ESC closes the window.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (host === null) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-ink/60 p-4 sm:p-8"
      onMouseDown={onClose}
    >
      <div
        ref={windowRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        className={`mt-6 w-full ${maxWidth} rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale shadow-2xl`}
      >
        {/* Draggable title bar */}
        <div
          {...dragHandlers}
          className={`${TITLE_BAR} touch-none cursor-move select-none`}
        >
          <span id={titleId} className="truncate">
            {title}
          </span>
          <span className="flex items-center gap-2">
            {badge === undefined ? null : <span>{badge}</span>}
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={onClose}
              aria-label="Close window"
              className={TITLE_BAR_BUTTON}
            >
              ×
            </button>
          </span>
        </div>

        {/* Window body */}
        <div
          className={`max-h-[70vh] overflow-y-auto border-2 border-t-black border-l-black border-r-white border-b-white p-3 ${bodyClassName}`}
        >
          {children}
        </div>

        {/* Status bar */}
        <div className={STATUS_BAR}>
          <span>{status ?? 'ESC OR CLICK THE DESKTOP TO CLOSE :: DRAG THE TITLE BAR TO MOVE'}</span>
          <span className="flex items-center gap-2">
            {actions}
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black bg-sun-pale px-3 py-1 text-xs font-bold hover:bg-ice max-sm:min-h-11 max-sm:px-4 max-sm:py-2 max-sm:text-sm"
            >
              [ CLOSE ]
            </button>
          </span>
        </div>
      </div>
    </div>,
    host,
  );
}
