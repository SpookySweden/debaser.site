/**
 * The pen on the stage. Pointer Events give pressure and tilt; `getCoalescedEvents` gives every point the pen made between screen updates,
 * and `getPredictedEvents` where it's about to be, which hides a little lag. Once a pen has been seen, fingers only pan and zoom, so a resting
 * palm never draws.
 */
import type { AnimateEngine } from './engine';
import { useStudio } from './store';

type Handlers = { penDown: (x: number, y: number, event: PointerEvent) => boolean; penMove?: (x: number, y: number, event: PointerEvent) => void; penUp?: (x: number, y: number, event: PointerEvent) => void; penCancel?: () => void };

/** What a tool other than a brush does with the pen (select, shift and trace, fill). Tools add themselves. */
export const toolHandlers = new Map<string, Handlers>();

type Sample = { x: number; y: number; pressure: number; tilt: number; time: number };

export function attachPen(root: HTMLElement, engine: AnimateEngine): () => void {
  let penSeen = false;
  let activePointer: number | null = null;
  let mode: 'none' | 'stroke' | 'pan' | 'tool' | 'pick' = 'none';
  let lastClient = { x: 0, y: 0 };
  let toolInUse: Handlers | null = null;
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { distance: number; x: number; y: number } | null = null;

  const box = () => root.getBoundingClientRect();

  const sampleOf = (event: PointerEvent): Sample => {
    const rect = box();
    const { x, y } = engine.toSheet(event.clientX - rect.left, event.clientY - rect.top);
    return { x, y, pressure: event.pressure, tilt: Math.max(Math.abs(event.tiltX ?? 0), Math.abs(event.tiltY ?? 0)), time: event.timeStamp };
  };

  const keysHeld = () => keys.space;

  const startPan = (event: PointerEvent) => {
    mode = 'pan';
    activePointer = event.pointerId;
    lastClient = { x: event.clientX, y: event.clientY };
    root.setPointerCapture(event.pointerId);
  };

  const finish = () => {
    mode = 'none';
    activePointer = null;
    toolInUse = null;
  };

  const onDown = (event: PointerEvent) => {
    // A press in the stage takes the keys away from whatever field had them.
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
    if (event.pointerType === 'pen') penSeen = true;

    if (event.pointerType === 'touch') {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      root.setPointerCapture(event.pointerId);
      if (touches.size === 2) {
        // A second finger: this is a pinch, and any stroke the first finger started goes.
        if (mode === 'stroke') engine.cancelStroke();
        if (mode === 'tool') toolInUse?.penCancel?.();
        finish();
        pinch = pinchOf();
        return;
      }
      if (penSeen) {
        startPan(event);
        return;
      }
    }

    if (mode !== 'none') {
      // A second button during a stroke: the right button (or the pen's barrel button) drops it.
      if (mode === 'stroke' && event.button === 2) engine.cancelStroke();
      return;
    }
    if (event.button === 1 || event.button === 2 || keysHeld() || useStudio.getState().tool === 'hand') {
      startPan(event);
      return;
    }

    const sample = sampleOf(event);
    const tool = useStudio.getState().tool;

    // The pen's own eraser end (button 5) erases, whichever tool is picked.
    const eraserEnd = event.button === 5 || (event.buttons & 32) !== 0;

    if (event.altKey || tool === 'pick') {
      const colour = engine.pickColour(sample.x, sample.y);
      if (colour !== null) useStudio.setState({ colour });
      mode = 'pick';
      activePointer = event.pointerId;
      root.setPointerCapture(event.pointerId);
      return;
    }

    const handlers = eraserEnd ? undefined : toolHandlers.get(tool);
    if (handlers !== undefined) {
      if (handlers.penDown(sample.x, sample.y, event)) {
        mode = 'tool';
        toolInUse = handlers;
        activePointer = event.pointerId;
        root.setPointerCapture(event.pointerId);
      }
      return;
    }

    const simulated = event.pointerType !== 'pen';
    if (engine.beginStroke(sample.x, sample.y, event.pressure, sample.tilt, event.timeStamp, simulated, eraserEnd ? 'eraser' : null)) {
      mode = 'stroke';
      activePointer = event.pointerId;
      root.setPointerCapture(event.pointerId);
    }
  };

  const pinchOf = () => {
    const [a, b] = [...touches.values()];
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  const onMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch' && touches.has(event.pointerId)) {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.size === 2 && pinch !== null) {
        const next = pinchOf();
        const rect = box();
        engine.panBy(next.x - pinch.x, next.y - pinch.y);
        if (pinch.distance > 0) engine.zoomAt(next.distance / pinch.distance, next.x - rect.left, next.y - rect.top);
        pinch = next;
        return;
      }
    }

    if (activePointer === event.pointerId) {
      if (mode === 'pan') {
        engine.panBy(event.clientX - lastClient.x, event.clientY - lastClient.y);
        lastClient = { x: event.clientX, y: event.clientY };
        return;
      }
      if (mode === 'pick') {
        const sample = sampleOf(event);
        const colour = engine.pickColour(sample.x, sample.y);
        if (colour !== null) useStudio.setState({ colour });
        return;
      }
      if (mode === 'tool') {
        const sample = sampleOf(event);
        toolInUse?.penMove?.(sample.x, sample.y, event);
        return;
      }
      if (mode === 'stroke') {
        if (event.button === 2) {
          engine.cancelStroke();
          finish();
          return;
        }
        const coalesced = event.getCoalescedEvents?.() ?? [];
        const points = (coalesced.length > 0 ? coalesced : [event]).map(sampleOf);
        const predicted = (event.getPredictedEvents?.() ?? []).map(sampleOf);
        engine.extendStroke(points, predicted);
        return;
      }
    }

    if (mode === 'none') {
      const rect = box();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (inside && event.pointerType !== 'touch') {
        const sample = sampleOf(event);
        engine.setHover({ x: sample.x, y: sample.y });
      }
    }
  };

  const onUp = (event: PointerEvent) => {
    if (event.pointerType === 'touch') {
      touches.delete(event.pointerId);
      if (touches.size < 2) pinch = null;
    }
    if (activePointer !== event.pointerId) return;
    if (mode === 'stroke') engine.endStroke();
    if (mode === 'tool') {
      const sample = sampleOf(event);
      toolInUse?.penUp?.(sample.x, sample.y, event);
    }
    finish();
  };

  const onCancel = (event: PointerEvent) => {
    if (event.pointerType === 'touch') {
      touches.delete(event.pointerId);
      if (touches.size < 2) pinch = null;
    }
    if (activePointer !== event.pointerId) return;
    if (mode === 'stroke') engine.cancelStroke();
    if (mode === 'tool') toolInUse?.penCancel?.();
    finish();
  };

  const onLeave = () => {
    if (mode === 'none') engine.setHover(null);
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const rect = box();
    if (event.shiftKey) {
      engine.rotateBy(event.deltaY > 0 ? 15 : -15);
      return;
    }
    engine.zoomAt(event.deltaY > 0 ? 1 / 1.15 : 1.15, event.clientX - rect.left, event.clientY - rect.top);
  };

  const noMenu = (event: Event) => event.preventDefault();

  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onCancel);
  root.addEventListener('pointerleave', onLeave);
  root.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('contextmenu', noMenu);

  return () => {
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerup', onUp);
    root.removeEventListener('pointercancel', onCancel);
    root.removeEventListener('pointerleave', onLeave);
    root.removeEventListener('wheel', onWheel);
    root.removeEventListener('contextmenu', noMenu);
  };
}

/** Keys held right now that change what the pen does. */
export const keys = { space: false };
