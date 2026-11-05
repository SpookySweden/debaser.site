'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { clampView, HOME_VIEW, nearestInDirection, placeLabels, toScreen, zoomed, type Direction, type MapSize, type MapView, type PlacedLabel } from '../lib/tag-station/map-layout';
import type { RelatedTag, StationIndex } from '../lib/tag-station/query';
import { STATION_KEY, STATION_RING } from './TagStationParts';

const ARROWS: Partial<Record<string, Direction>> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
/** How many of the closest words are lit and tied to the choice. */
const LIT = 8;

/** The view that frames the focus: centred on its words, close enough to see them, never further out than the whole map. */
function viewOf(index: StationIndex, focus: readonly string[]): MapView {
  const tags = focus.map((word) => index.tagByName.get(word)).filter((tag) => tag !== undefined);
  if (tags.length === 0) return HOME_VIEW;
  const xs = tags.map((tag) => tag.x);
  const ys = tags.map((tag) => tag.y);
  const spread = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const scale = spread > 0.5 ? 1 : spread > 0.25 ? 1.5 : 2.25;
  return clampView({ cx, cy, scale });
}

/**
 * The map (SPEC-tag-station.md): real page text, so browser zoom, keyboard and screen readers all work. Zoomed out it shows
 * fewer words, biggest first, and never shrinks one. One Tab stop: arrows go to the nearest word that way, Enter picks, A adds
 * to the recipe, plus and minus zoom, Escape goes back to the search box. It snaps; nothing eases.
 */
