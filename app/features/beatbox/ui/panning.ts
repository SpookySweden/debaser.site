// Moving around the note grid and the bars like a canvas: hold and drag, and the view goes with the pointer.

const MOVED_ENOUGH = 3;

/** Starts a drag that moves this view. It ends itself when the button comes up. */
export function startPan(event: { readonly pointerId: number; readonly clientX: number; readonly clientY: number }, view: HTMLElement): void {
  const { pointerId, clientX: fromX, clientY: fromY } = event;
  const fromLeft = view.scrollLeft;
  const fromTop = view.scrollTop;
  let moved = false;
  view.classList.add("bb-panning");

  function move(next: PointerEvent) {
    if (next.pointerId !== pointerId) return;
    // Its button came up where this couldn't see it, as under a browser's own menu.
    if (next.buttons === 0) {
      end(next);
      return;
    }
    const across = next.clientX - fromX;
    const down = next.clientY - fromY;
    if (Math.abs(across) + Math.abs(down) >= MOVED_ENOUGH) moved = true;
    view.scrollLeft = fromLeft - across;
    view.scrollTop = fromTop - down;
  }

  function end(next: PointerEvent) {
    if (next.pointerId !== pointerId) return;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    view.classList.remove("bb-panning");
    if (!moved) return;
    // A drag with the right button ends on the browser's own menu otherwise.
    const noMenu = (menu: Event) => menu.preventDefault();
    window.addEventListener("contextmenu", noMenu, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("contextmenu", noMenu, { capture: true }), 300);
  }

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}
