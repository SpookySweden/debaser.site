'use client';

import { useEffect, useState, type RefObject } from "react";

/**
 * The line that says what's happening, and what a key is while it's pointed at or tabbed to, big enough to read, in the same place every
 * time. A key's own short name and shortcut are all there is to say, so a browser's little tooltip is never the only way to find out. The
 * status stays in the page for a screen reader, which speaks a key's name by itself and shouldn't hear it twice.
 */
export function HintLine({ page, status, live }: { page: RefObject<HTMLElement | null>; status: string; live: boolean }) {
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    const root = page.current;
    if (!root) return;
    const titleOf = (target: EventTarget | null) => (target instanceof Element ? (target.closest("[title]")?.getAttribute("title") ?? null) : null);
    function pointedAt(event: PointerEvent) {
      if (event.pointerType === "mouse") setHint(titleOf(event.target));
    }
    function pointerGone() {
      setHint(null);
    }
    function tabbedTo(event: FocusEvent) {
      if (event.target instanceof Element && event.target.matches(":focus-visible")) setHint(titleOf(event.target));
    }
    function tabbedAway() {
      setHint(null);
    }
    // Pressing a key: what it did matters more now than what it's called, and the pointer's still on it.
    function pressed() {
      setHint(null);
    }
    root.addEventListener("pointerover", pointedAt);
    root.addEventListener("pointerleave", pointerGone);
    root.addEventListener("focusin", tabbedTo);
    root.addEventListener("focusout", tabbedAway);
    root.addEventListener("pointerdown", pressed);
    root.addEventListener("keydown", pressed);
    return () => {
      root.removeEventListener("pointerdown", pressed);
      root.removeEventListener("keydown", pressed);
      root.removeEventListener("pointerover", pointedAt);
      root.removeEventListener("pointerleave", pointerGone);
      root.removeEventListener("focusin", tabbedTo);
      root.removeEventListener("focusout", tabbedAway);
    };
  }, [page]);

  return (
    <>
      <p role="status" aria-live={live ? "polite" : "off"} className={hint ? "sr-only" : "min-w-0 flex-1 truncate md:whitespace-nowrap"}>
        {status}
      </p>
      {hint && (
        <p aria-hidden="true" data-hint="" className="min-w-0 flex-1 truncate font-bold text-bb-daffodil md:whitespace-nowrap">
          {hint}
        </p>
      )}
    </>
  );
}