export default function TagStationMap({
  index,
  focus,
  related,
  visibleNames,
  inRecipe,
  onPick,
  onAdd,
  onEscape,
}: {
  index: StationIndex;
  focus: readonly string[];
  related: readonly RelatedTag[];
  /** Words the filters leave on the map. */
  visibleNames: ReadonlySet<string>;
  /** A mark for each word in the recipe, so it reads without colour. */
  inRecipe: (word: string) => 'must' | 'any' | 'not' | null;
  onPick: (word: string) => void;
  onAdd: (word: string) => void;
  onEscape: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState<MapSize>({ width: 0, height: 0 });
  const [fontPx, setFontPx] = useState(16);
  const focusKey = focus.join('\u0000');
  // The view belongs to one focus: choosing something else snaps to it, and panning only lasts until then.
  const [moved, setMoved] = useState<{ key: string; view: MapView } | null>(null);
  const view = useMemo(() => (moved !== null && moved.key === focusKey ? moved.view : viewOf(index, focus)), [moved, focusKey, index, focus]);
  const setView = (next: MapView) => setMoved({ key: focusKey, view: clampView(next) });
  const [active, setActive] = useState<string | null>(null);
  const keepFocus = useRef(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    const element = box.current;
    if (element === null) return;
    const measure = () => {
      setSize({ width: element.clientWidth, height: element.clientHeight });
      if (probe.current) setFontPx(Number.parseFloat(getComputedStyle(probe.current).fontSize) || 16);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // With nothing chosen, `related` is just the commonest words: nothing to light or tie to.
  const lit = useMemo(() => (focus.length === 0 ? [] : related.slice(0, LIT).map((one) => one.tag.name)), [focus, related]);
  const forced = useMemo(() => [...(active !== null ? [active] : []), ...focus, ...lit], [active, focus, lit]);
  const tags = useMemo(() => index.graph.tags.filter((tag) => visibleNames.has(tag.name) || forced.includes(tag.name)), [index, visibleNames, forced]);
  const labels = useMemo(() => placeLabels(tags, view, size, fontPx, forced), [tags, view, size, fontPx, forced]);
  const labelByName = useMemo(() => new Map(labels.map((label) => [label.tag.name, label])), [labels]);

  // Which label holds the one Tab stop: the word with the keyboard, then the choice, then the first drawn.
  const tabStop = (active !== null && labelByName.has(active) ? active : focus.find((word) => labelByName.has(word))) ?? labels[0]?.tag.name ?? null;

  useEffect(() => {
    if (!keepFocus.current || active === null) return;
    keepFocus.current = false;
    box.current?.querySelector<HTMLButtonElement>(`[data-word="${CSS.escape(active)}"]`)?.focus();
  }, [active, labels]);

  const zoom = (direction: 1 | -1) => {
    const scale = zoomed(view.scale, direction);
    const around = active !== null ? index.tagByName.get(active) : undefined;
    setView({ cx: around?.x ?? view.cx, cy: around?.y ?? view.cy, scale });
    setNote(scale === view.scale ? (direction === 1 ? 'ALL THE WAY IN.' : 'THE WHOLE MAP.') : `ZOOM ${scale}.`);
  };
  const pan = (direction: Direction) => {
    const step = 0.25 / view.scale;
    const dx = direction === 'left' ? -step : direction === 'right' ? step : 0;
    const dy = direction === 'up' ? -step : direction === 'down' ? step : 0;
    const next = clampView({ ...view, cx: view.cx + dx, cy: view.cy + dy });
    setView(next);
    return next.cx !== view.cx || next.cy !== view.cy;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const name = (event.target as HTMLElement).dataset.word ?? tabStop;
    const direction = ARROWS[event.key];
    if (direction !== undefined) {
      event.preventDefault();
      const next = name === null ? null : nearestInDirection(labels, name, direction);
      if (next !== null) {
        keepFocus.current = true;
        setActive(next.tag.name);
        setNote(next.tag.name);
      } else {
        setNote(pan(direction) ? 'MAP MOVED.' : 'NOTHING FURTHER.');
      }
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoom(1);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      zoom(-1);
    } else if ((event.key === 'a' || event.key === 'A') && name !== null && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      onAdd(name);
      setNote(`${name} ADDED.`);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onEscape();
    }
  };

  const drag = useRef<{ x: number; y: number; view: MapView } | null>(null);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button') !== null) return;
    drag.current = { x: event.clientX, y: event.clientY, view };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current === null || size.width === 0) return;
    const { x, y, view: from } = drag.current;
    setView({ ...from, cx: from.cx - (event.clientX - x) / (from.scale * size.width), cy: from.cy - (event.clientY - y) / (from.scale * size.height) });
  };
  const endDrag = () => {
    drag.current = null;
  };

  // Dotted lines from the choice to its closest words, between labels that are actually drawn.
  const lines = useMemo(() => {
    const centre = (label: PlacedLabel) => ({ x: label.left + label.width / 2, y: label.top + label.height / 2 });
    const found: { key: string; x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const word of focus) {
      const from = labelByName.get(word);
      if (from === undefined) continue;
      const partners = index.tagByName.get(word)?.partners ?? [];
      for (const name of lit) {
        if (!partners.some((partner) => partner.name === name)) continue;
        const to = labelByName.get(name);
        if (to === undefined) continue;
        const a = centre(from);
        const b = centre(to);
        found.push({ key: `${word}\u0000${name}`, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      }
    }
    return found;
  }, [focus, lit, labelByName, index]);

  // The words off the edge of the frame have no label: the list view holds every one of them.
  const offMap = focus.filter((word) => {
    const tag = index.tagByName.get(word);
    if (tag === undefined) return false;
    const point = toScreen(tag, view, size);
    return point.x < 0 || point.x > size.width || point.y < 0 || point.y > size.height;
  }).length;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div role="group" aria-label="Map controls" className="flex flex-wrap items-center gap-1">
        <button type="button" onClick={() => zoom(1)} aria-label="Zoom in" className={STATION_KEY}>
          [ + ]
        </button>
        <button type="button" onClick={() => zoom(-1)} aria-label="Zoom out" className={STATION_KEY}>
          [ − ]
        </button>
        <button type="button" onClick={() => setMoved({ key: focusKey, view: HOME_VIEW })} className={STATION_KEY}>
          [ WHOLE MAP ]
        </button>
        {(['left', 'up', 'down', 'right'] as const).map((direction) => (
          <button key={direction} type="button" onClick={() => pan(direction)} aria-label={`Move the map ${direction}`} className={STATION_KEY}>
            {{ left: '◀', up: '▲', down: '▼', right: '▶' }[direction]}
          </button>
        ))}
        <span className="text-label text-ink">
          {labels.length} OF {tags.length} WORDS
          {offMap > 0 ? ` · ${offMap} OFF THE EDGE` : ''}
        </span>
      </div>

      {/* An invisible word at the label size, so the map knows how big its labels really are. */}
      <span ref={probe} aria-hidden="true" className="invisible absolute text-label">
        x
      </span>
      <div
        ref={box}
        role="group"
        aria-label="Map of words. Arrow keys move between words, Enter goes to one, A adds it to the recipe, plus and minus zoom, Escape returns to search."
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="frame relative h-128 touch-pan-y cursor-grab select-none overflow-hidden bg-paper max-sm:h-120"
      >
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full text-ink">
          {lines.map((line) => (
            <line key={line.key} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke="currentColor" strokeWidth="2" strokeDasharray="2 6" />
          ))}
        </svg>
        {labels.map((label) => {
          const name = label.tag.name;
          const chosen = focus.includes(name);
          const near = lit.includes(name);
          const list = inRecipe(name);
          const mark = list === 'not' ? '− ' : list !== null ? '+ ' : '';
          return (
            <button
              key={name}
              type="button"
              data-word={name}
              tabIndex={name === tabStop ? 0 : -1}
              onClick={() => onPick(name)}
              onFocus={() => setActive(name)}
              style={{ left: label.left, top: label.top, width: label.width, height: label.height }}
              aria-pressed={chosen}
              aria-label={`${name}, ${label.tag.count === 1 ? '1 item' : `${label.tag.count} items`}${chosen ? ', chosen' : near ? ', close to the choice' : ''}${list ? `, in the recipe as ${list}` : ''}`}
              className={`absolute inline-flex items-center justify-center overflow-hidden whitespace-nowrap text-label ${STATION_RING} ${
                chosen ? 'key key-fill key-on [--key-fill:var(--color-ink)] text-paper' : near ? 'key underline decoration-2 underline-offset-2' : 'key'
              }`}
            >
              {mark}
              {name}
            </button>
          );
        })}
      </div>
      <p role="status" className="sr-only">
        {note}
      </p>
    </div>
  );
}
