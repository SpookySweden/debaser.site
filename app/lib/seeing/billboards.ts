'use client';

/**
 * BILLBOARD (SPEC-seeing-machine.md, idea v; Luke's answer 10: "STREAM ART, always"): saved stream art where a page's advertisements were.
 * Read in the browser as the STREAM ART shelf reads it, so a hidden piece is never among them, and handed to the frame as pictures.
 */
import { getCanvasRepository } from '../watch/canvas-repository';

export type Billboard = { src: string; title: string };

const PIECES_MOST = 8;
const PICTURE_MOST = 2 * 1024 * 1024;

let held: Promise<readonly Billboard[]> | null = null;

async function asData(address: string): Promise<string | null> {
  const response = await fetch(address);
  if (!response.ok) return null;
  const blob = await response.blob();
  if (blob.size > PICTURE_MOST || !/^image\/(?:png|jpeg|webp|gif)$/.test(blob.type)) return null;
  return new Promise((done) => {
    const reader = new FileReader();
    reader.onload = () => done(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => done(null);
    reader.readAsDataURL(blob);
  });
}

async function load(): Promise<readonly Billboard[]> {
  const pieces = await getCanvasRepository().listPieces({ includeHidden: false });
  // A different few each visit, so every piece gets hung.
  const shuffled = pieces.map((piece) => ({ piece, at: Math.random() })).sort((a, b) => a.at - b.at);
  const hung = await Promise.all(
    shuffled.slice(0, PIECES_MOST).map(async ({ piece }) => {
      const address = piece.latest?.imageUrl ?? null;
      const src = address === null ? null : await asData(address).catch(() => null);
      return src === null ? null : { src, title: 'STREAM ART' };
    }),
  );
  return hung.filter((each) => each !== null);
}

/** Read once a visit; none when there is no art, or it could not be read. */
export function billboards(): Promise<readonly Billboard[]> {
  held ??= load().catch(() => []);
  return held;
}

/** The shelf, in a tab of its own, so the page being read stays. */
export function openBillboard(piece: Billboard | null): void {
  if (piece !== null) window.open('/media?art=1', '_blank', 'noopener');
}
