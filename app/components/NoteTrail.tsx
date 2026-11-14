'use client';

import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';

/**
 * Colourful music notes trailing up from a character while it dances (Luke, 2026-11-13): the profile's character and the
 * companion. Text characters (♪ ♫ ♬), not drawings, each in one of the marker colours, rising and drifting off to one side
 * in stepped frames. Placed over the character's head by its parent; nothing here takes a click or moves anything.
 * Under reduced motion there are none.
 *
 * And little `z`s while the companion sleeps (Luke, 2026-11-14): the same trail, slower, in one calm colour, starting
 * lower down (`sleepAt`, from the figure's feet) because a sleeping figure's head has sunk.
 *
 * `active` says it is dancing. A parent that doesn't re-render as it moves (the companion) passes `watch` instead: the
 * element whose `data-mood` reads `dance` while it dances and `sleep` while it sleeps.
 */

const NOTES = ['♪', '♫', '♬'] as const;
const NOTE_COLOURS = ['text-mark-yellow', 'text-mark-pink', 'text-mark-green', 'text-mark-blue', 'text-mark-red'] as const;
const SNORES = ['z', 'z', 'Z'] as const;
const SNORE_COLOURS = ['text-mark-blue'] as const;
/** A new one this often, and how long each lives (the animation's own length). */
const NOTE_EVERY_MS = 380;
const SNORE_EVERY_MS = 1100;
const LIFE_MS = 1600;

type Trail = 'notes' | 'snores';
type Note = { id: number; glyph: string; colour: string; side: 'left' | 'right' };

const REDUCED = '(prefers-reduced-motion: reduce)';
function subscribeReduced(change: () => void): () => void {
  const query = window.matchMedia(REDUCED);
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
}
const reducedNow = () => window.matchMedia(REDUCED).matches;
const reducedOnServer = () => true;

/** What `watch`'s `data-mood` calls for, followed as it changes: notes for a dance, snores for a sleep, else nothing. */
function useWatchedTrail(watch: RefObject<HTMLElement | null> | undefined): Trail | null {
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
    () => {
      const mood = watch?.current?.dataset.mood;
      return mood === 'dance' ? 'notes' : mood === 'sleep' ? 'snores' : null;
    },
    () => null,
  );
}

export default function NoteTrail({ active, watch, sleepAt }: { active?: boolean; watch?: RefObject<HTMLElement | null>; sleepAt?: number }) {
  const reduced = useSyncExternalStore(subscribeReduced, reducedNow, reducedOnServer);
  const watched = useWatchedTrail(watch);
  const trail: Trail | null = reduced ? null : active === undefined ? watched : active ? 'notes' : null;
  const [notes, setNotes] = useState<Note[]>([]);
  // Where the ones on screen rise from: kept while the last few fade out after the dance or the sleep has ended.
  const [from, setFrom] = useState<Trail>('notes');
  if (trail !== null && trail !== from) setFrom(trail);

  useEffect(() => {
    if (trail === null) return;
    const glyphs = trail === 'notes' ? NOTES : SNORES;
    const colours = trail === 'notes' ? NOTE_COLOURS : SNORE_COLOURS;
    let next = 0;
    const add = () => {
      const id = next;
      next += 1;
      const note: Note = {
        id,
        glyph: glyphs[Math.floor(Math.random() * glyphs.length)],
        colour: colours[Math.floor(Math.random() * colours.length)],
        // Snores all drift the one way, like a line of them; notes go off to either side.
        side: trail === 'snores' || id % 2 === 1 ? 'right' : 'left',
      };
      setNotes((now) => [...now, note]);
      // Each one goes once its animation ends, even after the dancing stops: the last few fade out on their own.
      setTimeout(() => setNotes((now) => now.filter((kept) => kept.id !== id)), LIFE_MS);
    };
    const first = setTimeout(add, 0);
    const every = setInterval(add, trail === 'notes' ? NOTE_EVERY_MS : SNORE_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [trail]);

  if (notes.length === 0) return null;
  const low = from === 'snores' && sleepAt !== undefined;
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute left-1/2 block ${low ? '' : 'bottom-full'}`}
      style={low ? { bottom: sleepAt } : undefined}
      data-note-trail={from}
    >
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
