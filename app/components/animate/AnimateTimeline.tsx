'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { getEngine } from '../../lib/animate/engine';
import { togglePlaying } from '../../lib/animate/playback';
import { planeKey } from '../../lib/animate/planes';
import { selectRow } from '../../lib/animate/layers';
import { depthOf, moveCel, setExposure, visibleRows } from '../../lib/animate/project';
import { useStudio } from '../../lib/animate/store';
import { clearRange, cycleMark, deleteDrawing, duplicateDrawing, holdsOn, newDrawing, setOnion, setPlayMode, setRangeEnd } from '../../lib/animate/timeline';
import type { Cel, CelMark, LayerNode, PlayMode } from '../../lib/animate/types';
import { PLATE_MEDIUM, PLATE_PRESSED } from '../../lib/ui/controls';
import { TagChip } from './AnimateLayers';

const ROW_HEIGHT = 44;
const RULER_HEIGHT = 24;
const NAME_WIDTH = 150;

const MARK_LETTER: Record<CelMark, string> = { key: 'K', breakdown: 'B', inbetween: 'I' };
const MARK_FILL: Record<CelMark, string> = { key: 'bg-sun text-ink-plate', breakdown: 'bg-bubble text-ink-plate', inbetween: 'bg-acid text-ink-plate' };
const PLAY_MODES: { mode: PlayMode; label: string }[] = [
  { mode: 'loop', label: 'LOOP' },
  { mode: 'pingpong', label: 'PING-PONG' },
  { mode: 'once', label: 'ONCE' },
];

/** The buttons above the timeline. */
function Transport() {
  const playing = useStudio((state) => state.playing);
  const readying = useStudio((state) => state.readying);
  const frame = useStudio((state) => state.frame);
  const frames = useStudio((state) => state.project.frames);
  const fps = useStudio((state) => state.project.fps);
  const playMode = useStudio((state) => state.project.playMode);
  const range = useStudio((state) => state.project.range);
  const onionOn = useStudio((state) => state.project.onion.on);
  const engine = getEngine();

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1 text-key">
      <button type="button" className={playing ? PLATE_PRESSED : PLATE_MEDIUM} aria-pressed={playing} onClick={() => togglePlaying(engine)} title="ENTER">
        [ {playing ? 'STOP' : 'PLAY'} ]
      </button>
      <span aria-live="off" data-animate-frame={frame}>
        FRAME {frame + 1} / {frames}
      </span>
      {readying !== null && <span role="status">READYING {Math.round(readying * 100)}%</span>}
      <span role="group" aria-label="How playback runs" className="flex items-center gap-0.5">
        {PLAY_MODES.map((item) => (
          <button key={item.mode} type="button" className={playMode === item.mode ? PLATE_PRESSED : PLATE_MEDIUM} aria-pressed={playMode === item.mode} onClick={() => setPlayMode(item.mode)}>
            [ {item.label} ]
          </button>
        ))}
      </span>
      <span role="group" aria-label="Playback range" className="flex items-center gap-0.5">
        <button type="button" className={PLATE_MEDIUM} onClick={() => setRangeEnd('in')} title="B">
          [ IN ]
        </button>
        <button type="button" className={PLATE_MEDIUM} onClick={() => setRangeEnd('out')} title="N">
          [ OUT ]
        </button>
        {range !== null && (
          <button type="button" className={PLATE_MEDIUM} onClick={clearRange} title="SHIFT + B" aria-label="Clear the range">
            [ {range.in + 1}-{range.out + 1} X ]
          </button>
        )}
      </span>
      <label className="flex items-center gap-1">
        FPS
        <input
          type="number"
          min={1}
          max={60}
          value={fps}
          aria-label="Frames per second"
          onChange={(event) => {
            const value = Math.max(1, Math.min(60, Math.round(Number(event.target.value)) || 1));
            engine.tweak((project) => ({ ...project, fps: value }));
          }}
          className="frame w-14 bg-paper px-1 py-0.5 font-mono text-key text-ink outline-none focus:outline-2 focus:outline-dotted focus:outline-bubble"
        />
      </label>
      <span role="group" aria-label="Drawings" className="flex flex-wrap items-center gap-0.5">
        <button type="button" className={PLATE_MEDIUM} onClick={newDrawing} title="D">
          [ NEW ]
        </button>
        <button type="button" className={PLATE_MEDIUM} onClick={() => void duplicateDrawing()} title="SHIFT + D">
          [ COPY ]
        </button>
        <button type="button" className={PLATE_MEDIUM} onClick={deleteDrawing} title="SHIFT + DELETE">
          [ DEL ]
        </button>
        <button type="button" className={PLATE_MEDIUM} onClick={cycleMark} title="U">
          [ MARK ]
        </button>
      </span>
      <span role="group" aria-label="Put this layer on ones, twos or threes" className="flex items-center gap-0.5">
        {[1, 2, 3].map((hold) => (
          <button key={hold} type="button" className={PLATE_MEDIUM} onClick={() => holdsOn(hold)} title={`ALT + ${hold}`} aria-label={`Layer on ${hold}s`}>
            [ {hold}S ]
          </button>
        ))}
      </span>
      <span role="group" aria-label="Onion skin" className="flex items-center gap-0.5">
        <button type="button" className={onionOn ? PLATE_PRESSED : PLATE_MEDIUM} aria-pressed={onionOn} onClick={() => setOnion(!onionOn)} title="O">
          [ ONION ]
        </button>
        <button type="button" className={PLATE_MEDIUM} onClick={() => useStudio.setState({ panel: 'onion' })} title="SHIFT + O" aria-label="Onion settings">
          [ ... ]
        </button>
      </span>
      <button type="button" className={PLATE_MEDIUM} onClick={() => useStudio.setState({ panel: 'export' })} title="CTRL + E">
        [ EXPORT ]
      </button>
    </div>
  );
}

