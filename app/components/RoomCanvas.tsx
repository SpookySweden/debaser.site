'use client';

import { useEffect, useEffectEvent, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { NAME_COLOURS, profileNameColour } from '../lib/profile/name-colours';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { artSlot } from '../lib/ui/art/slots';
import { PLATE, PLATE_MAIN, PLATE_ON_BLACK, PLATE_ON_BLACK_PRESSED } from '../lib/ui/controls';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  ERASER_SIZE,
  PEN_SIZES,
  PLACED_PICTURE_HEIGHT,
  PLACED_TEXT_MAX,
  STROKE_MAX_POINTS,
  canvasColour,
  clampPoint,
  type CanvasPoint,
  type EraseInput,
  type StrokeInput,
} from '../lib/watch/canvas';
import { setCanvasDropTarget, useCanvasDrag, type CanvasDragPayload } from '../lib/watch/canvas-drag';
import { useCanvasAsk, useRoomCanvas, type CanvasContext } from '../lib/watch/use-room-canvas';
import ArtMark from './ArtMark';
import CanvasPicture from './CanvasPicture';

/** The canvas's hand-drawn keys (app/lib/ui/art/slots.ts), shown at 16px. */
const MARK_SIZE = 16;
const markSrc = (id: string, file: string) => `/${artSlot(id)?.path ?? `assets/icons/${file}`}`;
const PEN_SRC = markSrc('mark-pen', 'pen.png');
const ERASER_SRC = markSrc('mark-eraser', 'eraser.png');
const UNDO_SRC = markSrc('mark-undo', 'undo.png');
const SAVE_SRC = markSrc('mark-save', 'save.png');
/** How often a stroke being drawn goes out on the wire. */
const SEND_EVERY_MS = 80;

type RoomCanvasProps = {
  roomId: string;
  context: CanvasContext;
  /** This viewer's screen shows the canvas. It stays mounted either way, so it keeps hearing the room. */
  visible: boolean;
};

type Tool = 'pen' | 'eraser';

/**
 * The room's shared canvas (SPEC-stream-art.md), drawn over the screen while this viewer has it on: everybody's
 * strokes as they are made, the pen in four sizes and any colour, an eraser and an undo that only touch your own,
 * SAVE, and the GIFs and chat lines dropped onto it. Anyone signed in may draw while the room is live; nobody can
 * clear it. Fills its parent (absolute), black around the 16:9 canvas.
 */
