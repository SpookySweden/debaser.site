'use client';

import {
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { GLYPHS } from "./keyHelp";
import { windowCloseKey } from "./looks";
import { clampPlace, type Size, type WindowName, type WindowStore } from "./windowStore";

const ARROW_STEP = 32;
const ARROWS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-ARROW_STEP, 0],
  ArrowRight: [ARROW_STEP, 0],
  ArrowUp: [0, -ARROW_STEP],
  ArrowDown: [0, ARROW_STEP],
};

// Tailwind's md, where the page has the width for windows to float over it. Below that they stack in the page and don't move.
const FLOATING = "(min-width: 48rem)";

function subscribeToFloating(listener: () => void) {
  const query = window.matchMedia(FLOATING);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

const isFloating = () => window.matchMedia(FLOATING).matches;

/**
 * A window over the page that can be moved by its title, with the mouse or the arrow keys, and that leaves the page usable
 * behind it. It stays drawn while shut, so what's inside carries on: a MIDI keyboard stays connected and a sound file goes on
 * being made.
 */
export function PopWindow({
  store,
  name,
  title,
  room,
  wide = false,
  onClose,
  children,
}: {
  store: WindowStore;
  name: WindowName;
  title: string;
  /** The space the window may move in. */
  room: Size;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const open = useSyncExternalStore(store.subscribe, () => store.isOpen(name));
  const front = useSyncExternalStore(store.subscribe, () => store.isFront(name));
  const stackedAt = useSyncExternalStore(store.subscribe, () => store.getOpen().indexOf(name));
  const wanted = useSyncExternalStore(store.subscribe, () => store.getPlace(name));
  const floating = useSyncExternalStore(subscribeToFloating, isFloating);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; fromX: number; fromY: number } | null>(null);

  useLayoutEffect(() => {
    const element = box.current;
    if (!element || !open) return;
    const measure = () => setSize({ width: element.offsetWidth, height: element.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);

  const place = clampPlace(wanted, size, room);

  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    drag.current = { pointer: event.pointerId, fromX: event.clientX - place.x, fromY: event.clientY - place.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointer !== event.pointerId) return;
    store.setPlace(name, clampPlace({ x: event.clientX - drag.current.fromX, y: event.clientY - drag.current.fromY }, size, room));
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    store.rememberPlaces();
  }

  function titleKeyDown(event: KeyboardEvent) {
    const arrow = ARROWS[event.key];
    if (!arrow || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
    event.preventDefault();
    store.setPlace(name, clampPlace({ x: place.x + arrow[0], y: place.y + arrow[1] }, size, room));
    store.rememberPlaces();
  }

  const titleWords = `min-w-0 flex-1 px-2 text-left text-bb-large font-bold wrap-anywhere uppercase`;
  const style = { "--x": `${place.x}px`, "--y": `${place.y}px`, zIndex: stackedAt + 1 } as CSSProperties;

  return (
    <div
      ref={box}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      data-window={name}
      tabIndex={-1}
      onPointerDownCapture={() => store.toFront(name)}
      onFocusCapture={() => store.toFront(name)}
      style={style}
      className={`${open ? "flex" : "hidden"} bb-field w-full flex-col bg-bb-nigrosine focus:outline-none md:pointer-events-auto md:absolute md:top-(--y) md:left-(--x) md:max-h-full md:max-w-full ${wide ? "md:w-[40rem]" : "md:w-[30rem]"}`}
    >
      <div className={`flex flex-none items-stretch text-bb-black ${front ? "bg-bb-daffodil" : "bg-bb-white"}`}>
        <h2 className="flex min-w-0 flex-1">
          {floating ? (
            <button
              type="button"
              aria-label={`Move the ${title} window: drag it, or use the arrow keys`}
              title="Drag to move, or use the arrow keys"
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={titleKeyDown}
              className={`${titleWords} cursor-move touch-none select-none focus:outline-(length:--focus-width) focus:outline-bb-pink`}
            >
              {title}
            </button>
          ) : (
            <span className={`${titleWords} flex items-center`}>{title}</span>
          )}
        </h2>
        <button type="button" aria-label={`Close ${title}`} title="Close (Esc)" onClick={onClose} className={windowCloseKey}>
          {GLYPHS.close}
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-start gap-bb-gap p-bb-gutter md:overflow-y-auto">{children}</div>
    </div>
  );
}
