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
 * The stamp picture: a little bigger than the ring's inside (Luke, 2026-11-13), seven pixels across and centred on it, so it
 * covers the ring's own line.
 */
const PICTURE = { left: RING.left - 1, top: RING.top - 1, size: RING.size + 2 };

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
 * chosen) and it's scaled in whole pixels. The stamp picture sits inside its ring.
 *
 * Slim since 2026-11-14 (Luke: "far less bulky and more simplistic regarding the outline and text ans size of the letter
 * itself. more slim"):
 * - one screen pixel per envelope pixel unless asked otherwise (it was two, and three before 2026-11-13), so the envelope
 *   is the size of a line of text;
 * - no glow while it rests. The glow he asked for on 2026-11-11 comes back, at once, while the row it sits in is pointed
 *   at or focused (`.letter-envelope` in globals.css);
 * - a letter with no picture shows the drawing's own ring, not an empty circle laid over it.
 * It still stands in the room the two-pixel envelope had (`ROOM_H`), as empty space above and below, so every row it
 * sits in is as easy to press as it was.
 */
const ROOM_H = ENVELOPE_H * 2;
export default function LetterStamp({ letter, scale = 1 }: { letter: Pick<Letter, 'name' | 'stampUrl' | 'textColour'>; scale?: number }) {
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

  const room: CSSProperties = { height: Math.max(ROOM_H, ENVELOPE_H * scale) };
  const box: CSSProperties = { width: ENVELOPE_W * scale, height: ENVELOPE_H * scale };
  const ring: CSSProperties = { left: PICTURE.left * scale, top: PICTURE.top * scale, width: PICTURE.size * scale, height: PICTURE.size * scale };

  return (
    <span className="letter-envelope inline-flex shrink-0 items-center" style={room} data-envelope={drawn ? 'drawn' : 'waiting'}>
      <span className="relative block" style={box}>
        <canvas
          ref={canvasRef}
          width={ENVELOPE_W}
          height={ENVELOPE_H}
          aria-hidden="true"
          className={`canvas-pixels block h-full w-full ${letter.textColour ? 'name-ink' : 'text-accent-ink'}`}
          style={letter.textColour ? nameInkStyle(letter.textColour) : undefined}
        />
        {letter.stampUrl ? (
          <span className="absolute block" style={ring}>
            <StampCircle src={letter.stampUrl} className="h-full w-full" />
          </span>
        ) : null}
      </span>
    </span>
  );
}
