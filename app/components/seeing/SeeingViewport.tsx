'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SeenDocument } from '../../lib/seeing/engine';
import { FRAME_SANDBOX, frameDocument, readFrameMessage, type FrameAnswer, type FrameArt, type FrameDress } from '../../lib/seeing/frame';
import type { Lens, ReaderLook } from '../../lib/seeing/lenses/lens';
import { reach, sealFiles } from '../../lib/seeing/server-engine';
import { billboards, openBillboard } from '../../lib/seeing/billboards';
import { subscribeToTheme, themeState } from '../../lib/ui/theme-slot';
import { themeById } from '../../lib/ui/themes';

type Props = {
  document: SeenDocument;
  lens: Lens;
  look: ReaderLook;
  onOpen: (address: string, newTab: boolean) => void;
  /** Something the page tried that isn't done here, for the status line. */
  onNotice: (words: string) => void;
  onRestricted: (count: number) => void;
};

/**
 * Pages opened from the frame in a little while: a few by themselves, more when the reader is pressing things (a press counts for some
 * seconds, so a page could otherwise send itself round and round on the strength of one), then no more.
 */
const UNPRESSED_MOST = 3;
const PRESSED_MOST = 8;
const WITHIN_MS = 20_000;
const opened: { pressed: number[]; unpressed: number[] } = { pressed: [], unpressed: [] };
function mayOpen(pressed: boolean): boolean {
  const now = Date.now();
  const own = opened[pressed ? 'pressed' : 'unpressed'];
  while (own.length > 0 && now - own[0] > WITHIN_MS) own.shift();
  if (own.length >= (pressed ? PRESSED_MOST : UNPRESSED_MOST)) return false;
  own.push(now);
  return true;
}

/** What one drawing of a page may have its scripts ask for. The server counts too. */
const ASKS_MOST = 300;

/** Whether the reader has just pressed something in the page: a press there counts here too, and leaves the frame focused, as a press on our own keys does not. */
function justPressed(frame: HTMLIFrameElement | null): boolean {
  return (window.navigator.userActivation?.isActive ?? true) && frame !== null && window.document.activeElement === frame;
}

/**
 * The frame a page is drawn in (`app/lib/seeing/frame.ts` says what it may do). Drawn anew for each page and each form of it; a change of
 * lens, theme or reader's settings only sends a new stylesheet in, so the page stays where it was scrolled to.
 */
export default function SeeingViewport({ document: page, lens, look, onOpen, onNotice, onRestricted }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  // Made once for this drawing of the page (the caller gives each its own key), so nothing that changes later reloads it.
  const [source] = useState(() => {
    const reading = lens.form === 'reading';
    return frameDocument({
      html: reading ? (page.reading ?? '') : page.html,
      address: page.address,
      nonce: window.crypto.randomUUID(),
      siteOrigin: window.location.origin,
      assets: page.assets,
      // The reading form is ours, every tag of it: nothing in it runs.
      scripts: page.scripts && !reading,
    });
  });
  const [ready, setReady] = useState(false);
  // What the page in front says is heard by one listener for as long as it is drawn: what it calls may change, what it asked for must not stop.
  const calls = useRef({ onOpen, onNotice, onRestricted });
  useEffect(() => {
    calls.current = { onOpen, onNotice, onRestricted };
  }, [onOpen, onNotice, onRestricted]);
  const theme = themeById(useSyncExternalStore(subscribeToTheme, themeState, themeState).id);

  useEffect(() => {
    const leaving = new AbortController();
    let asks = 0;
    // The page is in the frame inside the frame: the outer one is ours, has no script, and never changes.
    const inner = (): Window | null => {
      try {
        return frame.current?.contentWindow?.frames[0] ?? null;
      } catch {
        return null;
      }
    };
    // The frame has no origin to name ('null'), so '*'. What is sent is the page's own: files it asked for, and colours.
    const tell = (message: FrameAnswer | FrameArt, moved: Transferable[] = []) => {
      if (!leaving.signal.aborted) inner()?.postMessage(message, '*', moved);
    };
    const hear = (event: MessageEvent) => {
      // From the page's own window, and even so a stranger's words: whatever is in there can send anything.
      const from = inner();
      if (from === null || event.source !== from) return;
      const message = readFrameMessage(event.data);
      if (message === null) return;
      switch (message.see) {
        case 'ready':
          setReady(true);
          if (message.ads) void billboards().then((pieces) => tell({ see: 'art', pieces: pieces.map(({ src, title }) => ({ src, title })) }));
          return;
        case 'open': {
          // Nobody pressed anything: a page sending itself on. Never in a new tab, and not without end.
          const pressed = justPressed(frame.current);
          if ((message.newTab && !pressed) || !mayOpen(pressed)) calls.current.onNotice('THE PAGE TRIED TO SEND YOU ON');
          else calls.current.onOpen(message.address, message.newTab);
          return;
        }
        case 'form':
          calls.current.onNotice('FORMS THAT SEND ARE NOT SENT FROM HERE: OPEN THE SOURCE');
          return;
        case 'art':
          if (justPressed(frame.current)) void billboards().then((pieces) => openBillboard(pieces[message.index] ?? null));
          return;
        case 'restricted':
          calls.current.onRestricted(message.count);
          return;
        case 'ask':
          asks += 1;
          if (asks > ASKS_MOST || page.assets === null) {
            tell({ see: 'answer', id: message.id, ok: false });
            return;
          }
          void reach(page.address, message.address, leaving.signal)
            .catch(() => null)
            .then((answer) => {
              if (answer === null) tell({ see: 'answer', id: message.id, ok: false });
              else tell({ see: 'answer', id: message.id, ok: true, ...answer }, [answer.body]);
            });
          return;
        case 'seal':
          asks += 1;
          if (asks > ASKS_MOST || page.assets === null) {
            tell({ see: 'answer', id: message.id, ok: false });
            return;
          }
          void sealFiles(page.address, message.files, leaving.signal)
            .catch(() => null)
            .then((addresses) => tell(addresses === null ? { see: 'answer', id: message.id, ok: false } : { see: 'answer', id: message.id, ok: true, addresses }));
          return;
      }
    };
    window.addEventListener('message', hear);
    return () => {
      leaving.abort();
      window.removeEventListener('message', hear);
    };
  }, [page]);

  // A page that says it sends people on (`<meta refresh>`): as one that does it itself.
  const { refresh } = page;
  useEffect(() => {
    if (refresh === null || lens.form === 'reading') return;
    const timer = window.setTimeout(() => {
      if (mayOpen(false)) calls.current.onOpen(refresh.address, false);
      else calls.current.onNotice('THE PAGE TRIED TO SEND YOU ON');
    }, refresh.after * 1000);
    return () => window.clearTimeout(timer);
  }, [refresh, lens]);

  useEffect(() => {
    if (!ready) return;
    const face = window.getComputedStyle(window.document.body).fontFamily;
    const dress: FrameDress = { see: 'dress', css: lens.css({ tokens: theme.tokens, scheme: theme.scheme, face, reader: look }) };
    try {
      frame.current?.contentWindow?.frames[0]?.postMessage(dress, '*');
    } catch {
      // The frame went as it was being dressed.
    }
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
