'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { getEngine } from '../../lib/animate/engine';
import { planeKey } from '../../lib/animate/planes';
import { selectRow } from '../../lib/animate/layers';
import { depthOf, moveCel, setExposure, visibleRows } from '../../lib/animate/project';
import { useStudio } from '../../lib/animate/store';
import { tagOf } from '../../lib/animate/tags';
import { soundPeaks } from '../../lib/animate/sound';
import type { Cel, CelMark, LayerNode } from '../../lib/animate/types';
import { FrameWords, FramesKey, PlayKey } from './AnimateBars';
import { TagChip } from './AnimateLayers';

const ROW_HEIGHT = 30;
const RULER_HEIGHT = 24;
const NAME_WIDTH = 240;
const SOUND_HEIGHT = 32;
/** Room for the scrollbar under the rows. */
const SCROLLBAR = 20;

const MARK_LETTER: Record<CelMark, string> = { key: 'K', breakdown: 'B', inbetween: 'I' };
const MARK_FILL: Record<CelMark, string> = { key: 'bg-sun text-ink-plate', breakdown: 'bg-bubble text-ink-plate', inbetween: 'bg-acid text-ink-plate' };

/** A small picture of a drawing, on its cel. */
function CelThumb({ drawingId, width, height }: { drawingId: string; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useStudio((state) => state.project.drawings[drawingId]);
  const sheetW = useStudio((state) => state.project.width);
  const sheetH = useStudio((state) => state.project.height);
  const background = useStudio((state) => state.project.background);

  useEffect(() => {
    let live = true;
    const canvas = ref.current;
    if (canvas === null) return undefined;
    const paint = async () => {
      const engine = getEngine();
      const planes: OffscreenCanvas[] = [];
      for (const plane of ['colour', 'line'] as const) {
        if ((drawing?.planes[plane].length ?? 0) > 0) planes.push(await engine.planes.open(planeKey(drawingId, plane)));
      }
      if (!live) return;
      const ctx = canvas.getContext('2d');
      if (ctx === null) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(canvas.width / sheetW, canvas.height / sheetH);
      for (const plane of planes) ctx.drawImage(plane, 0, 0);
    };
    // Thumbnails wait for a quiet moment; nothing here is worth a stutter.
    const timer = setTimeout(() => void paint(), 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [drawing, drawingId, sheetW, sheetH, background]);

  const w = Math.max(8, Math.min(width - 4, 60, (height * sheetW) / sheetH));
  const h = Math.max(6, Math.round((w * sheetH) / sheetW));
  return <canvas ref={ref} width={w} height={h} aria-hidden="true" className="pointer-events-none" />;
}

function CelBox({ cel, layerId, cellWidth, active }: { cel: Cel; layerId: string; cellWidth: number; active: boolean }) {
  const engine = getEngine();
  const showThumbs = useStudio((state) => state.settings.showThumbnails);
  const [preview, setPreview] = useState<{ frame: number; length: number } | null>(null);

  // Dragging a cel's end changes its hold; dragging its body moves it. Both are one undo step, made on letting go.
  const drag = (event: ReactPointerEvent<HTMLElement>, kind: 'move' | 'end') => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    useStudio.setState({ layerId });
    let moved = false;
    const at = (point: number) => Math.round((point - startX) / cellWidth);
    const onMove = (move: PointerEvent) => {
      const delta = at(move.clientX);
      if (delta !== 0) moved = true;
      setPreview(kind === 'end' ? { frame: cel.frame, length: Math.max(1, cel.length + delta) } : { frame: Math.max(0, cel.frame + delta), length: cel.length });
    };
    const onUp = (up: PointerEvent) => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      setPreview(null);
      const delta = at(up.clientX);
      if (up.type === 'pointercancel') return;
      if (!moved || delta === 0) {
        if (kind === 'move') engine.goToFrame(cel.frame);
        return;
      }
      if (kind === 'end') engine.edit('EXPOSURE', (project) => setExposure(project, layerId, cel.id, cel.length + delta, up.shiftKey));
      else engine.edit('MOVE DRAWING', (project) => moveCel(project, layerId, cel.id, cel.frame + delta));
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  const frame = preview?.frame ?? cel.frame;
  const length = preview?.length ?? cel.length;
  const width = length * cellWidth;

  return (
    <div
      className={`absolute top-0.5 flex touch-none items-center gap-0.5 overflow-hidden border-line ${active ? 'border-bubble' : 'border-ink'} bg-paper`}
      style={{ left: frame * cellWidth, width: width - 1, height: ROW_HEIGHT - 6 }}
      data-animate-cel={cel.id}
      data-frame={cel.frame}
      data-length={cel.length}
    >
      <button
        type="button"
        aria-label={`Drawing at frame ${cel.frame + 1}, held ${cel.length} frames, ${cel.mark}`}
        className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-0.5 overflow-hidden text-label"
        onPointerDown={(event) => drag(event, 'move')}
        onClick={(event) => {
          // A key press on the row (Enter on a focused cel): pointer presses already did this on the way up.
          if (event.detail === 0) engine.goToFrame(cel.frame);
        }}
      >
        <span className={`flex h-full w-3.5 shrink-0 items-center justify-center ${MARK_FILL[cel.mark]}`}>{MARK_LETTER[cel.mark]}</span>
        {showThumbs && width >= 30 && <CelThumb drawingId={cel.drawingId} width={width - 22} height={ROW_HEIGHT - 9} />}
      </button>
      <span
        role="presentation"
        title="DRAG TO HOLD LONGER"
        data-animate-cel-end
        className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-ink"
        onPointerDown={(event) => drag(event, 'end')}
      />
    </div>
  );
}

function Row({ node, cellWidth }: { node: LayerNode; cellWidth: number }) {
  const frame = useStudio((state) => state.frame);
  const isActive = useStudio((state) => state.layerId === node.id);
  const tagColour = useStudio((state) => tagOf(state.project, node)?.colour ?? null);
  const here = node.cels.find((c) => c.frame <= frame && frame < c.frame + c.length)?.id ?? null;

  return (
    <div
      className="relative"
      style={{
        // Its wrapper's line under it makes up the rest, so a row and its name stay level however many layers there are.
        height: ROW_HEIGHT - 1,
        // A line per frame, and a thin hatch: a frame nothing covers reads as empty.
        backgroundImage: `repeating-linear-gradient(to right, var(--color-ink) 0 1px, transparent 1px ${cellWidth}px), repeating-linear-gradient(135deg, var(--color-chrome-dark) 0 2px, transparent 2px 7px)`,
        opacity: isActive ? 1 : 0.85,
      }}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        const picked = Math.max(0, Math.floor((event.clientX - box.left) / cellWidth));
        useStudio.setState({ layerId: node.id });
        getEngine().goToFrame(picked);
      }}
    >
      {tagColour !== null && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-0.5" style={{ backgroundColor: tagColour }} />}
      {node.cels.map((cel) => (
        <CelBox key={cel.id} cel={cel} layerId={node.id} cellWidth={cellWidth} active={cel.id === here && isActive} />
      ))}
    </div>
  );
}

function Ruler({ cellWidth, count }: { cellWidth: number; count: number }) {
  const fps = useStudio((state) => state.project.fps);
  const range = useStudio((state) => state.project.range);
  const every = Math.max(1, Math.ceil(fps / 2));
  const labels: number[] = [];
  for (let f = 0; f < count; f += every) labels.push(f);

  const scrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const go = (clientX: number) => {
      const box = target.getBoundingClientRect();
      getEngine().goToFrame(Math.max(0, Math.floor((clientX - box.left) / cellWidth)));
    };
    go(event.clientX);
    const onMove = (move: PointerEvent) => go(move.clientX);
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  return (
    <div data-animate-ruler className="relative cursor-ew-resize touch-none border-b-line border-ink bg-sun-pale" style={{ height: RULER_HEIGHT, width: count * cellWidth }} onPointerDown={scrub}>
      {range !== null && <div className="absolute inset-y-0 bg-bubble-pale opacity-50" style={{ left: range.in * cellWidth, width: (range.out - range.in + 1) * cellWidth }} />}
      {labels.map((f) => (
        <span key={f} className="pointer-events-none absolute top-0 border-l-line border-ink pl-0.5 text-label text-ink" style={{ left: f * cellWidth }}>
          {f + 1}
        </span>
      ))}
    </div>
  );
}

/** The sound as a picture, one bar per frame, so a mouth can be timed by eye. */
function SoundRow({ cellWidth, count }: { cellWidth: number; count: number }) {
  const track = useStudio((state) => state.project.audio);
  const fps = useStudio((state) => state.project.fps);
  const ready = useStudio((state) => state.soundReady);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null || track === null) return;
    const peaks = soundPeaks(track, fps);
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (peaks === null) return;
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue('--color-acid');
    const across = canvas.width / count;
    for (let f = 0; f < peaks.length; f += 1) {
      const x = (track.frame + f) * across;
      if (x > canvas.width) break;
      const h = Math.max(1, peaks[f] * canvas.height);
      ctx.fillRect(x, (canvas.height - h) / 2, Math.max(1, across - 1), h);
    }
  }, [track, fps, count, ready]);

  if (track === null) return null;
  return (
    <div className="relative border-b border-ink" style={{ height: SOUND_HEIGHT }} data-animate-sound-row>
      {/* A browser limits a canvas's width, so a long shot's picture is stretched rather than cut off. */}
      <canvas ref={ref} width={Math.min(8000, count * cellWidth)} height={SOUND_HEIGHT} className="absolute inset-0 h-full w-full" aria-hidden="true" />
    </div>
  );
}

