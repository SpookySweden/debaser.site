'use client';

import { useEffect } from 'react';
import { initTheme } from '../lib/ui/theme-slot';

/**
 * Puts the reader's theme on the document, once, as the shell mounts.
 *
 * It draws nothing and is rendered for its effect: a theme is CSS custom properties on `<html>`, so
 * there is no markup to put on the page. It mounts as high as React allows - in `layout.tsx`, beside
 * the providers - so the write happens as early in the client's life as anything can.
 *
 * It is a component rather than a call inside the layout because `layout.tsx` is a server component
 * and this needs `document`. The first paint has already happened in the default colours by the time
 * this runs, which is a real one-frame flash for anybody on the dark theme; `theme-slot.ts` records
 * why that trade was taken rather than worked around.
 */
export default function ThemeHost() {
  useEffect(() => initTheme(), []);

  return null;
}
