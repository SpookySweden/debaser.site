'use client';

import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

/** What the status line says, kept outside the page: every press says something, and that shouldn't redraw everything else. */
export interface StatusLine {
  subscribe(listener: () => void): () => void;
  get(): string;
  set(words: string): void;
}

export function createStatusLine(first: string): StatusLine {
  const listeners = new Set<() => void>();
  let words = first;
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => words,
    set(next) {
      if (next === words) return;
      words = next;
      for (const listener of listeners) listener();
    },
  };
}

/**
 * The line that says what's happening, and what a key is while it's pointed at or tabbed to, big enough to read, in the same place every
 * time. A key's own short name and shortcut are all there is to say, so a browser's little tooltip is never the only way to find out. The
 * status stays in the page for a screen reader, which speaks a key's name by itself and shouldn't hear it twice.
 */
export function HintLine({ page, line, live }: { page: RefObject<HTMLElement | null>; line: StatusLine; live: boolean }) {
  const [hint, setHint] = useState<string | null>(null);
  const status = useSyncExternalStore(line.subscribe, line.get);

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
      {/* Problems are always spoken, whatever the audio mode. */}
      <p role="alert" className="sr-only">
        {status.startsWith("Problem") ? status : ""}
      </p>
    </>
  );
}