export default function RoomCanvas({ roomId, context, visible }: RoomCanvasProps) {
  const canvas = useRoomCanvas(roomId, context);
  const { view } = canvas;
  const me = context.me;
  const canDraw = me !== null && context.live;

  const { profile } = usePublicProfile(me?.id ?? null);
  const ownColour = canvasColour(profileNameColour(profile)) ?? NAME_COLOURS.find((colour) => colour.id === 'emerald')?.hex ?? '';
  const [picked, setPicked] = useState<string | null>(null);
  const colour = picked ?? ownColour;
  const [tool, setTool] = useState<Tool>('pen');
  const [size, setSize] = useState<number>(PEN_SIZES[1]);

  // The canvas is opened (or found) as soon as somebody who can draw looks at it.
  const open = useEffectEvent(() => canvas.open());
  const viewed = useEffectEvent(() => canvas.viewed());
  useEffect(() => {
    if (!visible || !canDraw) return;
    open();
    viewed();
  }, [visible, canDraw]);

  /* --- drawing ------------------------------------------------------------------------------- */

  const surface = useRef<HTMLDivElement>(null);
  /** The stroke or rub under the pointer: drawn and sent as it grows, written once the pointer lets go. */
  const stroke = useRef<{ pointerId: number; input: StrokeInput | EraseInput; sent: number; last: number } | null>(null);

  const pointAt = (event: { clientX: number; clientY: number }): CanvasPoint => {
    const box = surface.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0) return [0, 0];
    return clampPoint(((event.clientX - box.left) / box.width) * CANVAS_WIDTH, ((event.clientY - box.top) / box.height) * CANVAS_HEIGHT);
  };
  const base = () => ({ id: canvas.newInputId(), authorId: me?.id ?? '', authorLabel: me?.label ?? 'Unknown', at: new Date().toISOString() });
  const fresh = (point: CanvasPoint): StrokeInput | EraseInput =>
    tool === 'pen' ? { ...base(), kind: 'stroke', colour, size, points: [point] } : { ...base(), kind: 'erase', size: ERASER_SIZE, points: [point] };

  /** Sends what is new of the stroke or rub now; `final` writes it whole. */
  const push = (final: boolean) => {
    const held = stroke.current;
    if (held === null) return;
    if (final) canvas.draw(held.input);
    else if (held.input.points.length > held.sent) canvas.drawing(held.input, held.sent);
    held.sent = held.input.points.length;
    held.last = Date.now();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (!canDraw) {
      context.askName?.();
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    stroke.current = { pointerId: event.pointerId, input: fresh(pointAt(event)), sent: 0, last: 0 };
    push(false);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const held = stroke.current;
    if (held === null || held.pointerId !== event.pointerId) return;
    const point = pointAt(event);
    const last = held.input.points[held.input.points.length - 1];
    if (last[0] === point[0] && last[1] === point[1]) return;
    held.input = { ...held.input, points: [...held.input.points, point] };
    // A long scribble becomes several, joined end to end.
    if (held.input.points.length >= STROKE_MAX_POINTS) {
      push(true);
      held.input = held.input.kind === 'stroke' ? { ...base(), kind: 'stroke', colour: held.input.colour, size: held.input.size, points: [point] } : { ...base(), kind: 'erase', size: held.input.size, points: [point] };
      held.sent = 0;
    }
    if (Date.now() - held.last >= SEND_EVERY_MS) push(false);
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const held = stroke.current;
    if (held === null || held.pointerId !== event.pointerId) return;
    push(true);
    stroke.current = null;
  };

  /* --- dropping GIFs and chat lines ------------------------------------------------------------ */

  const drop = useEffectEvent((payload: CanvasDragPayload, clientX: number, clientY: number) => {
    if (!canDraw) return;
    const [x, y] = pointAt({ clientX, clientY });
    canvas.draw({
      ...base(),
      kind: 'place',
      place:
        payload.type === 'picture'
          ? { type: 'picture', url: payload.url, title: payload.title, x, y, h: PLACED_PICTURE_HEIGHT }
          : { type: 'text', text: payload.text.slice(0, PLACED_TEXT_MAX), colour: canvasColour(payload.colour) ?? '', x, y, writerId: payload.writerId, writerLabel: payload.writerLabel },
    });
  });
  useEffect(() => {
    const element = surface.current;
    if (!visible || !canDraw || element === null) return;
    // Pictures and chat lines on the canvas are for accounts (SPEC-guests.md).
    if (context.guest === true) return;
    setCanvasDropTarget({ element, onDrop: (payload, x, y) => drop(payload, x, y) });
    return () => setCanvasDropTarget(null);
  }, [visible, canDraw, context.guest]);

  const saved = view.saved;

  return (
    <div className={`absolute inset-0 z-10 flex flex-col bg-ink-plate ${visible ? '' : 'hidden'}`} data-room-canvas={visible ? 'shown' : 'hidden'}>
      <CanvasPicture
        source={{ kind: 'raster', raster: canvas.raster, version: view.version }}
        placements={view.placements.map((entry) => entry.place)}
        className="flex-1 p-1"
        surfaceRef={surface}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        cursor={canDraw || context.askName !== undefined ? 'crosshair' : 'default'}
        label="The room's canvas"
      />
      <CanvasSaveAsk roomId={roomId} reason="view" />
      {canDraw ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1 px-1 py-0.5 text-label text-sun" role="toolbar" aria-label="Canvas tools" data-canvas-tools>
          <button type="button" className={tool === 'pen' ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK} aria-pressed={tool === 'pen'} aria-label="Pen" title="Pen" onClick={() => setTool('pen')}>
            <ArtMark src={PEN_SRC} size={MARK_SIZE} fallback={<span>[ PEN ]</span>} />
          </button>
          {PEN_SIZES.map((option) => (
            <button
              key={option}
              type="button"
              className={tool === 'pen' && size === option ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK}
              aria-pressed={tool === 'pen' && size === option}
              aria-label={`Pen size ${option}`}
              title={`Size ${option}`}
              onClick={() => {
                setTool('pen');
                setSize(option);
              }}
            >
              {`[ ${option} ]`}
            </button>
          ))}
          <label className="inline-flex items-center" title="Colour">
            <span className="sr-only">Pen colour</span>
            <input type="color" value={colour} onChange={(event) => setPicked(canvasColour(event.target.value))} className="h-6 w-8 cursor-pointer border border-sun bg-ink-plate p-0 max-sm:h-tap" data-canvas-colour />
          </label>
          <button type="button" className={tool === 'eraser' ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK} aria-pressed={tool === 'eraser'} aria-label="Eraser: rubs out your own strokes" title="Eraser" onClick={() => setTool('eraser')}>
            <ArtMark src={ERASER_SRC} size={MARK_SIZE} fallback={<span>[ ERASER ]</span>} />
          </button>
          <button type="button" className={PLATE_ON_BLACK} aria-label="Undo your last" title="Undo" onClick={canvas.undo}>
            <ArtMark src={UNDO_SRC} size={MARK_SIZE} fallback={<span>[ UNDO ]</span>} />
          </button>
          <span className="flex-1" />
          {context.guest === true ? null : <button
            type="button"
            className={saved ? PLATE_ON_BLACK_PRESSED : PLATE_ON_BLACK}
            disabled={saved || view.saving}
            aria-pressed={saved}
            aria-label={saved ? 'Saved to the media page' : 'Save to the media page'}
            title={saved ? 'Saved' : 'Save'}
            onClick={canvas.save}
            data-canvas-save={saved ? 'saved' : 'unsaved'}
          >
            <ArtMark src={SAVE_SRC} size={MARK_SIZE} fallback={<span>{saved ? '[ SAVED ]' : view.saving ? '[ SAVING... ]' : '[ SAVE ]'}</span>} />
          </button>}
        </div>
      ) : null}
      {view.error === null || !visible ? null : (
        <p className="absolute left-1 top-1 z-20 w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar" role="alert">
          {view.error}
        </p>
      )}
      {visible ? <DragGhost /> : null}
    </div>
  );
}