/** A small picture of a drawing, on its cel. */
function CelThumb({ drawingId, width }: { drawingId: string; width: number }) {
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

  const w = Math.max(8, Math.min(width - 4, 60));
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
    const at = (clientX: number) => Math.round((clientX - startX) / cellWidth);
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
      style={{ left: frame * cellWidth, width: width - 1, height: ROW_HEIGHT - 5 }}
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
        {showThumbs && width >= 30 && <CelThumb drawingId={cel.drawingId} width={width - 22} />}
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

function Row({ node, cellWidth, depth }: { node: LayerNode; cellWidth: number; depth: number }) {
  void depth;
  const frame = useStudio((state) => state.frame);
  const isActive = useStudio((state) => state.layerId === node.id);
  const here = node.cels.find((c) => c.frame <= frame && frame < c.frame + c.length)?.id ?? null;

  return (
    <div
      className="relative"
      style={{
        height: ROW_HEIGHT,
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

function Playhead({ cellWidth }: { cellWidth: number }) {
  const frame = useStudio((state) => state.frame);
  return <div aria-hidden="true" data-animate-playhead className="pointer-events-none absolute inset-y-0 z-10 border-x-line border-bubble" style={{ left: frame * cellWidth, width: cellWidth }} />;
}

/** The timeline: layers as rows, frames as columns, each drawing as a box as long as it's held. */
export default function AnimateTimeline() {
  const project = useStudio((state) => state.project);
  const layerId = useStudio((state) => state.layerId);
  const frame = useStudio((state) => state.frame);
  const uiScale = useStudio((state) => state.settings.uiScale);
  const [cellWidth, setCellWidth] = useState(24);
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

  return (
    <section aria-label="Timeline" className="flex flex-col border-t-line border-ink bg-sun-pale">
      <Transport />
      {/* Its height stays a share of the screen at any interface size. */}
      <div ref={scroller} className="min-h-24 overflow-auto bg-paper" style={{ maxHeight: `calc(30vh / ${uiScale})` }}>
        <div className="flex" style={{ width: NAME_WIDTH + count * cellWidth }}>
          <div className="sticky left-0 z-20 shrink-0 border-r-line border-ink bg-sun-pale" style={{ width: NAME_WIDTH }}>
            <div className="flex items-center gap-1 border-b-line border-ink px-1" style={{ height: RULER_HEIGHT }}>
              <button type="button" className="key cursor-pointer px-1 text-label" aria-label="Frames narrower" onClick={() => setCellWidth((w) => Math.max(8, w - 4))}>
                [-]
              </button>
              <button type="button" className="key cursor-pointer px-1 text-label" aria-label="Frames wider" onClick={() => setCellWidth((w) => Math.min(80, w + 4))}>
                [+]
              </button>
            </div>
            {rows.map((node) => (
              <button
                key={node.id}
                type="button"
                aria-pressed={node.id === layerId}
                className={`flex w-full cursor-pointer items-center truncate border-b border-ink px-1 text-left text-key ${node.id === layerId ? 'bg-ink text-paper' : 'text-ink'}`}
                style={{ height: ROW_HEIGHT }}
                onClick={() => selectRow(node.id)}
              >
                <span className="truncate" style={{ paddingLeft: depthOf(project, node) * 10 }}>
                  {node.kind === 'folder' ? `${node.name} /` : node.name}
                </span>
                <span className="ml-auto pl-1">
                  <TagChip project={project} node={node} />
                </span>
              </button>
            ))}
          </div>
          <div className="relative min-w-0 flex-1">
            <Ruler cellWidth={cellWidth} count={count} />
            <div className="relative">
              <Playhead cellWidth={cellWidth} />
              {rows.map((node) => (
                <div key={node.id} className="border-b border-ink">
                  <Row node={node} cellWidth={cellWidth} depth={0} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
