'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { artSlot } from '../lib/ui/art/slots';
import type { Letter } from '../lib/letters/types';
import { nameInkStyle } from './NameColourWindow';

const ENVELOPE = `/${artSlot('letter-envelope')?.path ?? 'assets/letters/envelope.png'}`;
/** Luke's envelope (2026-11-11): 21x13 pixels, with its ring's inside at 8,4, five pixels across. */
const ENVELOPE_W = 21;
const ENVELOPE_H = 13;
const RING = { left: 8, top: 4, size: 5 };

/**
 * A letter's stamp: its picture cropped to a circle (Luke, 2026-11-10: "the stamp is replaced by a circular cropped picture").
 * The one round thing letters draw, held to this wrapper so `check-surreal` can name it, as it names VANITY's faces.
 */
export function StampCircle({ src, className, children }: { src?: string; className: string; children?: ReactNode }) {
  return (
    <span className={`block overflow-hidden rounded-full border border-ink bg-paper ${className}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- a hotlinked or uploaded picture, drawn as it is
        <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" className="h-full w-full object-cover" />
      ) : null}
      {children}
    </span>
  );
}

/**
 * One letter as Luke's envelope (Luke, 2026-11-11: "use this template for the letters, give it a glow ... make the pixels
 * change colour based on the colour chosen in the letter settings. the letter stamp picture goes inside the circle in the
 * middle"). His drawing is the mask: its pixels are painted in the letter's text colour (the theme's accent ink with none
 * chosen), it glows in the same colour, and it's scaled up in whole pixels. The stamp picture sits inside its ring.
 */
export default function LetterStamp({ letter, scale = 3 }: { letter: Pick<Letter, 'name' | 'stampUrl' | 'textColour'>; scale?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drawn, setDrawn] = useState(false);

  // The pixels in the letter's colour: the colour the canvas itself is given (its `color`), read once it's on the page.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ink = canvas?.getContext('2d');
    if (!canvas || !ink) return;
    let live = true;
    const picture = new Image();
    picture.onload = () => {
      if (!live) return;
      ink.clearRect(0, 0, ENVELOPE_W, ENVELOPE_H);
      ink.globalCompositeOperation = 'source-over';
      ink.drawImage(picture, 0, 0, ENVELOPE_W, ENVELOPE_H);
      ink.globalCompositeOperation = 'source-in';
      ink.fillStyle = getComputedStyle(canvas).color;
      ink.fillRect(0, 0, ENVELOPE_W, ENVELOPE_H);
      ink.globalCompositeOperation = 'source-over';
      setDrawn(true);
    };
    picture.onerror = () => live && setDrawn(false);
    picture.src = ENVELOPE;
    return () => {
      live = false;
    };
  }, [letter.textColour]);

  const box: CSSProperties = { width: ENVELOPE_W * scale, height: ENVELOPE_H * scale };
  const glow: CSSProperties = { ...(letter.textColour ? nameInkStyle(letter.textColour) : {}), filter: `drop-shadow(0 0 ${scale}px currentColor)` };
  const ring: CSSProperties = { left: RING.left * scale, top: RING.top * scale, width: RING.size * scale, height: RING.size * scale };

  return (
    <span className="relative inline-block shrink-0" style={box} data-envelope={drawn ? 'drawn' : 'waiting'}>
      <canvas
        ref={canvasRef}
        width={ENVELOPE_W}
        height={ENVELOPE_H}
        aria-hidden="true"
        className={`canvas-pixels block h-full w-full ${letter.textColour ? 'name-ink' : 'text-accent-ink'}`}
        style={glow}
      />
      <span className="absolute block" style={ring}>
        <StampCircle src={letter.stampUrl} className="h-full w-full" />
      </span>
    </span>
  );
}