/** What is being carried onto the canvas, under the pointer. */
function DragGhost() {
  const drag = useCanvasDrag();
  if (drag === null || typeof document === 'undefined') return null;
  return createPortal(
    <div className="pointer-events-none fixed z-overlay -translate-x-1/2 -translate-y-1/2" style={{ left: drag.x, top: drag.y }} data-canvas-ghost>
      {drag.payload.type === 'picture' ? (
        // eslint-disable-next-line @next/next/no-img-element -- hotlinked from GIPHY or Commons, never proxied or copied
        <img src={drag.payload.url} alt="" referrerPolicy="no-referrer" className="h-16 w-auto max-w-none border border-ink-plate" />
      ) : (
        <span className="block max-w-64 truncate bg-ink-bar px-1 text-label text-ink-plate">{drag.payload.text}</span>
      )}
    </div>,
    document.body,
  );
}

/**
 * "Save this canvas?": at a close (END STREAM, leaving) in the room, or every half hour of unsaved drawing on the
 * canvas view. One line and two keys; nothing is saved until somebody says yes.
 */
export function CanvasSaveAsk({ roomId, reason }: { roomId: string; reason: 'close' | 'view' }) {
  const { asking, saving, answer } = useCanvasAsk(roomId);
  if (asking === null || asking.reason !== reason) return null;
  if (reason === 'close') {
    // Over everything, so it is seen even when the room window is folded away (END STREAM on the music bar).
    if (typeof document === 'undefined') return null;
    return createPortal(
      <div className="fixed inset-x-0 top-1/3 z-popout mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 frame bg-sun-pale p-2 text-ink" role="alertdialog" aria-label="Save this canvas" data-canvas-ask="close">
        <span className="text-label font-bold">SAVE THIS CANVAS?</span>
        <button type="button" disabled={saving} className={PLATE_MAIN} onClick={() => answer(true)}>
          [ SAVE ]
        </button>
        <button type="button" disabled={saving} className={PLATE} onClick={() => answer(false)}>
          [ DON&apos;T SAVE ]
        </button>
      </div>,
      document.body,
    );
  }
  return (
    <div
      className="absolute inset-x-1 top-1 z-20 flex flex-wrap items-center gap-2 bg-ink-plate px-1 py-0.5 text-sun"
      role="alertdialog"
      aria-label="Save this canvas"
      data-canvas-ask={reason}
    >
      <span className="text-label font-bold">SAVE THIS CANVAS?</span>
      <button type="button" disabled={saving} className={PLATE_ON_BLACK} onClick={() => answer(true)}>
        [ SAVE ]
      </button>
      <button type="button" disabled={saving} className={PLATE_ON_BLACK} onClick={() => answer(false)}>
        [ DON&apos;T SAVE ]
      </button>
    </div>
  );
}
