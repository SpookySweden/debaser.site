'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { getComicRepository } from '../../lib/comic/repository';
import { chapterPages, chaptersInOrder } from '../../lib/comic/rules';
import type { ComicChapter, ComicContents, ComicPage, PanelBox } from '../../lib/comic/types';
import { FIELD_TIGHT, PLATE, PLATE_MAIN, PLATE_PRESSED, TITLE_BAR } from '../../lib/ui/controls';
import ComicPageImage from './ComicPageImage';
import { explain } from '../../lib/ui/explain';

type PickerProps = {
  contents: ComicContents;
  chapter: ComicChapter | null;
  onChapter: (id: string) => void;
  pageId: string | null;
  onPage: (id: string) => void;
  locked?: boolean;
};

/** Which chapter and page the PANELS and LORE tabs work on. Returns the page in hand. */
export function StudioPagePicker({ contents, chapter, onChapter, pageId, onPage, locked = false }: PickerProps) {
  const chapters = chaptersInOrder(contents);
  const pages = chapter ? chapterPages(contents, chapter.id) : [];
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-wrap items-center gap-2 text-label text-ink">
        CHAPTER
        <select value={chapter?.id ?? ''} disabled={locked} onChange={(event) => onChapter(event.target.value)} className={FIELD_TIGHT}>
          {chapters.map((each) => (
            <option key={each.id} value={each.id}>{`CHAPTER ${each.number}${each.title ? `: ${each.title}` : ''}`}</option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-1" role="group" aria-label="PAGE">
        {pages.map((page, index) => {
          const on = page.id === (pageId ?? pages[0]?.id);
          return (
            <button
              key={page.id}
              type="button"
              disabled={locked}
              aria-pressed={on}
              onClick={() => onPage(page.id)}
              className={on ? PLATE_PRESSED : PLATE}
              {...explain('Opens this page of the chapter in the tab below.', 'Greyed out while panel boxes are not saved yet.')}
            >
              {`[ P ${index + 1} ]`}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function pageInHand(contents: ComicContents, chapter: ComicChapter | null, pageId: string | null): { page: ComicPage; number: number } | null {
  if (!chapter) return null;
  const pages = chapterPages(contents, chapter.id);
  const index = Math.max(0, pages.findIndex((page) => page.id === pageId));
  const page = pages[index];
  return page ? { page, number: index + 1 } : null;
}

type Box = PanelBox & { guessed: boolean; key: string };
type Drag = { mode: 'move' | 'resize' | 'draw'; index: number; startX: number; startY: number; box: PanelBox };

const MIN = 0.01;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * The studio's PANELS (SPEC-comic.md, Q10): the page's guessed boxes over it, to fix by hand. Drag a box to move it, its
 * corner to size it, an empty spot to draw a new one; the order is the reading order. A box Luke touched is no longer a guess,
 * so replacing the page's file keeps his boxes. Outlines only, in the site's own inks: nothing is drawn on the art.
 */
export default function StudioPanels(props: Omit<PickerProps, 'locked'>) {
  const { contents, chapter, pageId } = props;
  const held = pageInHand(contents, chapter, pageId);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loadCount, setLoadCount] = useState(0);
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const heldId = held?.page.id ?? null;

  useEffect(() => {
    if (heldId === null) return;
    let live = true;
    void getComicRepository()
      .panels([heldId])
      .then((found) => {
        if (!live) return;
        setBoxes(found.map((panel) => ({ x: panel.x, y: panel.y, w: panel.w, h: panel.h, guessed: panel.guessed, key: panel.id })));
        setSelected(null);
        setDirty(false);
      });
    return () => {
      live = false;
    };
  }, [heldId, loadCount]);

  if (!held) return <StudioPagePicker {...props} />;

  const point = (event: ReactPointerEvent) => {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clamp((event.clientX - rect.left) / rect.width, 0, 1), y: clamp((event.clientY - rect.top) / rect.height, 0, 1) };
  };

  const change = (index: number, next: PanelBox) => {
    setBoxes((now) => now.map((box, at) => (at === index ? { ...box, ...next, guessed: false } : box)));
    setDirty(true);
    setSaved(false);
  };

  const onPointerDown = (event: ReactPointerEvent, mode: Drag['mode'], index: number) => {
    event.stopPropagation();
    event.preventDefault();
    const at = point(event);
    let target = index;
    if (mode === 'draw') {
      const fresh: Box = { x: at.x, y: at.y, w: MIN, h: MIN, guessed: false, key: crypto.randomUUID() };
      target = boxes.length;
      setBoxes((now) => [...now, fresh]);
      setDirty(true);
      setSaved(false);
      drag.current = { mode, index: target, startX: at.x, startY: at.y, box: fresh };
    } else {
      drag.current = { mode, index, startX: at.x, startY: at.y, box: boxes[index] };
    }
    setSelected(target);
    surface.current?.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const now = drag.current;
    if (!now) return;
    const at = point(event);
    const dx = at.x - now.startX;
    const dy = at.y - now.startY;
    const b = now.box;
    if (now.mode === 'move') {
      change(now.index, { x: clamp(b.x + dx, 0, 1 - b.w), y: clamp(b.y + dy, 0, 1 - b.h), w: b.w, h: b.h });
    } else if (now.mode === 'resize') {
      change(now.index, { x: b.x, y: b.y, w: clamp(b.w + dx, MIN, 1 - b.x), h: clamp(b.h + dy, MIN, 1 - b.y) });
    } else {
      const x = Math.min(now.startX, at.x);
      const y = Math.min(now.startY, at.y);
      change(now.index, { x, y, w: Math.max(MIN, Math.abs(dx)), h: Math.max(MIN, Math.abs(dy)) });
    }
  };

  const reorder = (from: number, to: number) => {
    if (to < 0 || to >= boxes.length) return;
    setBoxes((now) => {
      const next = [...now];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setSelected(to);
    setDirty(true);
    setSaved(false);
  };

  const save = async () => {
    setProblem(null);
    try {
      await getComicRepository().savePanels(
        held.page.id,
        boxes.map(({ x, y, w, h, guessed }) => ({ x: round(x), y: round(y), w: round(Math.min(w, 1 - x)), h: round(Math.min(h, 1 - y)), guessed })),
      );
      setDirty(false);
      setSaved(true);
      setLoadCount((count) => count + 1);
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : 'THE PANELS COULD NOT BE SAVED.');
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <StudioPagePicker {...props} locked={dirty} />
      {dirty ? <p className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">UNSAVED: SAVE OR UNDO BEFORE CHANGING PAGE.</p> : null}
      {problem ? <p className="w-fit bg-bubble-pale px-1 text-label text-ink-bar">{problem}</p> : null}
      <h2 className={TITLE_BAR}>{`CHAPTER ${chapter?.number} · P ${held.number}: PANELS`}</h2>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" className={PLATE_MAIN} disabled={!dirty} onClick={() => void save()} {...explain('Saves the boxes on this page, in their numbered order.', 'Greyed out until something has changed.', 'LORE TAGS AND COMMENTS STAY WITH THE NUMBER, NOT THE BOX.')}>
          [ SAVE ]
        </button>
        <button type="button" className={PLATE} disabled={!dirty} onClick={() => setLoadCount((count) => count + 1)} {...explain('Throws away the changes since the last save and shows the saved boxes again.', 'Greyed out until something has changed.', 'UNSAVED CHANGES GO AT ONCE, WITH NO QUESTION.')}>
          [ UNDO CHANGES ]
        </button>
        <button type="button" className={PLATE} disabled={selected === null} onClick={() => selected !== null && reorder(selected, selected - 1)} {...explain('Moves the picked box one place earlier in the reading order.', 'Pick a box first. The numbers on the boxes are the order.', 'ON SAVE, TAGS AND COMMENTS STAY WITH THE NUMBER.')}>
          [ ▲ EARLIER ]
        </button>
        <button type="button" className={PLATE} disabled={selected === null} onClick={() => selected !== null && reorder(selected, selected + 1)} {...explain('Moves the picked box one place later in the reading order.', 'Pick a box first. The numbers on the boxes are the order.', 'ON SAVE, TAGS AND COMMENTS STAY WITH THE NUMBER.')}>
          [ ▼ LATER ]
        </button>
        <button
          type="button"
          className={PLATE}
          disabled={selected === null}
          {...explain('Removes the picked box. Nothing is saved until SAVE.', 'For a guessed box that is not a panel.', 'ON SAVE, LATER BOXES TAKE THE TAGS AND COMMENTS OF THE NUMBERS THEY MOVE INTO.')}
          onClick={() => {
            if (selected === null) return;
            setBoxes((now) => now.filter((_, at) => at !== selected));
            setSelected(null);
            setDirty(true);
            setSaved(false);
          }}
        >
          [ DELETE BOX ]
        </button>
        <button
          type="button"
          className={PLATE}
          {...explain('Adds one box as big as the whole page, last in the order.', 'For a page that is a single picture. Nothing is saved until SAVE.')}
          onClick={() => {
            setBoxes((now) => [...now, { x: 0, y: 0, w: 1, h: 1, guessed: false, key: crypto.randomUUID() }]);
            setSelected(boxes.length);
            setDirty(true);
            setSaved(false);
          }}
        >
          [ + WHOLE PAGE ]
        </button>
        {saved ? <span className="text-label text-ink">SAVED</span> : null}
      </div>
      <div
        ref={surface}
        className="relative mx-auto w-full max-w-2xl cursor-crosshair touch-none select-none"
        onPointerDown={(event) => onPointerDown(event, 'draw', -1)}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <ComicPageImage page={held.page} label={`PAGE ${held.number}`} />
        {boxes.map((box, index) => (
          <div
            key={box.key}
            role="button"
            tabIndex={0}
            aria-pressed={selected === index}
            aria-label={`PANEL ${index + 1}`}
            {...explain('Picks this panel box. Drag it to move it, or drag its corner square to size it.', 'Its number is its place in the reading order; a ? means it is still a guess.')}
            onPointerDown={(event) => onPointerDown(event, 'move', index)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') setSelected(index);
            }}
            className={`comic-panel comic-panel-lit absolute cursor-move ${selected === index ? 'comic-panel-open' : ''}`}
            style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
          >
            <span className="absolute left-0 top-0 bg-paper px-0.5 text-label text-ink">{`${index + 1}${box.guessed ? ' ?' : ''}`}</span>
            <span
              aria-hidden
              onPointerDown={(event) => onPointerDown(event, 'resize', index)}
              className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize bg-bubble"
            />
          </div>
        ))}
      </div>
      <p className="text-label text-ink">? MARKS A GUESS. DRAG A BOX TO MOVE IT, ITS CORNER TO SIZE IT, AN EMPTY SPOT TO DRAW ONE.</p>
    </div>
  );
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
