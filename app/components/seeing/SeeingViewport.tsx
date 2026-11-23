'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SeenDocument } from '../../lib/seeing/engine';
import { FRAME_SANDBOX, frameDocument, readFrameMessage, type FrameDress } from '../../lib/seeing/frame';
import type { Lens, ReaderLook } from '../../lib/seeing/lenses/lens';
import { subscribeToTheme, themeState } from '../../lib/ui/theme-slot';
import { themeById } from '../../lib/ui/themes';

type Props = { document: SeenDocument; lens: Lens; look: ReaderLook; onOpen: (address: string, newTab: boolean) => void };

/**
 * The frame a page is drawn in (`app/lib/seeing/frame.ts` says what it may do). Drawn anew for each page and each form of it; a change of
 * lens, theme or reader's settings only sends a new stylesheet in, so the page stays where it was scrolled to.
 */
export default function SeeingViewport({ document: page, lens, look, onOpen }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  // Made once for this drawing of the page (the caller gives each its own key), so nothing that changes later reloads it.
  const [source] = useState(() => frameDocument(lens.form === 'reading' ? (page.reading ?? '') : page.html, crypto.randomUUID(), window.location.origin));
  const [ready, setReady] = useState(false);
  const theme = themeById(useSyncExternalStore(subscribeToTheme, themeState, themeState).id);

  useEffect(() => {
    const hear = (event: MessageEvent) => {
      // From this frame's own window, and even so a stranger's words: the page in there can send anything.
      if (frame.current === null || event.source !== frame.current.contentWindow) return;
      const message = readFrameMessage(event.data);
      if (message === null) return;
      if (message.see === 'ready') setReady(true);
      else onOpen(message.address, message.newTab);
    };
    window.addEventListener('message', hear);
    return () => window.removeEventListener('message', hear);
  }, [onOpen]);

  useEffect(() => {
    if (!ready) return;
    const face = window.getComputedStyle(window.document.body).fontFamily;
    const dress: FrameDress = { see: 'dress', css: lens.css({ tokens: theme.tokens, scheme: theme.scheme, face, reader: look }) };
    // The frame has no origin to name ('null'), so '*': it carries colours and sizes, nothing private.
    frame.current?.contentWindow?.postMessage(dress, '*');
  }, [ready, lens, theme, look]);

  if (lens.form === 'reading' && page.reading === null) return <p className="p-4 text-label text-ink">NO MAIN TEXT FOUND.</p>;
  return (
    <iframe
      ref={frame}
      title={`Page: ${page.title}`}
      sandbox={FRAME_SANDBOX}
      srcDoc={source}
      referrerPolicy="no-referrer"
      // What a page with no background of its own is drawn on, whatever the theme: STANDARD wears nothing.
      className="min-w-0 flex-1 border-0 bg-ink-bar"
      data-seeing-frame
    />
  );
}
