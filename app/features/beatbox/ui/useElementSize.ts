'use client';

import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/** Keeps track of how big an element is, as the window or zoom changes. */
export function useElementSize(): [RefObject<HTMLDivElement | null>, number, number] {
  const element = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const current = element.current;
    if (!current) return;
    const measure = () => setSize({ width: current.clientWidth, height: current.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(current);
    return () => observer.disconnect();
  }, []);

  return [element, size.width, size.height];
}
