'use client';

import type { Editor } from '@tiptap/react';
import { useEffect, useState, type RefObject } from 'react';
import { placeAt, positionOf } from '../lib/docs/anchors';
import { pointerOpacity } from '../lib/docs/rules';
import type { DocPeer, DocPointer, DocSession } from '../lib/docs/session';
import DocFace from './DocFace';

type DocPointersProps = {
  editor: Editor | null;
  session: DocSession | null;
  peers: DocPeer[];
  /** The box the pointers are drawn over: the document's own frame, `position: relative`. */
  frame: RefObject<HTMLDivElement | null>;
  /** Whether this tab sends its own pointer (editors only; readers watch). */
  sends: boolean;
};

/** How often the pointers are placed again: for the stepped fade, and for text that has moved under them. */
const REDRAW_MS = 350;

type Heard = Map<number, { pointer: DocPointer; at: number }>;
type Drawn = {
  clientId: number;
  peer: DocPeer;
  left: number;
  top: number;
  opacity: number;
};

/**
 * Everyone's mouse pointer over the document, each wearing its owner's face.
 *
 * A pointer is sent as a place in the text (a Yjs relative position) plus a few pixels' offset from it,
 * and placed here at wherever that character now sits on this screen: so two window sizes agree, and a
 * pointer stays on the word it was over while the text reflows. It jumps between positions with no
 * smoothing (the site's no-easing rule), fades in three steps after 10 seconds still, and goes when its
 * owner leaves.
 */
export default function DocPointers({ editor, session, peers, frame, sends }: DocPointersProps) {
  const [heard, setHeard] = useState<Heard>(() => new Map());
  const [now, setNow] = useState(() => Date.now());
  const [drawn, setDrawn] = useState<Drawn[]>([]);

  // What arrives.
  useEffect(() => {
    if (session === null) return;
    return session.onPointer((from, pointer) => {
      setHeard((previous) => {
        const next = new Map(previous);
        if (pointer === null) next.delete(from);
        else next.set(from, { pointer, at: Date.now() });
        return next;
      });
      setNow(Date.now());
    });
  }, [session]);

  // The stepped fade, and text that has moved.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), REDRAW_MS);
    return () => window.clearInterval(timer);
  }, []);

  // Where each pointer sits on this screen now.
  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      const box = frame.current;
      if (editor === null || editor.isDestroyed || box === null) {
        setDrawn([]);
        return;
      }

      const area = box.getBoundingClientRect();
      const next: Drawn[] = [];

      for (const [clientId, entry] of heard) {
        const peer = peers.find((candidate) => candidate.clientId === clientId && !candidate.self);
        if (peer === undefined) continue;

        const opacity = pointerOpacity(now - entry.at);
        if (opacity === 0) continue;

        const position = positionOf(editor, entry.pointer.at);
        if (position === null) continue;

        let spot: { left: number; top: number };
        try {
          spot = editor.view.coordsAtPos(position);
        } catch {
          continue;
        }

        next.push({
          clientId,
          peer,
          left: Math.min(Math.max(spot.left - area.left + entry.pointer.dx, 0), Math.max(area.width - 8, 0)),
          top: Math.min(Math.max(spot.top - area.top + entry.pointer.dy, 0), Math.max(area.height - 8, 0)),
          opacity,
        });
      }

      setDrawn(next);
    });
    return () => cancelAnimationFrame(frameId);
  }, [editor, frame, heard, now, peers]);

  // What this tab sends: only while the mouse moves over the document, and once more when it leaves.
  useEffect(() => {
    const box = frame.current;
    if (editor === null || session === null || box === null || !sends) return;

    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || editor.isDestroyed) return;

      const view = editor.view;
      const area = view.dom.getBoundingClientRect();
      const left = Math.min(Math.max(event.clientX, area.left + 1), area.right - 1);
      const top = Math.min(Math.max(event.clientY, area.top + 1), area.bottom - 1);
      const hit = view.posAtCoords({ left, top });
      if (hit === null) return;

      const at = placeAt(editor, hit.pos);
      if (at === null) return;

      const spot = view.coordsAtPos(hit.pos);
      session.sendPointer({
        at,
        dx: Math.round(event.clientX - spot.left),
        dy: Math.round(event.clientY - spot.top),
      });
    };
    const leave = () => session.sendPointer(null);

    box.addEventListener('pointermove', move);
    box.addEventListener('pointerleave', leave);
    return () => {
      box.removeEventListener('pointermove', move);
      box.removeEventListener('pointerleave', leave);
    };
  }, [editor, frame, sends, session]);

  return (
    <div className="doc-pointers" aria-hidden="true">
      {drawn.map((entry) => (
        <div
          key={entry.clientId}
          className="doc-pointer"
          data-pointer-of={entry.peer.name}
          style={{ left: entry.left, top: entry.top, opacity: entry.opacity }}
        >
          <span className="doc-pointer__arrow" style={{ color: entry.peer.colour }}>
            ↖
          </span>
          <DocFace name={entry.peer.name} colour={entry.peer.colour} userId={entry.peer.userId} />
        </div>
      ))}
    </div>
  );
}
