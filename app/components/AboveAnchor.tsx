'use client';

import { type ReactNode, type RefObject, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A small box drawn just above an element of the player, on the top layer (`z-popout`).
 *
 * The player bar is its own layer under the docked windows (`z-50` against `z-dock`), so anything drawn
 * *inside* it - the song panel, BARR's PLAY ANYWAY question - would open underneath an open MUSIC
 * window. This draws it on the page's top layer instead, lined up with the anchor's left or right edge
 * and kept in place when the window is resized or scrolled.
 */
export default function AboveAnchor({
  anchor,
  side,
  className,
  children,
}: {
  anchor: RefObject<HTMLElement | null>;
  side: 'left' | 'right';
  className: string;
  children: ReactNode;
}) {
  const [place, setPlace] = useState<{ bottom: number; x: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const element = anchor.current;
      if (element === null) return;

      const box = element.getBoundingClientRect();
      setPlace({
        bottom: window.innerHeight - box.top + 4,
        x: Math.max(0, side === 'right' ? window.innerWidth - box.right : box.left),
      });
    };

    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);

    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [anchor, side]);

  if (place === null) return null;

  return createPortal(
    <div className={`fixed z-popout ${className}`} style={side === 'right' ? { bottom: place.bottom, right: place.x } : { bottom: place.bottom, left: place.x }}>
      {children}
    </div>,
    document.body,
  );
}