function Playhead({ cellWidth }: { cellWidth: number }) {
  const frame = useStudio((state) => state.frame);
  return <div aria-hidden="true" data-animate-playhead className="pointer-events-none absolute inset-y-0 z-10 border-x-line border-bubble" style={{ left: frame * cellWidth, width: cellWidth }} />;
}

/** A row's name, picks the layer. */
function RowName({ node }: { node: LayerNode }) {
  const active = useStudio((state) => state.layerId === node.id);
  const project = useStudio((state) => state.project);
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`flex w-full cursor-pointer items-center truncate border-b border-ink px-1 text-left text-key ${active ? 'bg-ink text-paper' : 'text-ink'}`}
      style={{ height: ROW_HEIGHT }}
      onClick={() => selectRow(node.id)}
      data-animate-row-name={node.id}
    >
      <span className="truncate" style={{ paddingLeft: depthOf(project, node) * 8 }}>
        {node.kind === 'folder' ? `${node.name} /` : node.name}
      </span>
      <span className="ml-auto pl-1">
        <TagChip project={project} node={node} />
      </span>
    </button>
  );
}

/** The timeline, as thin as it can be: PLAY, where we are and its menu, then layers as rows and frames as columns, each drawing a box as long as it's held. */
export default function AnimateTimeline() {
  const project = useStudio((state) => state.project);
  const frame = useStudio((state) => state.frame);
  const layerId = useStudio((state) => state.layerId);
  const uiScale = useStudio((state) => state.settings.uiScale);
  const cellWidth = useStudio((state) => state.settings.frameWidth);
  const rowsShown = useStudio((state) => state.settings.timelineRows);
  const hasSound = useStudio((state) => state.project.audio !== null);
  const scroller = useRef<HTMLDivElement>(null);
  const rows = visibleRows(project);
  const count = Math.max(project.frames + 24, frame + 24);

  // The playhead stays in view, on playback as well as on stepping.
  useEffect(() => {
    const box = scroller.current;
    if (box === null) return;
    const x = NAME_WIDTH + frame * cellWidth;
    if (x < box.scrollLeft + NAME_WIDTH || x + cellWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = x - NAME_WIDTH - box.clientWidth / 3;
  }, [frame, cellWidth]);

  // So does the layer in hand, however few rows are showing.
  const activeAt = rows.findIndex((node) => node.id === layerId);
  useEffect(() => {
    const box = scroller.current;
    if (box === null || activeAt < 0) return;
    const top = RULER_HEIGHT + (hasSound ? SOUND_HEIGHT : 0) + activeAt * ROW_HEIGHT;
    const pinned = RULER_HEIGHT + (hasSound ? SOUND_HEIGHT : 0);
    if (top - pinned < box.scrollTop) box.scrollTop = top - pinned;
    else if (top + ROW_HEIGHT > box.scrollTop + box.clientHeight) box.scrollTop = top + ROW_HEIGHT - box.clientHeight;
  }, [activeAt, hasSound, rowsShown]);

  return (
    <section aria-label="Timeline" className="shrink-0 border-t-line border-ink bg-sun-pale" style={{ zoom: uiScale }}>
      <div ref={scroller} className="overflow-auto bg-paper" style={{ maxHeight: RULER_HEIGHT + (hasSound ? SOUND_HEIGHT : 0) + rowsShown * ROW_HEIGHT + SCROLLBAR }}>
        <div className="flex" style={{ width: NAME_WIDTH + count * cellWidth }}>
          <div className="left-0 z-30 shrink-0 border-r-line border-ink bg-sun-pale md:sticky" style={{ width: NAME_WIDTH }}>
            <div className="sticky top-0 z-10 bg-sun-pale">
              <div className="flex items-center justify-between gap-1 border-b-line border-ink px-1" style={{ height: RULER_HEIGHT }}>
                <PlayKey />
                <FrameWords />
                <FramesKey />
              </div>
              {hasSound && (
                <div className="flex items-center truncate border-b border-ink px-1 text-key" style={{ height: SOUND_HEIGHT }}>
                  SOUND
                </div>
              )}
            </div>
            {rows.map((node) => (
              <RowName key={node.id} node={node} />
            ))}
          </div>
          <div className="relative min-w-0 flex-1">
            <div className="sticky top-0 z-20 bg-paper">
              <Ruler cellWidth={cellWidth} count={count} />
              <SoundRow cellWidth={cellWidth} count={count} />
            </div>
            <div className="relative">
              <Playhead cellWidth={cellWidth} />
              {rows.map((node) => (
                <div key={node.id} className="border-b border-ink">
                  <Row node={node} cellWidth={cellWidth} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
