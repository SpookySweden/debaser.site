'use client';

import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/** Keeps track of how wide an element is, as the window or zoom changes. */
export function useElementWidth(): [RefObject<HTMLDivElement | null>, number] {
  const element = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const current = element.current;
    if (!current) return;
    const measure = () => setWidth(current.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(current);
    return () => observer.disconnect();
  }, []);

  return [element, width];
}
