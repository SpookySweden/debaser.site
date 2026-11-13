'use client';

import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';

/**
 * Colourful music notes trailing up from a character while it dances (Luke, 2026-11-13): the profile's character and the
 * companion. Text characters (♪ ♫ ♬), not drawings, each in one of the marker colours, rising and drifting off to one side
 * in stepped frames. Placed over the character's head by its parent; nothing here takes a click or moves anything.
 * Under reduced motion there are none.
 *
 * `active` says it is dancing. A parent that doesn't re-render as it moves (the companion) passes `watch` instead: the
 * element whose `data-mood` reads `dance` while it dances.
 */

const GLYPHS = ['♪', '♫', '♬'] as const;
const COLOURS = ['text-mark-yellow', 'text-mark-pink', 'text-mark-green', 'text-mark-blue', 'text-mark-red'] as const;
/** A new note this often while dancing, and how long each lives (the animation's own length). */
const EVERY_MS = 380;
const LIFE_MS = 1600;

type Note = { id: number; glyph: string; colour: string; side: 'left' | 'right' };

const REDUCED = '(prefers-reduced-motion: reduce)';
function subscribeReduced(change: () => void): () => void {
  const query = window.matchMedia(REDUCED);
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
}
const reducedNow = () => window.matchMedia(REDUCED).matches;
const reducedOnServer = () => true;

/** Whether `watch`'s `data-mood` says it is dancing, followed as it changes. */
function useDancingMood(watch: RefObject<HTMLElement | null> | undefined): boolean {
  // A fresh subscription on each render of the trail, which is only when its notes change: cheap, and always on the element
  // the ref holds now.
  const subscribe = (change: () => void) => {
    const element = watch?.current;
    if (!element) return () => undefined;
    const observer = new MutationObserver(change);
    observer.observe(element, { attributes: true, attributeFilter: ['data-mood'] });
    return () => observer.disconnect();
  };
  return useSyncExternalStore(
    subscribe,
    () => watch?.current?.dataset.mood === 'dance',
    () => false,
  );
}

export default function NoteTrail({ active, watch }: { active?: boolean; watch?: RefObject<HTMLElement | null> }) {
  const reduced = useSyncExternalStore(subscribeReduced, reducedNow, reducedOnServer);
  const watched = useDancingMood(watch);
  const on = !reduced && (active ?? watched);
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    if (!on) return;
    let next = 0;
    const add = () => {
      const id = next;
      next += 1;
      const note: Note = {
        id,
        glyph: GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
        colour: COLOURS[Math.floor(Math.random() * COLOURS.length)],
        side: id % 2 === 0 ? 'left' : 'right',
      };
      setNotes((now) => [...now, note]);
      // Each note goes once its animation ends, even after the dancing stops: the last few fade out on their own.
      setTimeout(() => setNotes((now) => now.filter((kept) => kept.id !== id)), LIFE_MS);
    };
    const first = setTimeout(add, 0);
    const every = setInterval(add, EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [on]);

  if (notes.length === 0) return null;
  return (
    <span aria-hidden="true" className="pointer-events-none absolute bottom-full left-1/2 block">
      {notes.map((note) => (
        <span
          key={note.id}
          className={`absolute bottom-0 left-0 font-bold leading-none text-label ${note.colour} ${note.side === 'left' ? 'animate-note-left' : 'animate-note-right'}`}
        >
          {note.glyph}
        </span>
      ))}
    </span>
  );
}
